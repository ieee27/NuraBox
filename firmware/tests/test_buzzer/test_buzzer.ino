/*
  Nura Box - TEST 3: passive buzzer on GPIO23. Arduino-ESP32 core 3.x.   (PROPOSAL: pin + part not confirmed)
  Plays the four alert melodies, one every 2.5 s: DUE (up), TAKEN, MISSED (down), READY. f = 440 * 2^((midi-69)/12).

  !! Wiring check BEFORE power-up:
     - small PIEZO passive buzzer (flat disc, ~100 Ω-1 kΩ effective, capacitive): may connect GPIO23 -> buzzer -> GND directly.
     - MAGNETIC passive buzzer / small speaker (8-42 Ω coil): NEVER directly. 3.3 V / 8 Ω = 410 mA, far above the ~12 mA a GPIO can give.
       Use: GPIO23 -> 1 kΩ -> NPN base (2N2222/BC547), emitter -> GND, buzzer between 5 V and collector, 1N4148 diode across the buzzer
       (cathode to 5 V). The diode absorbs the coil's turn-off spike.
     - an ACTIVE buzzer (has its own oscillator) will just make one fixed tone: melodies will not work. Use a passive one.
*/
static const uint8_t PIN_BUZZER = 23;
static const uint8_t VOLUME_PCT = 60;              // 0..100 -> duty 0..50 %

struct Note { uint8_t midi; uint16_t ms; };
static const Note MEL_DUE[]    = {{84, 160}, {88, 160}, {91, 280}};
static const Note MEL_TAKEN[]  = {{91, 130}, {96, 260}};
static const Note MEL_MISSED[] = {{91, 200}, {88, 200}, {84, 360}};
static const Note MEL_READY[]  = {{84, 120}, {91, 200}};

static float midiToHz(uint8_t m) { return 440.0f * powf(2.0f, ((int)m - 69) / 12.0f); }

static void play(const char* name, const Note* n, uint8_t len) {
  Serial.println(name);
  for (uint8_t i = 0; i < len; i++) {
    ledcChangeFrequency(PIN_BUZZER, (uint32_t)midiToHz(n[i].midi), 10);
    ledcWrite(PIN_BUZZER, (511UL * VOLUME_PCT) / 100UL);
    delay(n[i].ms);
    ledcWrite(PIN_BUZZER, 0);
    delay(60);
  }
}

void setup() {
  Serial.begin(115200);
  ledcAttachChannel(PIN_BUZZER, 2000, 10, 8);      // channel 8 = low-speed group, separate from the LED channels 0..7
  ledcWrite(PIN_BUZZER, 0);
}

void loop() {
  play("DUE", MEL_DUE, 3);       delay(2500);
  play("TAKEN", MEL_TAKEN, 2);   delay(2500);
  play("MISSED", MEL_MISSED, 3); delay(2500);
  play("READY", MEL_READY, 2);   delay(2500);
}
