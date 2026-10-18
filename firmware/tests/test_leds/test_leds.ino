/*
  Nura Box - TEST 1: LEDs (red + green, 4 boxes). Arduino-ESP32 core 3.x.
  Expected: each box lights RED for 1 s, then GREEN for 1 s, one box at a time, then all RED dim -> all GREEN dim.
  If a color never lights: check resistor, LED leg, COMMON_ANODE, and the pin number in the table.
  NOTHING else is connected here: no WiFi, no buzzer.
*/
static const uint8_t PIN_LED_R[4] = {27, 13, 4, 17};
static const uint8_t PIN_LED_G[4] = {14, 15, 5, 18};
static const bool COMMON_ANODE = false;           // true = LED common pin goes to 3V3 (inverted drive)

static void put(uint8_t pin, uint8_t level) { ledcWrite(pin, COMMON_ANODE ? 255 - level : level); }

void setup() {
  Serial.begin(115200);
  for (uint8_t i = 0; i < 4; i++) {
    ledcAttachChannel(PIN_LED_R[i], 5000, 8, i * 2);       // same channel plan as the firmware
    ledcAttachChannel(PIN_LED_G[i], 5000, 8, i * 2 + 1);
    put(PIN_LED_R[i], 0); put(PIN_LED_G[i], 0);
  }
  Serial.println("LED test start");
}

void loop() {
  for (uint8_t i = 0; i < 4; i++) {
    Serial.printf("box %u RED\n", i + 1);   put(PIN_LED_R[i], 255); delay(1000); put(PIN_LED_R[i], 0);
    Serial.printf("box %u GREEN\n", i + 1); put(PIN_LED_G[i], 255); delay(1000); put(PIN_LED_G[i], 0);
  }
  Serial.println("all RED dim");   for (uint8_t i = 0; i < 4; i++) put(PIN_LED_R[i], 40);  delay(1500);
  for (uint8_t i = 0; i < 4; i++) put(PIN_LED_R[i], 0);
  Serial.println("all GREEN dim"); for (uint8_t i = 0; i < 4; i++) put(PIN_LED_G[i], 40);  delay(1500);
  for (uint8_t i = 0; i < 4; i++) put(PIN_LED_G[i], 0);
}
