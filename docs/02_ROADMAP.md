# Nura Box - Roadmap, first-run checklist, and defense notes

## Serving the site from the ESP32: what I recommend
| Option | Requests | Flash | Cost |
|---|---|---|---|
| (a) split files as they are | 8 sequential (WebServer is single-threaded) | about 100 KB | slow first load, but simplest, no tool |
| (b) pre-gzip each file | 8 sequential | about 28 KB | still 8 round-trips, needs a gzip step per file |
| **(c) one bundled `index.html.gz`** | **1** | **about 28 KB** | **you must re-run the script and re-upload LittleFS after EVERY site change** |
**Recommendation: (c).** The repo keeps the split files as the source of truth; `node tools/build-esp.js` generates the single file for the ESP only. Option (a) is available as `node tools/build-esp.js --split` for debugging. The firmware serves `<path>.gz` automatically and any other file from LittleFS with proper MIME types.

## Exactly what goes in `data/`
Run `node tools/build-esp.js` (Node only, no npm install). It creates `firmware/nura_esp32/data/index.html.gz`. **That one file is all you upload.** Do **not** copy `users.json` or `reports.ndjson`: the box creates them itself.
Upload: install the Arduino IDE 2 LittleFS upload plugin (project *arduino-littlefs-upload* by earlephilhower: put its `.vsix` in the IDE's `plugins` folder, restart), close the Serial Monitor, then `Ctrl+Shift+P` -> **Upload LittleFS to ESP32**. I am describing the plugin from memory: follow its README if the steps differ.

## First-run checklist
1. Arduino IDE: install *esp32 by Espressif* 3.x, libraries ArduinoJson 7 and PubSubClient. Board *ESP32 Dev Module*, partition *Default 4MB with spiffs*, port COM5.
2. Change `AP_PASS` in the `.ino` (default `nura1234` is public in the repo).
3. Run the four test sketches in `firmware/tests/` (order in 01_HARDWARE.md).
4. Flash `nura_esp32.ino`. Serial 115200 shows the portal address or the IP.
5. First boot: join WiFi `NuraBox-Setup`, the setup page opens, pick your network, save, the box restarts.
6. Run the bundle script and upload LittleFS.
7. Open `http://<IP>` (or `http://nurabox.local` on PC / iPhone, not reliable on Android). Settings -> the connection badge must say "Device online".
8. Close all lids, Settings -> **Calibrate**. Use "Simulate due / taken / missed" to check LEDs, buzzer and the log.
9. Register a patient, add a medicine 3 minutes ahead, watch the real flow. Then a 24 h soak test.

## Next steps (suggested order)
1. Compile, fix errors, run the tests. 2. Tune LDR thresholds on the real box. 3. Remote access (docs/03). 4. Add an auth token to the API (see below). 5. Optional: DS3231 RTC so alerts do not depend on NTP at boot. 6. Remove the demo chips.

## Known limitations and what to say in the defense
| Limitation | Honest line for the committee |
|---|---|
| **Plain-text passwords**, and `GET /api/users` returns them to anyone on the LAN | "Prototype scope. In production passwords are hashed on a server and the API needs a token. On the ESP32 the whole user list is one file, so we accepted this for the demo." Do not hide that the endpoint is open on the LAN. |
| **No API auth token** (LAN API, including `POST /api/remote` which can repoint the box to another broker) | "The LAN is the trust boundary today. Next step is a per-device token stored in NVS and sent as a header." |
| **Polling instead of WebSocket/SSE** | "4 s status poll, 12 s data poll: fine for pill times measured in minutes; WebSocket is an upgrade, not a requirement." |
| **Whole-array last-write-wins user sync** | "Two browsers editing at once can overwrite each other. Max 10 accounts, so conflicts are rare; per-record sync is the fix." |
| **No RTC** | "Alerts need NTP once after boot. If WiFi is down at boot the engine waits and does not alert. A DS3231 removes that dependency." |
| **LDR sensitive to ambient light** | "We calibrate a per-box baseline with lids closed and use hysteresis plus debounce; a light shield on the sensor is part of the enclosure design." |
| **Remote access** | "No port forwarding, because the LAN API has no auth. Internet access goes through an authenticated, TLS-encrypted MQTT broker." |
| **MQTT TLS does not verify the broker certificate** (`setInsecure()`) | "Traffic is encrypted and authenticated by username/password, but a man-in-the-middle with a forged certificate is not detected. Pinning the broker's root CA is the fix and is a small change." |
| **Broker credentials sit in the browser's localStorage and the box's NVS** | "Use a dedicated broker user for this project; anyone holding those credentials can control the box. Rotate them if a device is lost." |
| **Accounts are per browser in remote mode** | "Remote mode shows live status and controls the box; the account database itself is not published to the internet. Move accounts with Export/Import." |
| **Reports over MQTT contain dose records only** | "Symptoms and doctor notes never leave the LAN." |
