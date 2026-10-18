/*
  Nura Box - ESP32 firmware  (v1.0)
  Target : ESP32 DevKit V1 (WROOM), Arduino-ESP32 core 3.x, Arduino IDE 2.3
  Libs   : ArduinoJson 7 + PubSubClient (both from Library Manager). Everything else ships with the core.
  Board  : "ESP32 Dev Module", Partition Scheme: Default 4MB with spiffs (LittleFS uses it)

  What it does
   - Serves the website from LittleFS (data/ folder) + JSON API
   - Schedule engine (4 boxes): waiting -> due -> taken / missed / skipped
   - LDR lid detection, RGB(R+G) LEDs via LEDC, passive buzzer melodies (non-blocking)
   - NTP time (Egypt TZ), WiFi captive-portal provisioning, mDNS nurabox.local

  NO delay() in loop(). The only busy-waits are the ~64 ms LDR calibration
  (setup + /api/calibrate) and the WiFi wait in setup().
*/

#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <ESPmDNS.h>
#include <LittleFS.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include <time.h>
#include <esp_system.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>

// =====================================================================
//  CONFIG BLOCK  (every pin and tunable lives here)
// =====================================================================
#define FW_VERSION "1.1"

// ---- pins (from nura.ino; GPIO12/2/16/19 are free now that BLUE is dropped)
static const uint8_t NUM_BOXES = 4;
static const uint8_t PIN_LED_R[NUM_BOXES] = {27, 13, 4, 17};   // GPIO17: WROOM only (WROVER uses it for PSRAM)
static const uint8_t PIN_LED_G[NUM_BOXES] = {14, 15, 5, 18};   // GPIO15, GPIO5 are strapping pins: LED+resistor to GND is OK
static const uint8_t PIN_LDR[NUM_BOXES]   = {34, 35, 32, 33};  // ADC1 only (ADC2 is unusable while WiFi is on)
static const uint8_t PIN_BTN_SILENCE  = 25;  // INPUT_PULLUP, press = silence current alert
static const uint8_t PIN_BTN_RESERVED = 26;  // INPUT_PULLUP, unused for now
static const uint8_t PIN_BTN_BOOT     = 0;   // INPUT_PULLUP, hold 3 s = forget WiFi
static const uint8_t PIN_BUZZER       = 23;  // passive buzzer (PROPOSAL)

// ---- LED electrical
static const bool COMMON_ANODE = false;      // true inverts PWM for common-anode LEDs

// ---- LDR
static const bool OPEN_IS_LOW = true;        // true: lid open => ADC reading goes LOWER than baseline.
                                             // Flip if your divider is wired the other way (check /api/status "ldr").
static const int  LDR_MIN_DELTA   = 300;     // min ADC change (0..4095) to call it "open"
static const float LDR_DELTA_FRAC = 0.30f;   // or 30 % of baseline, whichever is larger
static const uint32_t LDR_DEBOUNCE_MS = 150;
static const uint32_t LDR_SAMPLE_MS   = 10;

// ---- schedule
static const uint32_t GRACE_SEC     = 30 * 60;      // window after dose time
static const uint32_t TAKEN_LED_MS  = 10UL * 60UL * 1000UL;
static const uint32_t DUE_REPEAT_MS = 20000;        // DUE melody repeat
static const uint32_t TEST_HOLD_MS  = 120000;       // test states revert after this

// ---- time
static const char* TZ_EGYPT = "EET-2EEST,M4.5.5/0,M10.5.4/24";
static const char* NTP_1 = "pool.ntp.org";
static const char* NTP_2 = "time.google.com";

// ---- WiFi / portal
static const char* AP_SSID = "NuraBox-Setup";
static const char* AP_PASS = "nura1234";            // CHANGE ME (>= 8 chars, WPA2)
static const char* MDNS_NAME = "nurabox";
static const uint32_t WIFI_CONNECT_MS   = 15000;
static const uint32_t PORTAL_RETRY_MS   = 5UL * 60UL * 1000UL;
static const uint32_t STA_LOST_PORTAL_MS = 60000;
static const uint32_t BOOT_HOLD_MS      = 3000;

// ---- storage / limits
static const char* USERS_FILE   = "/users.json";
static const char* REPORTS_FILE = "/reports.ndjson";
static const size_t MAX_USERS   = 10;
static const size_t MAX_REPORTS = 200;
static const size_t MAX_USERS_BODY  = 24 * 1024;
static const size_t MAX_REPORT_BODY = 2 * 1024;

// ---- remote access (MQTT over TLS). Broker host/user/pass are NOT in code: they are saved in NVS via POST /api/remote.
static const uint16_t MQTT_PORT_TLS     = 8883;     // HiveMQ Cloud / most brokers
static const uint32_t MQTT_STATUS_MS    = 5000;     // status publish period
static const uint32_t MQTT_RETRY_MS     = 15000;    // reconnect period
static const uint16_t MQTT_BUF          = 10240;    // must hold the reports snapshot
static const uint8_t  REPORTS_SNAPSHOT_N = 40;      // last N DOSE records published (never symptoms / doctor notes)

// ---- LEDC (core 3.x). Channels are pinned explicitly so the buzzer can never share a timer with the LEDs.
//   LEDs: channels 0..7 (high-speed group on classic ESP32), buzzer: channel 8 (low-speed group).
static const uint32_t LED_PWM_FREQ = 5000;
static const uint8_t  LED_PWM_BITS = 8;
static const uint8_t  BUZ_PWM_BITS = 10;
static const uint8_t  BUZ_CHANNEL  = 8;

// ---- buzzer melodies (MIDI note numbers, octave 6 = 84..95)
struct Note { uint8_t midi; uint16_t ms; };
static const uint16_t NOTE_GAP_MS = 60;
static const Note MEL_DUE[]    = {{84, 160}, {88, 160}, {91, 280}};   // C6 E6 G6 ascending
static const Note MEL_TAKEN[]  = {{91, 130}, {96, 260}};              // G6 C7
static const Note MEL_MISSED[] = {{91, 200}, {88, 200}, {84, 360}};   // G6 E6 C6 descending
static const Note MEL_READY[]  = {{84, 120}, {91, 200}};              // C6 G6

// =====================================================================
//  TYPES / GLOBALS
// =====================================================================
enum BoxState : uint8_t { ST_EMPTY, ST_WAITING, ST_DUE, ST_TAKEN, ST_MISSED, ST_SKIPPED };
static const char* STATE_NAME[] = {"empty", "waiting", "due", "taken", "missed", "skipped"};

struct Box {
  String   name;
  int32_t  dueSec = -1;          // seconds since midnight, -1 = none
  BoxState st = ST_EMPTY;
  BoxState prevSt = ST_EMPTY;    // for test revert
  uint32_t since = 0;
  int      ldr = 0;
  int      baseline = 0;
  bool     open = false;
  bool     pending = false;
  uint32_t pendSince = 0;
  bool     openedSeen = false;
  bool     silenced = false;
  bool     test = false;
  uint32_t testExpire = 0;
  bool     ldrOk = false;
};

