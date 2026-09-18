@echo off
REM AquaSentinel -- runs the serial bridge with your real settings already
REM filled in, so you don't have to retype/paste the long command each time.
REM Double-click this file, or run it from Command Prompt:
REM     run_bridge.bat
REM Edit the values below if your COM port or device key ever change.

python serial_to_firebase.py --port COM3 --post --url https://us-central1-aquasentinel-3db91.cloudfunctions.net/ingestReading --device-key demo-esp32-proto-01

pause
