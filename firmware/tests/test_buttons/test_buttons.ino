/*
  Nura Box - TEST 4: buttons. Each button connects the GPIO to GND (INPUT_PULLUP, no external resistor needed).
  GPIO25 = silence alert, GPIO26 = reserved, GPIO0 = BOOT button on the DevKit.
  Serial Monitor 115200: you should see "pressed" while holding, "released" after. GPIO0 held at POWER-UP enters flashing mode (normal).
*/
static const uint8_t PINS[3] = {25, 26, 0};
static const char* NAMES[3] = {"SILENCE(25)", "RESERVED(26)", "BOOT(0)"};
static bool last[3] = {false, false, false};

void setup() {
  Serial.begin(115200);
  for (uint8_t i = 0; i < 3; i++) pinMode(PINS[i], INPUT_PULLUP);
}

void loop() {
  for (uint8_t i = 0; i < 3; i++) {
    bool down = digitalRead(PINS[i]) == LOW;
    if (down != last[i]) { Serial.printf("%s %s\n", NAMES[i], down ? "pressed" : "released"); last[i] = down; }
  }
  delay(10);
}