struct Settings { uint8_t volume = 60; uint8_t brightness = 60; bool muted = false; };

static Box boxes[NUM_BOXES];
static Settings S;
static Preferences prefs;
static WebServer server(80);
static DNSServer dns;

static String ownerUsername, ownerName;

// time
static bool timeSynced = false;
static bool engineReady = false;
static int32_t secOfDay = 0;
static int dayKey = -1;
static struct tm nowTm;
static uint32_t lastClockMs = 0;

// network
static bool portalActive = false;
static uint32_t lastPortalRetry = 0;
static uint32_t staLostSince = 0;
static bool wasConnected = false;
static uint32_t restartAt = 0;

// reports
static size_t reportCount = 0;
static bool reportsDirty = false;
static uint32_t reportsDirtyAt = 0;

// remote (MQTT). The MQTT task owns `tls` and `mqtt`; loop() never touches them.
static WiFiClientSecure tls;
static PubSubClient mqtt(tls);
static String rHost, rUser, rPass, devId;
static bool rEnabled = false;
static volatile bool rCfgChanged = false;
static volatile bool mqttUp = false;
static volatile bool statusWanted = false, reportsWanted = false;
static SemaphoreHandle_t mx;                 // protects outStatus / outReports and the r* config copy
static String outStatus, outReports;
static volatile bool outStatusNew = false, outReportsNew = false;
static QueueHandle_t cmdQ, resQ;             // String* hand-off between the MQTT task and loop()
static uint32_t lastStatusBuild = 0;

// leds
static uint32_t ledTestUntil = 0, ledTestStart = 0;
static int16_t lastR[NUM_BOXES], lastG[NUM_BOXES];

// melody player
static const Note* mNotes = nullptr;
static uint8_t mLen = 0, mIdx = 0;
static bool mActive = false, mInTone = false;
static uint32_t mT = 0;
static uint32_t lastDueMelody = 0;

// buttons
static uint32_t silenceDownSince = 0;
static bool silenceWasDown = false;
static uint32_t bootDownSince = 0;

// =====================================================================
//  SMALL HELPERS
// =====================================================================
static uint32_t windowEnd(int32_t dueSec) {
  uint32_t e = (uint32_t)dueSec + GRACE_SEC;
  return e > 86399 ? 86399 : e;          // clamp at 23:59:59
}

static String fmtHHMM(int32_t s) {
  if (s < 0) return "";
  char b[8];
  snprintf(b, sizeof(b), "%02d:%02d", (int)(s / 3600), (int)((s % 3600) / 60));
  return String(b);
}

static bool apClient() {
  IPAddress a = WiFi.softAPIP(), c = server.client().remoteIP();
  return portalActive && a[0] == c[0] && a[1] == c[1] && a[2] == c[2];
}

// =====================================================================
//  FILE HELPERS
// =====================================================================
static bool writeJsonAtomic(const char* path, JsonDocument& doc) {
  String tmp = String(path) + ".tmp";
  File f = LittleFS.open(tmp, "w");
  if (!f) return false;
  size_t n = serializeJson(doc, f);
  f.close();
  if (n == 0) { LittleFS.remove(tmp); return false; }
  LittleFS.remove(path);
  return LittleFS.rename(tmp, path);
}

static void countReports() {
  reportCount = 0;
  File f = LittleFS.open(REPORTS_FILE, "r");
  if (!f) return;
  while (f.available()) {
    String l = f.readStringUntil('\n');
    l.trim();
    if (l.length()) reportCount++;
  }
  f.close();
}

static void rollReports() {
  if (reportCount <= MAX_REPORTS) return;
  size_t skip = reportCount - MAX_REPORTS;
  File r = LittleFS.open(REPORTS_FILE, "r");
  File w = LittleFS.open("/reports.tmp", "w");
  if (!r || !w) { if (r) r.close(); if (w) w.close(); return; }
  size_t i = 0, kept = 0;
  while (r.available()) {
    String l = r.readStringUntil('\n');
    l.trim();
    if (!l.length()) continue;
    if (i++ < skip) continue;
    w.print(l);
    w.print('\n');
    kept++;
  }
  r.close(); w.close();
  LittleFS.remove(REPORTS_FILE);
  LittleFS.rename("/reports.tmp", REPORTS_FILE);
  reportCount = kept;
}

static bool appendReport(JsonDocument& doc) {
  String line;
  serializeJson(doc, line);
  File f = LittleFS.open(REPORTS_FILE, "a");
  if (!f) return false;
  f.print(line);
  f.print('\n');
  f.close();
  reportCount++;
  rollReports();
  reportsDirty = true; reportsDirtyAt = millis();
  return true;
}

// =====================================================================
//  LEDs
// =====================================================================
static uint8_t brightLevel() {
  uint32_t b = S.brightness;
  if (b == 0) return 0;
  uint32_t v = (b * b * 255UL) / 10000UL;   // squared = roughly perceptual
  return v < 2 ? 2 : (uint8_t)v;
}

static void ledPut(uint8_t pin, int16_t level, int16_t* cache) {
  if (*cache == level) return;
  *cache = level;
  ledcWrite(pin, COMMON_ANODE ? (255 - level) : level);
}

static void updateLeds() {
  uint8_t full = brightLevel();
  uint32_t now = millis();
  bool testing = now < ledTestUntil;
  int phase = testing ? (int)(((now - ledTestStart) / 700) % 3) : 0;
  for (uint8_t i = 0; i < NUM_BOXES; i++) {
    int16_t r = 0, g = 0;
    if (testing) {
      r = (phase == 0) ? full : 0;
      g = (phase == 1) ? full : 0;
    } else {
      Box& b = boxes[i];
      switch (b.st) {
        case ST_DUE:
          if (b.open) g = full;
          else r = (((now / 400) & 1) == 0) ? full : 0;
          break;
        case ST_TAKEN:
          if (now - b.since < TAKEN_LED_MS) g = full;
          break;
        case ST_MISSED:
          r = full ? (full / 4 < 1 ? 1 : full / 4) : 0;   // dim red
          break;
        default: break;
      }
    }
    ledPut(PIN_LED_R[i], r, &lastR[i]);
    ledPut(PIN_LED_G[i], g, &lastG[i]);
  }
}

// =====================================================================
//  BUZZER / MELODY PLAYER (non-blocking)
// =====================================================================
static float midiToHz(uint8_t m) { return 440.0f * powf(2.0f, ((int)m - 69) / 12.0f); }

static void buzzOff() { ledcWrite(PIN_BUZZER, 0); }

static void buzzOn(float hz) {
  ledcChangeFrequency(PIN_BUZZER, (uint32_t)hz, BUZ_PWM_BITS);
  uint32_t duty = (511UL * S.volume) / 100UL;       // volume 0..100 -> duty 0..50 %
  ledcWrite(PIN_BUZZER, duty);
}

