# Nura Box - Hardware (everything here is a PROPOSAL until you confirm it)

Controller: ESP32 DevKit V1, **WROOM** module (confirmed), Arduino-ESP32 core 3.x (Espressif package, not "Nano ESP32"), Arduino IDE 2.3. All GPIOs are **3.3 V and NOT 5 V tolerant**. Never feed 5 V into any GPIO or ADC pin.
Board settings: *ESP32 Dev Module*, Partition Scheme *Default 4MB with spiffs* (LittleFS uses that partition). Libraries: ArduinoJson 7.x, PubSubClient 2.8.x.

## Pin map (from nura.ino, unchanged; every pin is one constant in the `.ino`)
| Box | LED red | LED green | LDR (ADC1) | Notes |
|---|---|---|---|---|
| 1 | GPIO27 | GPIO14 | GPIO34 | 34 is input-only: fine for an ADC divider |
| 2 | GPIO13 | GPIO15 | GPIO35 | GPIO15 = strapping pin; 35 input-only |
| 3 | GPIO4  | GPIO5  | GPIO32 | GPIO5 = strapping pin |
| 4 | GPIO17 | GPIO18 | GPIO33 | GPIO17 breaks on WROVER (PSRAM): OK on your WROOM |

| Function | Pin | Notes |
|---|---|---|
| Buzzer (passive) | GPIO23 | proposal |
| Silence button | GPIO25 | to GND, `INPUT_PULLUP` |
| Reserved button | GPIO26 | to GND, `INPUT_PULLUP` |
| BOOT | GPIO0 | on the board; hold 3 s = forget WiFi. Held at power-up = flashing mode (normal) |
| Freed by dropping BLUE | 12, 2, 16, 19 | the dangerous strapping pins are no longer used |

Strapping pins 5 and 15: an LED with a series resistor to GND can pull the pin low during reset. For GPIO15 that only silences the boot ROM log; for GPIO5 it only changes SDIO-slave timing. Neither matters here. GPIO12 (flash-voltage strap) is **not** used, which is the one that can really hang boot.

## LEDs (common cathode assumed; `COMMON_ANODE` constant inverts the drive)
One resistor **per color leg**. A shared resistor makes brightness depend on how many colors are lit, so it was rejected.
- Red: R = (3.3 - Vf) / I = (3.3 - 2.0) / 0.006 = 217 ohm -> **220 ohm** -> I = 5.9 mA.
- Green: (3.3 - 2.1) / 150 = 8.0 mA with **150 ohm**.
- Check your part: many RGB packages use a "true green" die with Vf about 3.0 V. Then the green current is (3.3 - 3.0) / 150 = **2 mA** and it will look dim. Measure with the multimeter or read the datasheet; if dim, drop green to about 47 ohm (Vf 3.0 V -> 6 mA).
- Worst case, 4 reds lit together: 4 x 5.9 = 24 mA total, far below what the 3.3 V regulator can give. Per pin we stay under 10 mA (datasheet absolute max is 40 mA; keep well under 20).
- Wiring per LED: GPIO -> resistor -> LED anode (R or G leg) -> common cathode -> GND. Blue leg unconnected.
- Test: `firmware/tests/test_leds`.

## LDR (lid open detection)
Divider into an ADC1 pin: node voltage = 3.3 V x R_bottom / (R_top + R_bottom). Use a 10 k fixed resistor as the starting value (aim for about sqrt(R_dark x R_light)); a GL5528-type LDR is roughly 10-20 k in room light and 1 M dark (**part not confirmed**).
| Wiring | Lid closed (dark) | Lid open (light) | Firmware constant |
|---|---|---|---|
| 3V3 -> fixed R -> node -> LDR -> GND | node high | node **drops** | `OPEN_IS_LOW = true` (default) |
| 3V3 -> LDR -> node -> fixed R -> GND | node low | node **rises** | `OPEN_IS_LOW = false` |
Run `firmware/tests/test_ldr`, open one lid and watch the number; set the constant accordingly. ADC1 only (ADC2 is unusable while WiFi is on). The ESP32 ADC is non-linear near 0 V and about 3.1 V; we only use the *change* from the calibrated baseline (30 % or 300 counts), so saturation at the rail is fine. `/api/status` shows `ldrOk=false` for a channel without enough headroom to ever see the change.
Ambient light is the weak point: shield the LDR so it sees the compartment, not the room. Re-calibrate (Settings -> Calibrate) with lids closed after moving the box.

## Buzzer (passive, GPIO23)
- Small **piezo** passive disc: GPIO -> buzzer -> GND is OK.
- **Magnetic** passive buzzer or small speaker (8-42 ohm): do **not** connect directly. 3.3 V / 8 ohm = 410 mA through a pin rated for about 12-20 mA will damage it. Use GPIO23 -> 1 k -> NPN base (2N2222 / BC547), emitter GND, buzzer between 5 V and collector, 1N4148 across the buzzer (cathode to 5 V).
- An **active** buzzer (built-in oscillator) gives one fixed tone: the melodies will not work.
- Melodies are MIDI notes in octave 6-7 (about 1-2 kHz, where passive buzzers are loudest), converted with `f = 440 x 2^((midi-69)/12)`.
- Test: `firmware/tests/test_buzzer`.

## LEDC channel plan (you asked me to verify the "LEDs first, buzzer last" reasoning)
Classic ESP32 has 16 LEDC channels: 0-7 in the high-speed group, 8-15 in the low-speed group, with 4 timers per group; channel pairs (0,1), (2,3), (4,5), (6,7) share a timer. `ledcChangeFrequency()` on the buzzer retunes **its channel's timer**.
- With auto-allocation, 8 LED channels take 0-7 and the buzzer lands on channel 8, which is in the *other* group, so its frequency changes cannot touch the LED timers. The outcome of your reasoning is right.
- But the stated reason is incomplete: order alone is not what protects you. On ESP32-S2/S3/C3 there is no high-speed group and only 8 channels, so a 9th attach would fail or share a timer. That is why the firmware pins the channels **explicitly** with `ledcAttachChannel(pin, freq, bits, channel)`: LEDs 0-7, buzzer 8.
- Each red/green pair shares one timer (same 5 kHz, 8-bit), which is fine.
- I am stating this from my knowledge of the core's `esp32-hal-ledc.c` (channel -> timer = channel/2 mod 4, group = channel/8). I could not open the installed core here, so confirm with a compile and the LED + buzzer tests running together.

## Buttons
Each button between the GPIO and GND, internal pull-up, no external resistor. Test: `firmware/tests/test_buttons`.

## Power
- Use a USB supply of **at least 1 A**. WiFi transmit bursts can pull several hundred mA; a weak supply shows up as "Brownout detector was triggered" and random reboots.
- Add a 470-1000 uF electrolytic across 5 V / GND close to the board (your teammate's 1000 uF idea is good).
- A 9 V battery is a poor fit (linear regulation wastes most of it as heat, and WiFi drains it in hours). Cost-effective battery option later: 1S Li-ion + a proper charger / boost module.

## Bring-up order (do not skip)
1. `test_leds` -> 2. `test_ldr` (decide `OPEN_IS_LOW`) -> 3. `test_buzzer` -> 4. `test_buttons` -> 5. full firmware, check Serial for the portal / IP -> 6. LittleFS upload (see 02_ROADMAP.md).
