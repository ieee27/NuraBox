/*
  Nura Box - TEST 2: LDR (4 channels, ADC1 only). Arduino-ESP32 core 3.x.
  Open Serial Monitor at 115200. With ALL lids closed note the numbers, then open ONE lid and watch its column.
    - number goes DOWN when you open the lid  -> in the firmware keep  OPEN_IS_LOW = true   (fixed resistor to 3V3, LDR to GND)
    - number goes UP   when you open the lid  -> set                   OPEN_IS_LOW = false  (LDR to 3V3, fixed resistor to GND)
  A healthy channel changes by > 300 counts between closed and open. If the change is small: change the fixed resistor
  (aim for roughly sqrt(R_LDR_dark * R_LDR_light), usually 4.7k - 22k) or add a small light shield around the LDR.
  Never feed more than 3.3 V to these pins.
*/
static const uint8_t PIN_LDR[4] = {34, 35, 32, 33};

void setup() {
  Serial.begin(115200);
  analogReadResolution(12);
  for (uint8_t i = 0; i < 4; i++) analogSetPinAttenuation(PIN_LDR[i], ADC_11db);
  Serial.println("box1\tbox2\tbox3\tbox4");
}

void loop() {
  int v[4];
  for (uint8_t i = 0; i < 4; i++) {
    long s = 0;
    for (int k = 0; k < 16; k++) { s += analogRead(PIN_LDR[i]); delayMicroseconds(300); }
    v[i] = s / 16;
  }
  Serial.printf("%d\t%d\t%d\t%d\n", v[0], v[1], v[2], v[3]);
  delay(250);
}