static void melodyStop() { mActive = false; mInTone = false; buzzOff(); }

static void melodyStart(const Note* n, uint8_t len) {
  if (S.muted || S.volume == 0) return;
  buzzOff();
  mNotes = n; mLen = len; mIdx = 0;
  mActive = true; mInTone = false;
  mT = millis() - NOTE_GAP_MS;          // first note starts immediately
}
#define PLAY(arr) melodyStart(arr, sizeof(arr) / sizeof(arr[0]))

static void melodyTick() {
  if (!mActive) return;
  uint32_t now = millis();
  if (!mInTone) {
    if (now - mT < NOTE_GAP_MS) return;
    buzzOn(midiToHz(mNotes[mIdx].midi));
    mInTone = true; mT = now;
  } else if (now - mT >= mNotes[mIdx].ms) {
    buzzOff();
    mInTone = false; mT = now;
    if (++mIdx >= mLen) mActive = false;
  }
}

// =====================================================================
//  LDR
// =====================================================================
static int openThreshold(int base) {
  int t = (int)(base * LDR_DELTA_FRAC);
  return t < LDR_MIN_DELTA ? LDR_MIN_DELTA : t;
}

static void calibrate() {
  for (uint8_t i = 0; i < NUM_BOXES; i++) {
    long sum = 0;
    for (int k = 0; k < 32; k++) { sum += analogRead(PIN_LDR[i]); delayMicroseconds(500); }
    Box& b = boxes[i];
    b.baseline = (int)(sum / 32);
    b.ldr = b.baseline;
    b.open = false; b.pending = false;
    int th = openThreshold(b.baseline);
    // is there enough ADC headroom to ever see the change?
    b.ldrOk = OPEN_IS_LOW ? (b.baseline > th + 100) : (b.baseline < 4095 - th - 100);
  }
}

static void ldrTick() {
  static uint32_t last = 0;
  uint32_t now = millis();
  if (now - last < LDR_SAMPLE_MS) return;
  last = now;
  for (uint8_t i = 0; i < NUM_BOXES; i++) {
    Box& b = boxes[i];
    int raw = analogRead(PIN_LDR[i]);
    b.ldr = (b.ldr * 3 + raw) / 4;
    int th = openThreshold(b.baseline);
    int delta = OPEN_IS_LOW ? (b.baseline - b.ldr) : (b.ldr - b.baseline);
    bool want = b.open ? (delta > th / 2) : (delta > th);   // hysteresis
    if (want != b.open) {
      if (!b.pending) { b.pending = true; b.pendSince = now; }
      else if (now - b.pendSince >= LDR_DEBOUNCE_MS) { b.open = want; b.pending = false; }
    } else {
      b.pending = false;
    }
  }
}

// =====================================================================
//  OWNER / MEDS (from users.json)
// =====================================================================
static int32_t parseHHMM(const char* t) {
  int h, m;
  if (!t || sscanf(t, "%d:%d", &h, &m) != 2) return -1;
  if (h < 0 || h > 23 || m < 0 || m > 59) return -1;
  return h * 3600 + m * 60;
}

static bool userExists(const String& username) {
  File f = LittleFS.open(USERS_FILE, "r");
  if (!f) return false;
  JsonDocument doc;
  if (deserializeJson(doc, f) || !doc.is<JsonArray>()) return false;
  for (JsonVariant v : doc.as<JsonArray>()) {
    const char* u = v["username"] | "";
    if (username == u) return true;
  }
  return false;
}

// fills names/dues; sets ownerUsername/ownerName
static void loadOwnerMeds(String names[NUM_BOXES], int32_t dues[NUM_BOXES]) {
  for (uint8_t i = 0; i < NUM_BOXES; i++) { names[i] = ""; dues[i] = -1; }
  ownerUsername = ""; ownerName = "";
  File f = LittleFS.open(USERS_FILE, "r");
  if (!f) return;
  JsonDocument doc;
  if (deserializeJson(doc, f) || !doc.is<JsonArray>()) return;
  String want = prefs.getString("owner", "");
  JsonObject chosen;
  if (want.length()) {
    for (JsonVariant v : doc.as<JsonArray>()) {
      const char* u = v["username"] | "";
      if (want == u) { chosen = v.as<JsonObject>(); break; }
    }
  }
  if (chosen.isNull()) {
    for (JsonVariant v : doc.as<JsonArray>()) {
      const char* role = v["role"] | "";
      if (strcmp(role, "patient") == 0) { chosen = v.as<JsonObject>(); break; }
    }
  }
  if (chosen.isNull()) return;
  ownerUsername = String((const char*)(chosen["username"] | ""));
  ownerName = String((const char*)(chosen["name"] | ""));
  JsonObject meds = chosen["meds"];
  if (meds.isNull()) return;
  for (uint8_t i = 0; i < NUM_BOXES; i++) {
    JsonObject m = meds[String(i + 1)];
    if (m.isNull()) continue;
    String nm = String((const char*)(m["name"] | ""));
    int32_t d = parseHHMM(m["time"] | "");
    nm.trim();
    if (nm.length() && d >= 0) { names[i] = nm; dues[i] = d; }
  }
}

// =====================================================================
//  SCHEDULE ENGINE
// =====================================================================
static void enterDue(Box& b) {
  b.st = ST_DUE; b.since = millis();
  b.openedSeen = false; b.silenced = false;
  lastDueMelody = millis() - DUE_REPEAT_MS;     // play at next tick
}

static void applyBox(Box& b) {
  b.test = false; b.openedSeen = false; b.silenced = false;
  if (b.dueSec < 0) { b.st = ST_EMPTY; return; }
  if (!engineReady) { b.st = ST_WAITING; return; }
  uint32_t end = windowEnd(b.dueSec);
  if ((uint32_t)secOfDay < (uint32_t)b.dueSec) b.st = ST_WAITING;
  else if ((uint32_t)secOfDay < end) enterDue(b);
  else b.st = ST_SKIPPED;                        // window already passed: never log a false miss
  b.since = millis();
}

// keep=true: boxes whose name+time did not change keep their state (schedule edit)
static void applySchedule(bool keep) {
  String names[NUM_BOXES]; int32_t dues[NUM_BOXES];
  loadOwnerMeds(names, dues);
  for (uint8_t i = 0; i < NUM_BOXES; i++) {
    Box& b = boxes[i];
    bool same = keep && !b.test && b.name == names[i] && b.dueSec == dues[i] && engineReady;
    b.name = names[i]; b.dueSec = dues[i];
    if (!same) applyBox(b);
  }
}

static void logDose(Box& b, uint8_t idx, const char* status) {
  JsonDocument d;
  uint32_t ep = (uint32_t)time(nullptr);
  char date[12];
  strftime(date, sizeof(date), "%Y-%m-%d", &nowTm);
  d["id"] = String("d") + ep + "-" + (idx + 1);
  d["kind"] = "dose";
  d["ts"] = ep;
  d["date"] = date;
  d["user"] = ownerUsername;
  d["box"] = idx + 1;
  d["med"] = b.name;
  d["status"] = status;
  d["source"] = "box";
  appendReport(d);
}

