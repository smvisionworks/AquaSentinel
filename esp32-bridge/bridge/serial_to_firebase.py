#!/usr/bin/env python3
"""
AquaSentinel -- ESP32 serial-to-cloud bridge.

Your ESP32 is wired to sensors and connected to your computer over USB, not
WiFi, so it can't POST to the cloud function directly. This script is the
missing link: it watches the ESP32's Serial output, pulls out the one-line
"DATA:{...}" JSON reading the sketch prints once per loop (see
../firmware/aquasentinel_field_node.ino), and forwards it to the
AquaSentinel Cloud Function over your computer's internet connection.

    ESP32 --USB/Serial--> this script --HTTPS--> Cloud Function --> Firestore --> website

Install dependencies once:
    pip install -r requirements.txt

Find your serial port:
    macOS:   ls /dev/tty.usbserial-*  or  /dev/tty.SLAB_USBtoUART
    Linux:   ls /dev/ttyUSB*  or  /dev/ttyACM*
    Windows: Device Manager -> Ports (COM & LPT) -> note the COM number

1) Dry run first -- just watch parsed readings, nothing sent anywhere:
    python serial_to_firebase.py --port /dev/tty.usbserial-1420

2) Once your Cloud Function is deployed and the device is registered
   (see the README), start actually sending readings:
    python serial_to_firebase.py --port /dev/tty.usbserial-1420 --post \\
        --url https://<region>-<project-id>.cloudfunctions.net/ingestReading \\
        --device-key demo-esp32-proto-01
"""
import argparse
import json
import sys
import time
from datetime import datetime, timezone

try:
    import serial  # pyserial
except ImportError:
    sys.exit("Missing dependency 'pyserial'. Run: pip install -r requirements.txt")

try:
    import requests
except ImportError:
    requests = None  # only required if --post is used


def parse_args():
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument("--port", required=True, help="Serial port, e.g. /dev/tty.usbserial-1420 or COM5")
    p.add_argument("--baud", type=int, default=115200, help="Must match Serial.begin() in the sketch (default 115200)")
    p.add_argument("--post", action="store_true", help="Actually POST each reading to the cloud endpoint (default: dry run, print only)")
    p.add_argument("--url", help="ingestReading Cloud Function URL (required with --post)")
    p.add_argument("--device-key", help="This device's deviceKey, e.g. demo-esp32-proto-01 (required with --post)")
    p.add_argument("--min-interval", type=float, default=5.0, help="Minimum seconds between posts, so a fast sketch loop doesn't hammer the endpoint (default: 5s)")
    p.add_argument("--log", help="Optional path to also append every parsed reading as a JSON-lines log")
    return p.parse_args()


def build_payload(reading, device_key):
    """
    Maps the sketch's reading into the ingestReading request body — field
    names must match exactly what the website's ingestReading Cloud
    Function expects. Edit this if you change what the sketch reports.
    """
    return {
        "deviceKey": device_key,
        "conductivity": reading.get("conductivity"),
        "waterLevel": reading.get("waterLevel"),
        "waterFlow": reading.get("waterFlow"),
        "gas": reading.get("gas"),
    }


def main():
    args = parse_args()
    if args.post:
        if not args.url or not args.device_key:
            sys.exit("--post requires both --url and --device-key")
        if requests is None:
            sys.exit("Missing dependency 'requests'. Run: pip install -r requirements.txt")

    print(f"Opening {args.port} @ {args.baud} baud...")
    try:
        ser = serial.Serial(args.port, args.baud, timeout=2)
    except serial.SerialException as e:
        sys.exit(f"Could not open {args.port}: {e}\n"
                  f"(Is the Arduino IDE's Serial Monitor open on the same port? Close it first -- "
                  f"only one program can hold a serial port at a time.)")

    time.sleep(2)  # let the ESP32 finish its post-reset boot chatter
    ser.reset_input_buffer()

    log_fh = open(args.log, "a", encoding="utf-8") if args.log else None
    last_post = 0.0
    mode = "LIVE (posting to cloud)" if args.post else "DRY RUN (printing only, nothing sent)"
    print(f"Mode: {mode}")
    print('Listening for "DATA:{...}" lines (Ctrl+C to stop)...\n')

    try:
        while True:
            raw = ser.readline().decode("utf-8", errors="replace").strip()
            if not raw:
                continue
            if not raw.startswith("DATA:"):
                # Not a machine-readable reading -- print it anyway (prefixed)
                # so you can see everything the board is actually sending,
                # which is the fastest way to spot a mismatch.
                print(f"   (ignored, not a DATA: line) {raw}")
                continue

            try:
                reading = json.loads(raw[len("DATA:"):])
            except json.JSONDecodeError:
                print(f"  ! could not parse: {raw}", file=sys.stderr)
                continue

            stamp = datetime.now(timezone.utc).isoformat()
            print(f"[{stamp}] {reading}")
            if log_fh:
                log_fh.write(json.dumps({"at": stamp, **reading}) + "\n")
                log_fh.flush()

            if args.post and (time.time() - last_post) >= args.min_interval:
                payload = build_payload(reading, args.device_key)
                try:
                    resp = requests.post(args.url, json=payload, timeout=10)
                    print(f"  -> POST {resp.status_code}: {resp.text}")
                except requests.RequestException as e:
                    print(f"  ! POST failed: {e}", file=sys.stderr)
                last_post = time.time()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        ser.close()
        if log_fh:
            log_fh.close()


if __name__ == "__main__":
    main()
