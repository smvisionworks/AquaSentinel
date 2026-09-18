// AquaSentinel — Field Prototype ESP32 sketch (direct WiFi version).
//
// This replaces the USB/serial bridge approach entirely: your friend's
// sketch already proved this board can join real WiFi and make HTTPS
// calls successfully ("Firebase Update Success: 200") — it was just
// pointed at an unrelated Firebase project (hackathon-b819d). This
// version keeps that WiFi + HTTPClient code exactly as-is, but posts to
// AquaSentinel's own ingestReading Cloud Function instead, with field
// names matching what the website expects. No USB cable or bridge script
// needed once this is flashed and your WiFi credentials are filled in —
// the board reports straight to the cloud on its own every 2 seconds.
//
// ---- IMPORTANT: placeholder calibration ------------------------------
// Conductivity and gas are sent as the RAW sensor reading (not rescaled)
// — that lines up with the clean/moderate/contaminated (800 / 2000) and
// air-safe/alert (1800) thresholds your team already chose, so treat
// those raw numbers as µS/cm and ppm for now. Water level is a real
// 0-100% from map(). Water FLOW has no dedicated sensor, so it's
// ESTIMATED from how fast the water level changes between readings,
// scaled by TANK_CAPACITY_LITRES below — set that to your actual
// container size, or wire in a real flow sensor (e.g. YF-S201) for a
// true reading. None of this is a lab calibration.

#include <WiFi.h>
#include <HTTPClient.h>

// --- WIFI CREDENTIALS --- put your real network name/password here
const char* ssid     = "Student WI-FI";
const char* password = "Stud3nt!@!";

// --- AQUASENTINEL CLOUD FUNCTION ---
const char* ingestUrl = "https://us-central1-aquasentinel-3db91.cloudfunctions.net/ingestReading";
const char* deviceKey = "demo-esp32-proto-01";

// --- PIN CONFIGURATION (matches your friend's wiring) ---
const int waterSensorPin      = 34; // Water sensor analog input
const int turbidityAnalogPin  = 35; // Turbidity sensor AO pin (conductivity)
const int turbidityDigitalPin = 12; // Turbidity sensor DO pin
const int gasSensorPin        = 26; // Gas/CO2 sensor AOUT pin

// --- PLACEHOLDER CALIBRATION CONSTANT — tune this ---
const float TANK_CAPACITY_LITRES = 50.0; // used only for the water-flow estimate

float lastLevelPercent = -1;
unsigned long lastReadMillis = 0;

void setup() {
  Serial.begin(115200);
  delay(1000);

  pinMode(turbidityDigitalPin, INPUT);

  WiFi.begin(ssid, password);
  Serial.print("Connecting to Wi-Fi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nConnected! IP address:");
  Serial.println(WiFi.localIP());
}

void loop() {
  // ----------------------------------------------------
  // 1. WATER LEVEL (0-100%)
  // ----------------------------------------------------
  int waterRaw = analogRead(waterSensorPin);
  int waterPercent = constrain(map(waterRaw, 0, 2500, 0, 100), 0, 100);

  // ----------------------------------------------------
  // 2. WATER FLOW (ESTIMATED) — rate of change of level over time
  // ----------------------------------------------------
  unsigned long nowMillis = millis();
  float flowLpm = 0;
  if (lastLevelPercent >= 0) {
    float dtMinutes = (nowMillis - lastReadMillis) / 60000.0;
    if (dtMinutes > 0) {
      float deltaLevel = fabs((float)waterPercent - lastLevelPercent);
      flowLpm = (deltaLevel / 100.0) * TANK_CAPACITY_LITRES / dtMinutes;
    }
  }
  lastLevelPercent = waterPercent;
  lastReadMillis = nowMillis;

  // ----------------------------------------------------
  // 3. CONDUCTIVITY (turbidity proxy) + digital switch
  // ----------------------------------------------------
  int turbidityRaw = analogRead(turbidityAnalogPin);
  int turbidityDigitalValue = digitalRead(turbidityDigitalPin);

  // ----------------------------------------------------
  // 4. GAS (CO2)
  // ----------------------------------------------------
  int gasValue = analogRead(gasSensorPin);

  Serial.print("[Water] "); Serial.print(waterPercent); Serial.print("%  ");
  Serial.print("[Flow est] "); Serial.print(flowLpm, 2); Serial.print(" L/min  ");
  Serial.print("[Conductivity] "); Serial.print(turbidityRaw);
  Serial.print(" (switch: "); Serial.print(turbidityDigitalValue == HIGH ? "TRIPPED" : "clear"); Serial.print(")  ");
  Serial.print("[Gas] "); Serial.println(gasValue);

  // ----------------------------------------------------
  // POST straight to AquaSentinel — no USB bridge needed
  // ----------------------------------------------------
  if (WiFi.status() == WL_CONNECTED) {
    String jsonData = "{";
    jsonData += "\"deviceKey\":\"" + String(deviceKey) + "\",";
    jsonData += "\"conductivity\":" + String(turbidityRaw) + ",";
    jsonData += "\"waterLevel\":" + String(waterPercent) + ",";
    jsonData += "\"waterFlow\":" + String(flowLpm, 2) + ",";
    jsonData += "\"gas\":" + String(gasValue);
    jsonData += "}";

    HTTPClient http;
    http.begin(ingestUrl);
    http.addHeader("Content-Type", "application/json");
    int httpResponseCode = http.POST(jsonData);

    if (httpResponseCode > 0) {
      Serial.print("AquaSentinel Update: ");
      Serial.println(httpResponseCode);
      Serial.println(http.getString());
    } else {
      Serial.print("Error on sending: ");
      Serial.println(httpResponseCode);
    }
    http.end();
  } else {
    Serial.println("Wi-Fi Disconnected");
  }

  delay(2000); // Read + report every 2 seconds
}
