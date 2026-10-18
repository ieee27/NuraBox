# Control the box from anywhere (MQTT over TLS)

**Never use port forwarding for this project:** the LAN API has no authentication, so an open port would let anyone on the internet read the user list (with passwords) and control the box.

## How it works
```
 phone / GitHub Pages (HTTPS) --wss:8884--> [ MQTT broker ] <--TLS:8883-- ESP32 (outbound only)
```
The ESP32 only makes an **outbound** connection, so there is nothing to open on your router and it works behind any NAT. The HTTPS GitHub Pages site can use `wss://`, so the mixed-content block does not apply.
Topics (`<id>` = the box's 8-hex-char ID, shown in Settings and in `/api/status`):
| Topic | Direction | Content |
|---|---|---|
| `nurabox/<id>/status` | box -> site, retained | full status JSON every 5 s |
| `nurabox/<id>/reports` | box -> site, retained | last 40 **dose** records (never symptoms / doctor notes) |
| `nurabox/<id>/online` | box -> site, retained | `1` / `0` (last-will, flips to `0` if the box drops) |
| `nurabox/<id>/cmd` | site -> box | `test`, `calibrate`, `settings`, `owner`, `meds` |
| `nurabox/<id>/res` | box -> site | `{id, cmd, ok, error?}` per command |

## Setup (about 10 minutes) - proposal: HiveMQ Cloud free tier
Check their current free-plan limits and UI on their site; the steps below are from memory.
1. Create a free HiveMQ Cloud (Serverless) cluster. From the cluster overview copy the **hostname** (like `abc123.s1.eu.hivemq.cloud`). TLS port **8883** (box), WebSocket-TLS port **8884** (browser), path `/mqtt`.
2. In *Access Management* create credentials (username + password) with publish and subscribe permission. If the plan allows, make one for the box and a separate one for the browser.
3. Open the site **from the box on your LAN** (`http://<IP>`), Settings -> *Control from anywhere*: host, WSS port 8884, username, password; the box ID is filled in. Press **Save in browser and send to the box**. The box connects (badge in Settings, `remote.connected` in `/api/status`).
4. On any other device open `https://ieee27.github.io/NuraBox/`, log in, Settings -> the same host / port / user / password / box ID -> **Save in this browser**. The badge turns to "Remote (internet)" when the box is online.
5. Accounts live per browser: on the LAN site use Settings -> Export JSON, on the remote browser Import JSON. The patient account that the box follows must also exist **on the box** for `meds` edits to be accepted (`update failed` otherwise).

## What works remotely
Live box state (state ring, lid, LDR, device clock, RSSI), test buttons, calibrate, volume / brightness / mute, device owner, schedule edits for the box's owner (sent as a `meds` command that replaces only that user's medicines), and dose history for the chart.
Not remote: creating accounts on the box, doctor-patient links, patient reports and doctor replies (those stay on the LAN).

## Security notes
- Anyone with the broker credentials can control the box. Use a dedicated broker user and rotate it if a phone is lost.
- The password is stored in the browser's localStorage and in the box's NVS in plain text.
- TLS is encrypted but the broker certificate is not verified on the ESP32 (`setInsecure()`); pinning the root CA is the proper fix.
- The LAN API `POST /api/remote` is unauthenticated: someone on your WiFi could repoint the box to their own broker.

## Troubleshooting
- Badge stays "Device offline": check `/api/status` -> `remote.connected`. `false` = wrong host / user / password, no internet on the box's WiFi, or the broker refused the TLS handshake. Watch the Serial Monitor.
- "MQTT library did not load": the page could not fetch mqtt.js from jsDelivr (no internet, or a blocker).
- Commands time out after 10 s: the box is offline or the ID is wrong (the topic path includes the ID).
- Remote reboots while connecting: the TLS handshake needs RAM and current; use a >= 1 A supply and the bulk capacitor from 01_HARDWARE.md.

## Alternatives I did not pick
Tailscale or a Cloudflare Tunnel need an always-on machine at home (a PC or Raspberry Pi) because the ESP32 cannot run them; they also keep the unauthenticated API reachable behind the tunnel. MQTT keeps the ESP32 outbound-only and gives you per-device credentials.
