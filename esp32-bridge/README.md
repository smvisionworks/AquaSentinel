# Connecting your ESP32 to AquaSentinel

## This folder is retired

Flashing your own ESP32 (`firmware/`) and running the USB bridge script
(`bridge/`) turned out not to be necessary: your teammate's board already
reports into their `hackathon-b819d` Firebase Realtime Database on its own,
over WiFi, with no involvement from you. Rather than also fighting your own
board's WiFi connection, AquaSentinel now pulls straight from that feed.

The new pipeline lives entirely in `functions/index.js`, as a scheduled
Cloud Function called `syncHackathonFeed`:

```
teammate's ESP32 --WiFi--> hackathon-b819d Realtime Database --(polled every minute)--> syncHackathonFeed (Cloud Function) --> Firestore (sites/site-field-prototype, "ICT Baddies") --> website
```

It reuses the exact same thresholds, Firestore writes, and incident/AI-report
pipeline as a real device POST to `ingestReading` — see the comment above
`syncHackathonFeed` in `functions/index.js` for the field mapping. Deploy it
the same way as any other function change:

```
cd functions && npm install && cd ..
firebase deploy --only functions
```

Then re-run the seed script if you haven't since the site was renamed to
"ICT Baddies" (`cd seed && node seed.js`) — safe to re-run any time.

Everything below this point describes the old USB/Arduino approach and is
kept only as reference in case you ever do want to wire up your own board.

---

## ⚠️ First: rotate your Firebase service account key

Your uploaded project zip included `seed/serviceAccountKey.json` — a live
Firebase **Admin** credential (full read/write access to your whole
project, bypassing all security rules). It's `.gitignore`d so it never got
committed to git, but the zip itself isn't git — it was in the folder you
compressed and sent, so it just travelled through this chat.

Treat it as compromised:
1. Firebase console → **Project settings → Service accounts**.
2. Find the key with the matching ID and click **Delete**, or just
   generate a new one and stop using the old file.
3. If you re-run the seed script later, download a fresh key instead of
   reusing the old JSON file.

This takes two minutes and costs nothing — worth doing before anything
else here.

## What you already have

Your `AquaSentinel` project is a Firebase-backed compliance dashboard
(Firestore + Auth + Cloud Functions, including `ingestReading`) with 7
demo sites — 6 seeded mine-water points plus **"Field Prototype Rig"**,
which is *your* real ESP32. It shows up on the same Command Centre map,
site grid, and Site Detail cards as everything else.

Your actual ESP32 prototype (from `sketch_sep17a.ino`) has:

- a resistive water-level sensor (D34)
- a turbidity sensor, analog + digital threshold (D35 / D14)
- a gas sensor used as a CO2 proxy (D32)

and it's connected to your computer over **USB, not WiFi** — so it can't
POST to a cloud endpoint by itself.

**Calibration caveat:** the firmware converts raw ADC readings (0–4095)
into µS/cm / % / L/min / ppm with a straight linear scale, not a real lab
calibration — see the big comment block at the top of
`firmware/aquasentinel_field_node.ino` for what to do about that (and
note water *flow* is estimated from how fast the level changes, since
there's no dedicated flow sensor). The numbers will move sensibly but
aren't measurement-accurate yet.

## What this adds

```
ESP32 (USB/Serial) --> serial_to_firebase.py (on your computer) --> ingestReading (Cloud Function) --> Firestore (sites/site-field-prototype) --> website
```

- **`firmware/aquasentinel_field_node.ino`** — rewritten to match your current wiring, with the local WiFi-AP + webserver dashboard removed (not needed — you're going over USB instead) and one line per loop: `DATA:{...}`, with `conductivity`/`waterLevel`/`waterFlow`/`gas` — the exact field names the website expects.
- **`bridge/serial_to_firebase.py`** — runs on your computer, reads the ESP32's `DATA:` lines over USB, and forwards them to `ingestReading`.
- The old `ingestFieldReading` function / `fieldNodes` collection (for raw, un-mapped sensor data) is still there in `functions/index.js` in your main project folder if you ever want it, but this setup no longer uses it.

## Setup

### 1. Flash the sketch
Upload `firmware/aquasentinel_field_node.ino` to your ESP32 (Arduino IDE
or PlatformIO). Open the Serial Monitor at 115200 baud — you should see
the familiar per-sensor debug lines, now with one `DATA:{...}` line mixed
in every ~2 seconds.

### 2. Install the bridge script's dependencies
```
cd bridge
pip install -r requirements.txt
```

### 3. Dry run — no cloud involved yet
Find your port (macOS: `ls /dev/tty.usbserial-*`; Linux: `ls /dev/ttyUSB*`;
Windows: Device Manager → Ports) and run:
```
python serial_to_firebase.py --port /dev/tty.usbserial-XXXX
```
You should see each parsed reading printed once every couple of seconds.
Close the Arduino Serial Monitor first — only one program can hold the
port at a time.

### 4. Make sure the backend is deployed and the device is registered
From your main project folder (not this `esp32-bridge` one):
```
cd functions && npm install && cd ..
firebase deploy --only functions
```
Then re-run the seed script (`cd seed && node seed.js`) if you haven't
since this update — that's what creates the `Field Prototype Rig` site
and registers its device key (`demo-esp32-proto-01`) in Firestore. Safe
to re-run any time; it only upserts.

### 5. Go live
```
python serial_to_firebase.py --port /dev/tty.usbserial-XXXX --post \
    --url https://<region>-<project-id>.cloudfunctions.net/ingestReading \
    --device-key demo-esp32-proto-01
```
Open **Field Prototype Rig** on the website's Command Centre — its
sensor cards, chart, and reading log will update live as readings arrive
(every ~2 seconds, throttled to one post per `--min-interval` seconds,
5s by default).