static void updateClock() {
  uint32_t now = millis();
  if (now - lastClockMs < 250) return;
  lastClockMs = now;
  time_t t = time(nullptr);
  bool synced = t > 1700000000;           // anything after Nov 2023 = NTP worked
  if (!synced) { timeSynced = false; return; }
  localtime_r(&t, &nowTm);
  timeSynced = true;
  secOfDay = nowTm.tm_hour * 3600 + nowTm.tm_min * 60 + nowTm.tm_sec;
  int dk = nowTm.tm_year * 400 + nowTm.tm_yday;
  if (!engineReady) {                     // first sync = boot semantics
    engineReady = true;
    dayKey = dk;
    applySchedule(false);
  } else if (dk != dayKey) {              // midnight reset
    dayKey = dk;
    applySchedule(false);
  }
}

static void engineTick() {
  if (!engineReady) return;
  uint32_t ms = millis();
  bool anyDue = false;
  for (uint8_t i = 0; i < NUM_BOXES; i++) {
    Box& b = boxes[i];
    if (b.test && ms > b.testExpire) {    // revert a test state
      b.test = false; b.st = b.prevSt; b.openedSeen = false;
    }
    if (b.dueSec < 0 && !b.test) continue;
    uint32_t end = b.dueSec >= 0 ? windowEnd(b.dueSec) : 0;
    switch (b.st) {
      case ST_WAITING:
        if ((uint32_t)secOfDay >= (uint32_t)b.dueSec) {
          if ((uint32_t)secOfDay >= end) b.st = ST_SKIPPED;
          else enterDue(b);
        }
        break;
      case ST_DUE:
        if (b.open) b.openedSeen = true;
        if (b.openedSeen && !b.open) {                       // opened then closed = taken
          b.st = ST_TAKEN; b.since = ms;
          if (!b.test) logDose(b, i, "taken");
          PLAY(MEL_TAKEN);
        } else if (!b.openedSeen && !b.test && (uint32_t)secOfDay >= end) {
          b.st = ST_MISSED; b.since = ms;
          logDose(b, i, "missed");
          PLAY(MEL_MISSED);
        }
        break;
      default: break;
    }
    if (b.st == ST_DUE && !b.silenced) anyDue = true;
    if (b.st != ST_DUE) b.silenced = false;
  }
  if (anyDue && !mActive && ms - lastDueMelody >= DUE_REPEAT_MS) {
    lastDueMelody = ms;
    PLAY(MEL_DUE);
  }
}

static void forceTest(uint8_t i, BoxState st) {
  Box& b = boxes[i];
  if (!b.test) b.prevSt = b.st;
  b.test = true; b.testExpire = millis() + TEST_HOLD_MS;
  b.openedSeen = false; b.silenced = false;
  b.st = st; b.since = millis();
  if (st == ST_DUE) { lastDueMelody = millis() - DUE_REPEAT_MS; }
}

// =====================================================================
//  BUTTONS
// =====================================================================
static void buttonsTick() {
  uint32_t now = millis();
  // silence (debounced press)
  bool down = digitalRead(PIN_BTN_SILENCE) == LOW;
  if (down && !silenceWasDown) silenceDownSince = now;
  if (down && silenceWasDown && silenceDownSince && now - silenceDownSince > 50) {
    silenceDownSince = 0;
    melodyStop();
    for (uint8_t i = 0; i < NUM_BOXES; i++) if (boxes[i].st == ST_DUE) boxes[i].silenced = true;
  }
  if (!down) silenceDownSince = 0;
  silenceWasDown = down;
  // BOOT hold 3 s = forget WiFi only
  if (digitalRead(PIN_BTN_BOOT) == LOW) {
    if (!bootDownSince) bootDownSince = now;
    else if (now - bootDownSince >= BOOT_HOLD_MS) {
      prefs.remove("ssid"); prefs.remove("pass");
      PLAY(MEL_MISSED);
      restartAt = now + 800;
      bootDownSince = 0;
    }
  } else bootDownSince = 0;
}

// =====================================================================
//  NETWORK
// =====================================================================
static void onWifiConnected() {
  configTzTime(TZ_EGYPT, NTP_1, NTP_2);
  if (MDNS.begin(MDNS_NAME)) MDNS.addService("http", "tcp", 80);
  PLAY(MEL_READY);
  Serial.print("WiFi OK, IP: "); Serial.println(WiFi.localIP());
}

static void startPortal() {
  if (portalActive) return;
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAP(AP_SSID, AP_PASS);
  dns.start(53, "*", WiFi.softAPIP());
  portalActive = true;
  lastPortalRetry = millis();
  Serial.print("Portal up: "); Serial.println(WiFi.softAPIP());
}

static void stopPortal() {
  if (!portalActive) return;
  dns.stop();
  WiFi.softAPdisconnect(true);
  WiFi.mode(WIFI_STA);
  portalActive = false;
}

static void netTick() {
  uint32_t now = millis();
  if (portalActive) {
    dns.processNextRequest();
    if (WiFi.status() == WL_CONNECTED) { stopPortal(); }
    else if (prefs.getString("ssid", "").length() && now - lastPortalRetry >= PORTAL_RETRY_MS) {
      lastPortalRetry = now;
      WiFi.begin(prefs.getString("ssid", "").c_str(), prefs.getString("pass", "").c_str());
    }
  }
  bool conn = WiFi.status() == WL_CONNECTED;
  if (conn && !wasConnected) { wasConnected = true; staLostSince = 0; onWifiConnected(); }
  if (!conn) {
    wasConnected = false;
    if (!portalActive) {
      if (!staLostSince) staLostSince = now;
      else if (now - staLostSince > STA_LOST_PORTAL_MS) startPortal();
    }
  } else staLostSince = 0;
}

// =====================================================================
//  HTTP HELPERS
// =====================================================================
static void cors() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
  server.sendHeader("Access-Control-Allow-Private-Network", "true");
}

static void sendJson(int code, JsonDocument& doc) {
  String out;
  serializeJson(doc, out);
  cors();
  server.send(code, "application/json", out);
}

static void sendMsg(int code, const char* key, const char* val) {
  JsonDocument d;
  d[key] = val;
  sendJson(code, d);
}

static bool readBody(JsonDocument& doc, size_t maxLen) {
  String body = server.arg("plain");
  if (body.length() == 0 || body.length() > maxLen) {
    sendMsg(body.length() ? 413 : 400, "error", body.length() ? "body too large" : "empty body");
    return false;
  }
  DeserializationError e = deserializeJson(doc, body);
  if (e) { sendMsg(400, "error", "bad json"); return false; }
  return true;
}

static const char* mimeFor(const String& p) {
  if (p.endsWith(".html") || p.endsWith(".htm")) return "text/html; charset=utf-8";
  if (p.endsWith(".css")) return "text/css; charset=utf-8";
  if (p.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (p.endsWith(".json")) return "application/json";
  if (p.endsWith(".svg")) return "image/svg+xml";
  if (p.endsWith(".png")) return "image/png";
  if (p.endsWith(".ico")) return "image/x-icon";
  if (p.endsWith(".woff2")) return "font/woff2";
  return "application/octet-stream";
}

// serves /path or /path.gz (pre-gzipped) from LittleFS
static bool serveFile(String path) {
  if (path.indexOf("..") >= 0) return false;
  if (path.endsWith("/")) path += "index.html";
  String real = path; bool gz = false;
  if (LittleFS.exists(path + ".gz")) { real = path + ".gz"; gz = true; }
  else if (!LittleFS.exists(path)) return false;
  File f = LittleFS.open(real, "r");
  if (!f || f.isDirectory()) return false;
  if (gz) server.sendHeader("Content-Encoding", "gzip");
  server.sendHeader("Cache-Control", "public, max-age=60");
  cors();
  server.streamFile(f, mimeFor(path));
  f.close();
  return true;
}

static void redirectToSetup() {
  server.sendHeader("Location", String("http://") + WiFi.softAPIP().toString() + "/setup");
  server.send(302, "text/plain", "");
}

// =====================================================================
//  PORTAL PAGE
// =====================================================================
static const char SETUP_HTML[] PROGMEM = R"HTML(<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Nura Box Setup</title>
<style>body{font-family:sans-serif;background:#0f172a;color:#f8fafc;margin:0;padding:18px}
.c{max-width:420px;margin:auto;background:#1e293b;border-radius:16px;padding:20px}
h2{margin-top:0}select,input,button{width:100%;padding:12px;margin:8px 0;border-radius:10px;border:1px solid #334155;background:#0f172a;color:#fff;font-size:16px;box-sizing:border-box}
button{background:#38bdf8;color:#000;font-weight:700;border:0}#m{font-size:14px;color:#94a3b8}</style></head><body><div class="c">
<h2>Nura Box - WiFi / إعداد الواي فاي</h2>
<select id="s"><option>...</option></select><input id="n" placeholder="SSID (manual / يدوي)">
<input id="p" type="password" placeholder="Password / كلمة السر">
<button onclick="save()">Save / حفظ</button><button onclick="scan(true)" style="background:#334155;color:#fff">Rescan / بحث</button>
<div id="m"></div></div><script>
var s=document.getElementById('s'),m=document.getElementById('m');
function scan(r){m.textContent='...';fetch('/api/wifi/scan'+(r?'?rescan=1':'')).then(x=>x.json()).then(d=>{
if(d.scanning){setTimeout(()=>scan(false),1500);return}
s.innerHTML='';d.networks.forEach(n=>{var o=document.createElement('option');o.value=n.ssid;o.textContent=n.ssid+' ('+n.rssi+')';s.appendChild(o)});m.textContent=''}).catch(()=>m.textContent='scan failed')}
function save(){var ssid=document.getElementById('n').value||s.value;if(!ssid)return;
fetch('/api/wifi',{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify({ssid:ssid,pass:document.getElementById('p').value})})
.then(x=>x.json()).then(d=>m.textContent=d.ok?'Saved. Restarting... / تم الحفظ، جاري إعادة التشغيل':(d.error||'error'))}
scan(true);</script></body></html>)HTML";

// =====================================================================
//  API HANDLERS
// =====================================================================
static void hUsersGet() {
  cors();
  File f = LittleFS.open(USERS_FILE, "r");
  if (!f) { server.send(200, "application/json", "[]"); return; }
  server.streamFile(f, "application/json");
  f.close();
}

static void hUsersPost() {
  JsonDocument doc;
  if (!readBody(doc, MAX_USERS_BODY)) return;
  if (!doc.is<JsonArray>()) { sendMsg(400, "error", "array expected"); return; }
  JsonArray arr = doc.as<JsonArray>();
  if (arr.size() > MAX_USERS) { sendMsg(409, "error", "max 10 users"); return; }
  for (JsonVariant v : arr) {
    if (!v.is<JsonObject>() || !v["username"].is<const char*>()) { sendMsg(400, "error", "bad user"); return; }
  }
  if (!writeJsonAtomic(USERS_FILE, doc)) { sendMsg(500, "error", "write failed"); return; }
  applySchedule(true);
  JsonDocument r; r["ok"] = true; r["count"] = arr.size();
  sendJson(200, r);
}

static void hReportsGet() {
  cors();
  server.setContentLength(CONTENT_LENGTH_UNKNOWN);
  server.send(200, "application/json", "");
  server.sendContent("[");
  File f = LittleFS.open(REPORTS_FILE, "r");
  bool first = true;
  if (f) {
    while (f.available()) {
      String l = f.readStringUntil('\n');
      l.trim();
      if (!l.length()) continue;
      if (!first) server.sendContent(",");
      server.sendContent(l);
      first = false;
    }
    f.close();
  }
  server.sendContent("]");
  server.sendContent("");
}

static void hReportPost() {
  JsonDocument doc;
  if (!readBody(doc, MAX_REPORT_BODY)) return;
  if (!doc.is<JsonObject>()) { sendMsg(400, "error", "object expected"); return; }
  if (doc["ts"].isNull() && timeSynced) doc["ts"] = (uint32_t)time(nullptr);
  if (!appendReport(doc)) { sendMsg(500, "error", "write failed"); return; }
  JsonDocument r; r["ok"] = true;
  sendJson(201, r);
}

static void fillStatus(JsonDocument& d) {
  d["fw"] = FW_VERSION;
  d["synced"] = timeSynced;
  d["engine"] = engineReady;
  if (timeSynced) {
    char b[24];
    strftime(b, sizeof(b), "%H:%M:%S", &nowTm); d["time"] = b;
    strftime(b, sizeof(b), "%Y-%m-%d", &nowTm); d["date"] = b;
    d["epoch"] = (uint32_t)time(nullptr);
  } else { d["time"] = "--:--:--"; d["date"] = ""; d["epoch"] = 0; }
  d["ip"] = WiFi.localIP().toString();
  d["ssid"] = WiFi.SSID();
  d["rssi"] = WiFi.status() == WL_CONNECTED ? WiFi.RSSI() : 0;
  d["mode"] = portalActive ? "portal" : "sta";
  d["uptime"] = millis() / 1000;
  d["owner"] = ownerUsername;
  d["ownerName"] = ownerName;
  d["ownerPinned"] = prefs.getString("owner", "").length() > 0;
  d["devId"] = devId;
  JsonObject rm = d["remote"].to<JsonObject>();
  rm["enabled"] = rEnabled; rm["connected"] = mqttUp; rm["host"] = rHost;
  JsonObject st = d["settings"].to<JsonObject>();
  st["volume"] = S.volume; st["brightness"] = S.brightness; st["muted"] = S.muted;
  JsonArray arr = d["boxes"].to<JsonArray>();
  for (uint8_t i = 0; i < NUM_BOXES; i++) {
    Box& b = boxes[i];
    JsonObject o = arr.add<JsonObject>();
    o["box"] = i + 1;
    o["name"] = b.name;
    o["time"] = fmtHHMM(b.dueSec);
    o["state"] = STATE_NAME[b.st];
    o["ldr"] = b.ldr;
    o["baseline"] = b.baseline;
    o["open"] = b.open;
    o["ldrOk"] = b.ldrOk;
    o["silenced"] = b.silenced;
    o["test"] = b.test;
  }
}

static void hStatus() {
  JsonDocument d;
  fillStatus(d);
  sendJson(200, d);
}

static bool doTest(const String& a, int box) {
  if (box < 0 || box >= NUM_BOXES) box = 0;
  if (a == "leds") { ledTestStart = millis(); ledTestUntil = ledTestStart + 4200; }
  else if (a == "due")    { forceTest(box, ST_DUE); }
  else if (a == "taken")  { forceTest(box, ST_TAKEN); PLAY(MEL_TAKEN); }
  else if (a == "missed") { forceTest(box, ST_MISSED); PLAY(MEL_MISSED); }
  else if (a == "reset")  { for (uint8_t i = 0; i < NUM_BOXES; i++) if (boxes[i].test) { boxes[i].test = false; boxes[i].st = boxes[i].prevSt; } melodyStop(); ledTestUntil = 0; }
  else return false;
  return true;
}

static void hTest() {
  JsonDocument doc;
  if (!readBody(doc, 256)) return;
  String a = doc["action"] | "";
  if (!doTest(a, (int)(doc["box"] | 1) - 1)) { sendMsg(400, "error", "unknown action"); return; }
  JsonDocument r; r["ok"] = true; r["action"] = a;
  sendJson(200, r);
}

static void hCalibrate() {
  calibrate();
  JsonDocument r; r["ok"] = true;
  JsonArray arr = r["baseline"].to<JsonArray>();
  for (uint8_t i = 0; i < NUM_BOXES; i++) arr.add(boxes[i].baseline);
  sendJson(200, r);
}

static bool setOwner(String owner) {
  owner.trim();
  if (owner.length() && !userExists(owner)) return false;
  if (owner.length()) prefs.putString("owner", owner); else prefs.remove("owner");
  applySchedule(true);
  return true;
}

static void hDevice() {
  JsonDocument doc;
  if (!readBody(doc, 256)) return;
  if (!setOwner(String((const char*)(doc["owner"] | "")))) { sendMsg(404, "error", "user not found"); return; }
  JsonDocument r; r["ok"] = true; r["owner"] = ownerUsername;
  sendJson(200, r);
}

static void hSettingsGet() {
  JsonDocument d;
  d["volume"] = S.volume; d["brightness"] = S.brightness; d["muted"] = S.muted;
  sendJson(200, d);
}

static void applySettings(JsonVariant doc) {
  if (doc["volume"].is<int>())     S.volume = constrain((int)doc["volume"], 0, 100);
  if (doc["brightness"].is<int>()) S.brightness = constrain((int)doc["brightness"], 0, 100);
  if (doc["muted"].is<bool>())     S.muted = doc["muted"];
  prefs.putUChar("vol", S.volume); prefs.putUChar("bri", S.brightness); prefs.putBool("mute", S.muted);
  if (S.muted) melodyStop();
}

static void hSettingsPost() {
  JsonDocument doc;
  if (!readBody(doc, 256)) return;
  applySettings(doc.as<JsonVariant>());
  hSettingsGet();
}

static void hWifiScan() {
  if (!portalActive) { sendMsg(403, "error", "portal not active"); return; }
  int n = WiFi.scanComplete();
  if (server.hasArg("rescan") || n == WIFI_SCAN_FAILED) {
    if (n != WIFI_SCAN_RUNNING) { WiFi.scanDelete(); WiFi.scanNetworks(true); }
    JsonDocument d; d["scanning"] = true; sendJson(200, d); return;
  }
  if (n == WIFI_SCAN_RUNNING) { JsonDocument d; d["scanning"] = true; sendJson(200, d); return; }
  JsonDocument d;
  d["scanning"] = false;
  JsonArray arr = d["networks"].to<JsonArray>();
  for (int i = 0; i < n && i < 20; i++) {
    JsonObject o = arr.add<JsonObject>();
    o["ssid"] = WiFi.SSID(i); o["rssi"] = WiFi.RSSI(i);
  }
  sendJson(200, d);
}

static void hWifiSave() {
  if (!portalActive) { sendMsg(403, "error", "portal not active"); return; }
  JsonDocument doc;
  if (!readBody(doc, 512)) return;
  String ssid = doc["ssid"] | "", pass = doc["pass"] | "";
  if (ssid.length() < 1 || ssid.length() > 32 || pass.length() > 63) { sendMsg(400, "error", "bad ssid/pass"); return; }
  prefs.putString("ssid", ssid); prefs.putString("pass", pass);
  restartAt = millis() + 1500;
  JsonDocument r; r["ok"] = true;
  sendJson(200, r);
}

// replace ONE user's medicines (used by the remote "meds" command); everything else in users.json is untouched
static bool updateMeds(const String& user, JsonVariantConst meds) {
  File f = LittleFS.open(USERS_FILE, "r");
  if (!f) return false;
  JsonDocument doc;
  DeserializationError e = deserializeJson(doc, f);
  f.close();
  if (e || !doc.is<JsonArray>()) return false;
  JsonObject target;
  for (JsonVariant v : doc.as<JsonArray>()) {
    const char* un = v["username"] | "";
    if (user == un) { target = v.as<JsonObject>(); break; }
  }
  if (target.isNull()) return false;
  JsonObject nm = target["meds"].to<JsonObject>();
  for (uint8_t i = 1; i <= NUM_BOXES; i++) {
    JsonVariantConst m = meds[String(i)];
    const char* name = m["name"] | "";
    const char* time = m["time"] | "";
    if (!name[0] || strlen(name) > 40 || parseHHMM(time) < 0) continue;
    JsonObject o = nm[String(i)].to<JsonObject>();
    o["name"] = name; o["time"] = time;
  }
  if (!writeJsonAtomic(USERS_FILE, doc)) return false;
  applySchedule(true);
  return true;
}

static void hRemoteGet() {
  JsonDocument d;
  d["enabled"] = rEnabled; d["host"] = rHost; d["user"] = rUser; d["hasPass"] = rPass.length() > 0;
  d["connected"] = mqttUp; d["devId"] = devId;
  sendJson(200, d);
}

static void hRemotePost() {
  JsonDocument doc;
  if (!readBody(doc, 512)) return;
  String host = doc["host"] | "", user = doc["user"] | "", pass = doc["pass"] | "";
  bool en = doc["enabled"] | true;
  host.trim(); user.trim();
  host.replace("mqtts://", ""); host.replace("ssl://", ""); host.replace("https://", ""); host.replace("wss://", "");
  int c = host.indexOf(':'); if (c > 0) host = host.substring(0, c);
  int sl = host.indexOf('/'); if (sl > 0) host = host.substring(0, sl);
  if (en && (host.length() < 4 || host.length() > 80 || user.length() > 64 || pass.length() > 64)) { sendMsg(400, "error", "bad remote config"); return; }
  xSemaphoreTake(mx, portMAX_DELAY);
  rHost = host; rUser = user; if (pass.length()) rPass = pass; rEnabled = en;      // blank pass = keep the saved one
  xSemaphoreGive(mx);
  prefs.putString("rhost", rHost); prefs.putString("ruser", rUser); prefs.putString("rpass", rPass); prefs.putBool("ren", rEnabled);
  rCfgChanged = true;
  JsonDocument r; r["ok"] = true; r["devId"] = devId;
  sendJson(200, r);
}

static void hRoot() {
  if (portalActive && apClient()) { redirectToSetup(); return; }
  if (!serveFile("/")) {
    cors();
    server.send(200, "text/plain", "Nura Box firmware v" FW_VERSION " is running, but index.html is missing. Upload the data/ folder to LittleFS.");
  }
}

static void hSetup() {
  if (!portalActive) { server.sendHeader("Location", "/"); server.send(302, "text/plain", ""); return; }
  server.send_P(200, "text/html; charset=utf-8", SETUP_HTML);
}

static void hNotFound() {
  if (server.method() == HTTP_OPTIONS) { cors(); server.send(204); return; }
  String uri = server.uri();
  if (server.method() == HTTP_GET || server.method() == HTTP_HEAD) {
    if (portalActive && apClient() && !uri.startsWith("/api/")) { redirectToSetup(); return; }
    if (!uri.startsWith("/api/") && serveFile(uri)) return;
  }
  sendMsg(404, "error", "not found");
}

// =====================================================================
//  REMOTE ACCESS (MQTT over TLS)
//  Runs in its own FreeRTOS task on core 0 so a slow TLS handshake never stalls loop().
//  Hand-off with loop() is by queues / one mutex only: engine state is touched ONLY from loop().
//  Topics (devId = 8 hex chars, shown in /api/status):
//    nurabox/<devId>/status   retained  full status JSON every 5 s
//    nurabox/<devId>/reports  retained  last 40 DOSE records only (no symptoms, no doctor notes)
//    nurabox/<devId>/online   retained  "1" / "0" (last-will)
//    nurabox/<devId>/cmd      <- commands from the website
//    nurabox/<devId>/res      -> command results
//  Commands (JSON): {"id","cmd":"test","action","box"} {"cmd":"calibrate"} {"cmd":"settings","volume","brightness","muted"}
//                   {"cmd":"owner","owner"} {"cmd":"meds","user","meds":{"1":{"name","time"},...}}
//  TLS note: setInsecure() = traffic is encrypted but the broker certificate is NOT verified (documented limitation).
// =====================================================================
static String topicOf(const char* leaf) { return String("nurabox/") + devId + "/" + leaf; }

static void onMqttMsg(char* topic, byte* payload, unsigned int len) {
  if (len == 0 || len > 3000) return;
  String t(topic);
  if (!t.endsWith("/cmd")) return;
  String* s = new String();
  s->reserve(len + 1);
  for (unsigned int i = 0; i < len; i++) *s += (char)payload[i];
  if (xQueueSend(cmdQ, &s, 0) != pdTRUE) delete s;
}

static void mqttTask(void*) {
  uint32_t lastTry = 0;
  String host, user, pass, cid;
  for (;;) {
    if (rCfgChanged) { rCfgChanged = false; if (mqtt.connected()) mqtt.disconnect(); mqttUp = false; lastTry = 0; }
    bool want = rEnabled && rHost.length() && WiFi.status() == WL_CONNECTED;
    if (!want) {
      if (mqtt.connected()) mqtt.disconnect();
      mqttUp = false;
      vTaskDelay(pdMS_TO_TICKS(500));
      continue;
    }
    if (!mqtt.connected()) {
      mqttUp = false;
      uint32_t now = millis();
      if (lastTry && now - lastTry < MQTT_RETRY_MS) { vTaskDelay(pdMS_TO_TICKS(250)); continue; }
      lastTry = now;
      xSemaphoreTake(mx, portMAX_DELAY);
      host = rHost; user = rUser; pass = rPass;
      xSemaphoreGive(mx);
      tls.setInsecure();
      tls.setTimeout(6);                              // seconds in core 3.x
      mqtt.setServer(host.c_str(), MQTT_PORT_TLS);
      mqtt.setBufferSize(MQTT_BUF);
      mqtt.setKeepAlive(30);
      mqtt.setCallback(onMqttMsg);
      cid = "nurabox-" + devId;
      String will = topicOf("online");
      if (mqtt.connect(cid.c_str(), user.c_str(), pass.c_str(), will.c_str(), 1, true, "0")) {
        mqtt.publish(will.c_str(), "1", true);
        mqtt.subscribe(topicOf("cmd").c_str(), 1);
        mqttUp = true; statusWanted = true; reportsWanted = true;
      }
      continue;
    }
    mqtt.loop();
    if (outStatusNew || outReportsNew || uxQueueMessagesWaiting(resQ)) {
      String st, rp; bool hs = false, hr = false;
      xSemaphoreTake(mx, portMAX_DELAY);
      if (outStatusNew)  { st = outStatus;  outStatusNew = false;  hs = true; }
      if (outReportsNew) { rp = outReports; outReportsNew = false; hr = true; }
      xSemaphoreGive(mx);
      if (hs) mqtt.publish(topicOf("status").c_str(),  (const uint8_t*)st.c_str(), st.length(), true);
      if (hr) mqtt.publish(topicOf("reports").c_str(), (const uint8_t*)rp.c_str(), rp.length(), true);
      String* r;
      while (xQueueReceive(resQ, &r, 0) == pdTRUE) { mqtt.publish(topicOf("res").c_str(), r->c_str(), false); delete r; }
    }
    vTaskDelay(pdMS_TO_TICKS(20));
  }
}

static void buildReportsSnapshot(String& out) {
  const uint8_t N = REPORTS_SNAPSHOT_N;
  String* ring = new String[N];
  uint8_t n = 0, head = 0;
  File f = LittleFS.open(REPORTS_FILE, "r");
  if (f) {
    while (f.available()) {
      String l = f.readStringUntil('\n');
      l.trim();
      if (!l.length() || l.indexOf("\"kind\":\"dose\"") < 0) continue;     // dose records only: no medical free text leaves the LAN
      ring[head] = l; head = (head + 1) % N; if (n < N) n++;
    }
    f.close();
  }
  out = "[";
  for (uint8_t i = 0; i < n; i++) { if (i) out += ','; out += ring[(head + N - n + i) % N]; }
  out += "]";
  delete[] ring;
}

static void cmdTick() {
  String* p;
  while (cmdQ && xQueueReceive(cmdQ, &p, 0) == pdTRUE) {
    JsonDocument doc;
    DeserializationError e = deserializeJson(doc, *p);
    delete p;
    String cid = doc["id"] | "";
    String cmd = doc["cmd"] | "";
    bool ok = false; const char* err = "bad cmd";
    if (!e) {
      if (cmd == "test")           { ok = doTest(String((const char*)(doc["action"] | "")), (int)(doc["box"] | 1) - 1); err = "unknown action"; }
      else if (cmd == "calibrate") { calibrate(); ok = true; }
      else if (cmd == "settings")  { applySettings(doc.as<JsonVariant>()); ok = true; }
      else if (cmd == "owner")     { ok = setOwner(String((const char*)(doc["owner"] | ""))); err = "user not found"; }
      else if (cmd == "meds")      { ok = updateMeds(String((const char*)(doc["user"] | "")), doc["meds"].as<JsonVariantConst>()); err = "update failed"; }
    }
    JsonDocument r;
    r["id"] = cid; r["cmd"] = cmd; r["ok"] = ok;
    if (!ok) r["error"] = err;
    String* out = new String();
    serializeJson(r, *out);
    if (xQueueSend(resQ, &out, 0) != pdTRUE) delete out;
    statusWanted = true;                              // push a fresh status right after any command
  }
}

static void remoteTick() {
  uint32_t now = millis();
  cmdTick();
  if (!(rEnabled && mqttUp)) return;
  if (statusWanted || now - lastStatusBuild >= MQTT_STATUS_MS) {
    statusWanted = false; lastStatusBuild = now;
    JsonDocument d; fillStatus(d); d["via"] = "mqtt";
    String s; serializeJson(d, s);
    xSemaphoreTake(mx, portMAX_DELAY); outStatus = s; outStatusNew = true; xSemaphoreGive(mx);
  }
  if (reportsWanted || (reportsDirty && now - reportsDirtyAt > 2000)) {
    reportsWanted = false; reportsDirty = false;
    String s; buildReportsSnapshot(s);
    xSemaphoreTake(mx, portMAX_DELAY); outReports = s; outReportsNew = true; xSemaphoreGive(mx);
  }
}

// =====================================================================
//  SETUP / LOOP
// =====================================================================
static void setupPwm() {
  // LEDs FIRST (channels 0..7), buzzer LAST (channel 8)
  for (uint8_t i = 0; i < NUM_BOXES; i++) {
    ledcAttachChannel(PIN_LED_R[i], LED_PWM_FREQ, LED_PWM_BITS, i * 2);
    ledcAttachChannel(PIN_LED_G[i], LED_PWM_FREQ, LED_PWM_BITS, i * 2 + 1);
    lastR[i] = lastG[i] = -1;
    ledcWrite(PIN_LED_R[i], COMMON_ANODE ? 255 : 0);
    ledcWrite(PIN_LED_G[i], COMMON_ANODE ? 255 : 0);
  }
  ledcAttachChannel(PIN_BUZZER, 2000, BUZ_PWM_BITS, BUZ_CHANNEL);
  ledcWrite(PIN_BUZZER, 0);
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_BTN_SILENCE, INPUT_PULLUP);
  pinMode(PIN_BTN_RESERVED, INPUT_PULLUP);
  pinMode(PIN_BTN_BOOT, INPUT_PULLUP);

  if (!LittleFS.begin(true)) Serial.println("LittleFS mount failed");
  prefs.begin("nura", false);
  S.volume = prefs.getUChar("vol", 60);
  S.brightness = prefs.getUChar("bri", 60);
  S.muted = prefs.getBool("mute", false);

  // remote access config + a stable random device id (part of the MQTT topic path)
  devId = prefs.getString("devid", "");
  if (devId.length() != 8) {
    char b[9];
    snprintf(b, sizeof(b), "%08x", (unsigned)esp_random());
    devId = b;
    prefs.putString("devid", devId);
  }
  rHost = prefs.getString("rhost", ""); rUser = prefs.getString("ruser", ""); rPass = prefs.getString("rpass", "");
  rEnabled = prefs.getBool("ren", false);
  mx = xSemaphoreCreateMutex();
  cmdQ = xQueueCreate(8, sizeof(String*));
  resQ = xQueueCreate(8, sizeof(String*));

  setupPwm();
  analogReadResolution(12);
  for (uint8_t i = 0; i < NUM_BOXES; i++) analogSetPinAttenuation(PIN_LDR[i], ADC_11db);
  calibrate();                       // lids must be CLOSED at boot
  countReports();
  applySchedule(false);              // loads names/times for display; engine starts after NTP

  // WiFi
  WiFi.persistent(false);
  WiFi.setHostname(MDNS_NAME);
  WiFi.setAutoReconnect(true);
  String ssid = prefs.getString("ssid", "");
  if (ssid.length()) {
    WiFi.mode(WIFI_STA);
    WiFi.begin(ssid.c_str(), prefs.getString("pass", "").c_str());
    uint32_t t0 = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - t0 < WIFI_CONNECT_MS) delay(200);
  }
  if (WiFi.status() != WL_CONNECTED) startPortal();
  else { wasConnected = true; onWifiConnected(); }

  // routes
  server.on("/", HTTP_GET, hRoot);
  server.on("/setup", HTTP_GET, hSetup);
  server.on("/api/users", HTTP_GET, hUsersGet);
  server.on("/api/users", HTTP_POST, hUsersPost);
  server.on("/api/reports", HTTP_GET, hReportsGet);
  server.on("/api/report", HTTP_POST, hReportPost);
  server.on("/api/status", HTTP_GET, hStatus);
  server.on("/api/test", HTTP_POST, hTest);
  server.on("/api/calibrate", HTTP_POST, hCalibrate);
  server.on("/api/device", HTTP_POST, hDevice);
  server.on("/api/settings", HTTP_GET, hSettingsGet);
  server.on("/api/settings", HTTP_POST, hSettingsPost);
  server.on("/api/wifi/scan", HTTP_GET, hWifiScan);
  server.on("/api/wifi", HTTP_POST, hWifiSave);
  server.on("/api/remote", HTTP_GET, hRemoteGet);
  server.on("/api/remote", HTTP_POST, hRemotePost);
  server.onNotFound(hNotFound);
  server.begin();

  // MQTT task: core 0 (WiFi core), 12 KB stack for the mbedTLS handshake, idle while remote access is disabled
  xTaskCreatePinnedToCore(mqttTask, "mqtt", 12288, nullptr, 1, nullptr, 0);
}

void loop() {
  server.handleClient();
  netTick();
  updateClock();
  ldrTick();
  engineTick();
  updateLeds();
  melodyTick();
  buttonsTick();
  remoteTick();
  if (restartAt && (int32_t)(millis() - restartAt) >= 0) ESP.restart();
}
