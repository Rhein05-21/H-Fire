/**
 * ============================================================================
 * 🔥 H-FIRE IOT SYSTEM — CORE GATEWAY NODE (NODE 1)
 * ============================================================================
 * Architecture: Master Gateway & Sector 1 Sensor Node
 * Board: ESP32 Dev Module (WROOM-32)
 *
 * Core Responsibilities:
 *  1. Reads local MQ-2 Gas/Smoke (GPIO 34) and Optical Flame Sensor (GPIO 32).
 *  2. Receives telemetry from Satellite Nodes (N2 & N3) via ESP-NOW.
 *  3. Secondary Node Watchdog: Automatically sets N2/N3 to OFFLINE (0 PPM, 
 *     Safe, N_Online=0) if no packet is received for > 4.0 seconds.
 *  4. Connects to 2.4GHz Wi-Fi via WiFiManager with on-screen portal guidance.
 *  5. Connects via TLS (Port 8883) to HiveMQ Cloud MQTT Broker.
 *  6. Aggregates all 3 sectors into unified JSON matching H-Fire Admin Mobile App:
 *     {"mac":"...","N1_Gas":..,"N1_Fire":..,"N2_Gas":..,"N2_Fire":..,"N2_Online":..,
 *      "N3_Gas":..,"N3_Fire":..,"N3_Online":..,"status":"..."}
 *  7. Multi-Sector Audio Alarm: Drives Buzzer (GPIO 25) with continuous siren
 *     for DANGER, pulsed beeps for WARNING, and silent for SAFE.
 *  8. SSD1306 OLED HUD: Real-time 3-sector monitoring dashboard.
 * ============================================================================
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <WiFiManager.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <Preferences.h>
#include <math.h>

Preferences prefs;

// ============================================================================
// 1. HARDWARE PIN DEFINITIONS & OLED CONFIGURATION
// ============================================================================
#define SCREEN_WIDTH      128
#define SCREEN_HEIGHT     64
#define OLED_RESET        -1
#define OLED_I2C_ADDRESS  0x3C
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

const int PIN_MQ2_GAS     = 34;   // Analog ADC1_CH6 (MQ-2 Analog Out)
const int PIN_FLAME       = 32;   // Digital In (Optical Flame Sensor)
const int PIN_BUZZER      = 25;   // Digital Out (Piezo / Active Buzzer)
const int PIN_RESET_BTN   = 0;    // BOOT Button (Hold 3s to reset Wi-Fi)

// ============================================================================
// 2. SYSTEM-WIDE TELEMETRY THRESHOLDS (Dynamic Over-The-Air Calibration)
// ============================================================================
int threshold_safe_ppm   = 450;    // Normal ambient air (default 450)
int threshold_danger_ppm = 1500;   // Hazardous smoke/gas threshold (default 1500)
const unsigned long NODE_TIMEOUT_MS = 4000; // 4s stale timeout for satellites

// MQ-2 Datasheet Calibration Curves & Baseline Variables
const float MQ2_RL_VALUE            = 5.0;     // Load resistance in k-ohms (standard 5k)
const float MQ2_RO_CLEAN_AIR_FACTOR = 9.83;    // Rs/Ro in clean air per datasheet
const float MQ2_CURVE_A             = 3616.0;  // Power-law constant A for Smoke
const float MQ2_CURVE_B             = -2.675;  // Power-law constant B (slope)

float mq2_R0                 = 10.0;           // Calibrated baseline R0 in k-ohms
int   flame_ambient_baseline = 2800;           // Ambient IR baseline in millivolts
int   flame_trigger_delta    = 600;            // Software detection delta (mV)

// ============================================================================
// 3. HIVEMQ CLOUD CREDENTIALS & MQTT TOPICS
// ============================================================================
const char* MQTT_SERVER    = "16e51255d95244c2b069b92cf77ebf81.s1.eu.hivemq.cloud";
const int   MQTT_PORT      = 8883;
const char* MQTT_USER      = "RheinTigle";
const char* MQTT_PASS      = "052105@Rhein";
const char* TOPIC_DATA     = "hfire/house1/data";
const char* TOPIC_STATUS   = "hfire/house1/status";
const char* TOPIC_COMMAND  = "hfire/house1/command";

// ============================================================================
// 4. ESP-NOW PACKET STRUCTURE (Packed binary protocol)
// ============================================================================
typedef struct __attribute__((packed)) {
  uint8_t  node_id;        // 2 = Living Room, 3 = Bedroom / Sector 3
  uint16_t gas_level;      // Smoothed PPM / ADC reading (0 - 4095)
  bool     flame_status;   // true = Flame detected, false = Clear
  uint32_t uptime_seconds; // Node heartbeat counter
} SensorPacket;

// Bidirectional Configuration Command (Core Gateway -> Node 2 & Node 3)
typedef struct __attribute__((packed)) {
  uint8_t  command_type;  // 1 = SET_THRESHOLDS, 2 = TARE_MQ2, 3 = TARE_FLAME, 4 = SILENCE_BUZZER
  uint16_t safe_ppm;
  uint16_t danger_ppm;
  uint16_t flame_delta;
} CommandPacket;

uint8_t broadcastAddress[] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
uint8_t node2_mac[6] = {0};
uint8_t node3_mac[6] = {0};
bool node2_peer_added = false;
bool node3_peer_added = false;

void addEspNowPeerSafe(const uint8_t *mac) {
  if (esp_now_is_peer_exist(mac)) return;
  esp_now_peer_info_t pInfo;
  memset(&pInfo, 0, sizeof(pInfo));
  memcpy(pInfo.peer_addr, mac, 6);
  pInfo.channel = 0;
  pInfo.encrypt = false;
  esp_now_add_peer(&pInfo);
}

void broadcastCommandToSatellites(uint8_t cmd_type) {
  CommandPacket cmd;
  cmd.command_type = cmd_type;
  cmd.safe_ppm     = (uint16_t)threshold_safe_ppm;
  cmd.danger_ppm   = (uint16_t)threshold_danger_ppm;
  cmd.flame_delta  = (uint16_t)flame_trigger_delta;

  esp_now_send(broadcastAddress, (uint8_t *)&cmd, sizeof(cmd));
  if (node2_peer_added) esp_now_send(node2_mac, (uint8_t *)&cmd, sizeof(cmd));
  if (node3_peer_added) esp_now_send(node3_mac, (uint8_t *)&cmd, sizeof(cmd));
  Serial.printf("[ESP-NOW TX] Broadcasted command %d to Satellites (Safe=%d, Danger=%d, Delta=%d)\n",
                cmd_type, threshold_safe_ppm, threshold_danger_ppm, flame_trigger_delta);
}

// In-Memory Telemetry State for Nodes 1, 2, and 3
struct NodeState {
  int           gas;
  bool          fire;
  bool          online;
  unsigned long last_seen;
};

NodeState nodes[4]; // Index 1 = Core, 2 = Node 2, 3 = Node 3

// Network & Timer Controllers
WiFiClientSecure espClient;
PubSubClient     mqttClient(espClient);
String           coreMacAddress = "20:50:0D:33:68:0C";

unsigned long lastSensorReadMillis = 0;
unsigned long lastMqttPublishMillis = 0;
unsigned long lastMqttReconnectAttempt = 0;
unsigned long lastBeepToggleMillis = 0;
bool buzzerBeepState = false;

// ============================================================================
// 5. ESP-NOW RECEPTION CALLBACK
// ============================================================================
void OnDataRecv(const uint8_t *mac_addr, const uint8_t *data, int data_len) {
  if (data_len != sizeof(SensorPacket)) {
    return;
  }

  SensorPacket packet;
  memcpy(&packet, data, sizeof(SensorPacket));

  uint8_t id = packet.node_id;
  if (id == 2) {
    if (!node2_peer_added) {
      memcpy(node2_mac, mac_addr, 6);
      addEspNowPeerSafe(node2_mac);
      node2_peer_added = true;
    }
    nodes[2].gas       = (int)packet.gas_level;
    nodes[2].fire      = packet.flame_status;
    nodes[2].online    = true;
    nodes[2].last_seen = millis();
  } else if (id == 3) {
    if (!node3_peer_added) {
      memcpy(node3_mac, mac_addr, 6);
      addEspNowPeerSafe(node3_mac);
      node3_peer_added = true;
    }
    nodes[3].gas       = (int)packet.gas_level;
    nodes[3].fire      = packet.flame_status;
    nodes[3].online    = true;
    nodes[3].last_seen = millis();
  }
}

// ============================================================================
// 6. SOFTWARE SENSOR CALIBRATION & MATHEMATICAL CONDITIONING
// ============================================================================
void loadCalibrationFromFlash() {
  prefs.begin("hfire_cal", false);
  mq2_R0 = prefs.getFloat("mq2_r0", 10.0);
  flame_ambient_baseline = prefs.getInt("flame_base", 2800);
  flame_trigger_delta = prefs.getInt("flame_delta", 600);
  threshold_safe_ppm = prefs.getInt("safe_ppm", 450);
  threshold_danger_ppm = prefs.getInt("danger_ppm", 1500);
  prefs.end();
  Serial.printf("[Flash] Loaded Calibration: R0=%.2f kOhm, FlameBase=%d mV, Delta=%d mV, Safe=%d PPM, Danger=%d PPM\n", 
                mq2_R0, flame_ambient_baseline, flame_trigger_delta, threshold_safe_ppm, threshold_danger_ppm);
}

// Convert ADC millivolts to Sensor Resistance Rs in kilo-ohms
float calculateRs(int millivolts) {
  if (millivolts <= 50) millivolts = 50;
  if (millivolts >= 3250) millivolts = 3250;
  float vOut = (float)millivolts / 1000.0;
  return MQ2_RL_VALUE * (3.3 - vOut) / vOut;
}

// Calibrate R0 in Clean Ambient Air (50 samples over 2.5 seconds)
float calibrateMQ2CleanAir() {
  float totalRs = 0;
  const int SAMPLES = 50;
  for (int i = 0; i < SAMPLES; i++) {
    int mv = analogReadMilliVolts(PIN_MQ2_GAS);
    totalRs += calculateRs(mv);
    delay(50);
  }
  float avgRs = totalRs / SAMPLES;
  float derivedR0 = avgRs / MQ2_RO_CLEAN_AIR_FACTOR;
  if (derivedR0 < 1.0) derivedR0 = 1.0;
  return derivedR0;
}

// Calculate true PPM using Hanwei MQ-2 Datasheet Power-Law Curve PPM = A * (Rs/R0)^B
int readCalculatedPPM() {
  int mv = analogReadMilliVolts(PIN_MQ2_GAS);
  float rs = calculateRs(mv);
  float ratio = rs / mq2_R0;
  if (ratio <= 0.0) return 0;
  float ppm = MQ2_CURVE_A * pow(ratio, MQ2_CURVE_B);
  if (ppm < 0) ppm = 0;
  if (ppm > 10000) ppm = 10000;
  return (int)ppm;
}

// Calibrated Optical Flame Detection (Analog Ambient Tare + Digital Fallback)
bool readCalibratedFlame() {
  int currentMv = analogReadMilliVolts(PIN_FLAME);
  bool irDrop = (flame_ambient_baseline - currentMv) > flame_trigger_delta;
  bool digitalActive = (digitalRead(PIN_FLAME) == HIGH);
  return (irDrop || digitalActive);
}

// ============================================================================
// 7. SATELLITE NODE WATCHDOG (Stale Offline Detection)
// ============================================================================
void runSecondaryNodesWatchdog() {
  unsigned long now = millis();
  for (int i = 2; i <= 3; i++) {
    if (nodes[i].online) {
      if (now - nodes[i].last_seen > NODE_TIMEOUT_MS) {
        // Satellite disconnected or powered down:
        nodes[i].online = false;
        nodes[i].gas    = 0;
        nodes[i].fire   = false;
      }
    }
  }
}

// ============================================================================
// 8. OLED DISPLAY RENDERER
// ============================================================================
void updateOledHUD(bool isWarning, bool isDanger) {
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);

  // Top Header: System Name + Connectivity
  display.setCursor(0, 0);
  display.print(F("H-FIRE CORE "));
  if (WiFi.status() == WL_CONNECTED) {
    display.print(mqttClient.connected() ? F("[CLOUD]") : F("[WIFI]"));
  } else {
    display.print(F("[OFFLINE]"));
  }

  display.drawLine(0, 9, 128, 9, SSD1306_WHITE);

  // 3-Sector Telemetry Grid
  for (int i = 1; i <= 3; i++) {
    int y = 12 + ((i - 1) * 13);
    display.setCursor(0, y);

    // Label
    display.print(F("N"));
    display.print(i);
    display.print(F(": "));

    if (i > 1 && !nodes[i].online) {
      display.print(F("OFFLINE"));
    } else {
      display.print(nodes[i].gas);
      display.print(F("ppm "));

      if (nodes[i].fire) {
        display.print(F("[!FIRE!]"));
      } else if (nodes[i].gas >= threshold_danger_ppm) {
        display.print(F("[!GAS!]"));
      } else if (nodes[i].gas > threshold_safe_ppm) {
        display.print(F("[WARN]"));
      } else {
        display.print(F("[OK]"));
      }
    }
  }

  // Footer Safety Halo
  display.drawLine(0, 52, 128, 52, SSD1306_WHITE);
  display.setCursor(0, 55);
  if (isDanger) {
    display.print(F(">> DANGER: ALARM ON <<"));
  } else if (isWarning) {
    display.print(F(">> WARNING: HAZARD <<"));
  } else {
    display.print(F("System Status: ALL SAFE"));
  }

  display.display();
}

// ============================================================================
// 9. BUZZER SIREN CONTROLLER (Non-blocking)
// ============================================================================
void manageBuzzerAlarm(bool isWarning, bool isDanger) {
  unsigned long now = millis();

  if (isDanger) {
    // Continuous High-Pitch Siren on Danger
    digitalWrite(PIN_BUZZER, HIGH);
  } else if (isWarning) {
    // Intermittent Alert Beeps on Warning (500ms ON, 500ms OFF)
    if (now - lastBeepToggleMillis >= 500) {
      lastBeepToggleMillis = now;
      buzzerBeepState = !buzzerBeepState;
      digitalWrite(PIN_BUZZER, buzzerBeepState ? HIGH : LOW);
    }
  } else {
    // Completely Silent on Normal
    digitalWrite(PIN_BUZZER, LOW);
    buzzerBeepState = false;
  }
}

// ============================================================================
// 10. MQTT TELEMETRY TRANSMITTER (Unified JSON Payload)
// ============================================================================
void publishMqttTelemetry(const char* overallStatus) {
  if (!mqttClient.connected()) return;

  // JSON payload structure matching AdminContext.tsx & hivemq-bridge.js
  String json = "{";
  json += "\"mac\":\"" + coreMacAddress + "\",";
  
  // Core Node (N1)
  json += "\"N1_Gas\":" + String(nodes[1].gas) + ",";
  json += "\"N1_Fire\":" + String(nodes[1].fire ? 1 : 0) + ",";
  
  // Secondary Node 2 (Living Room)
  json += "\"N2_Gas\":" + String(nodes[2].gas) + ",";
  json += "\"N2_Fire\":" + String(nodes[2].fire ? 1 : 0) + ",";
  json += "\"N2_Online\":" + String(nodes[2].online ? 1 : 0) + ",";
  
  // Secondary Node 3 (Bedroom / Sector 3)
  json += "\"N3_Gas\":" + String(nodes[3].gas) + ",";
  json += "\"N3_Fire\":" + String(nodes[3].fire ? 1 : 0) + ",";
  json += "\"N3_Online\":" + String(nodes[3].online ? 1 : 0) + ",";

  json += "\"status\":\"" + String(overallStatus) + "\"";
  json += "}";

  mqttClient.publish(TOPIC_DATA, json.c_str());
}

// ============================================================================
// 10.5 INBOUND MQTT COMMAND LISTENER (Software Remote Calibration)
// ============================================================================
void onMqttCommand(char* topic, byte* payload, unsigned int length) {
  String msg = "";
  for (unsigned int i = 0; i < length; i++) msg += (char)payload[i];
  Serial.print(F("[MQTT Command] "));
  Serial.println(msg);

  if (msg.indexOf("CALIBRATE_MQ2") >= 0) {
    display.clearDisplay();
    display.setTextSize(1);
    display.setTextColor(SSD1306_WHITE);
    display.setCursor(0, 8);
    display.println(F("CALIBRATING MQ-2"));
    display.drawLine(0, 18, 128, 18, SSD1306_WHITE);
    display.setCursor(0, 26);
    display.println(F("Sampling clean air..."));
    display.setCursor(0, 42);
    display.println(F("Hold sensor in room"));
    display.setCursor(0, 54);
    display.println(F("Please wait 3 sec"));
    display.display();

    float derivedR0 = calibrateMQ2CleanAir();
    mq2_R0 = derivedR0;

    prefs.begin("hfire_cal", false);
    prefs.putFloat("mq2_r0", mq2_R0);
    prefs.end();

    broadcastCommandToSatellites(2); // Tare satellites MQ2
    String ack = "{\"event\":\"CAL_SUCCESS\",\"sensor\":\"MQ2\",\"mac\":\"" + coreMacAddress + "\",\"R0\":" + String(mq2_R0, 2) + "}";
    mqttClient.publish(TOPIC_DATA, ack.c_str());
    Serial.printf("[Calibration] MQ-2 Baseline R0 saved: %.2f kOhm\n", mq2_R0);
  } else if (msg.indexOf("TARE_FLAME") >= 0) {
    int currentMv = analogReadMilliVolts(PIN_FLAME);
    flame_ambient_baseline = currentMv;

    prefs.begin("hfire_cal", false);
    prefs.putInt("flame_base", flame_ambient_baseline);
    prefs.end();

    broadcastCommandToSatellites(3); // Tare satellites Flame
    String ack = "{\"event\":\"CAL_SUCCESS\",\"sensor\":\"FLAME\",\"mac\":\"" + coreMacAddress + "\",\"baseline\":" + String(flame_ambient_baseline) + "}";
    mqttClient.publish(TOPIC_DATA, ack.c_str());
    Serial.printf("[Calibration] Flame Ambient Baseline saved: %d mV\n", flame_ambient_baseline);
  } else if (msg.indexOf("SET_FLAME_DELTA") >= 0) {
    int idx = msg.indexOf("\"delta\":");
    if (idx < 0) idx = msg.indexOf("delta:");
    if (idx >= 0) {
      int parsedDelta = msg.substring(idx + 6).replace("\"", "").replace(":", "").replace(" ", "").toInt();
      if (parsedDelta >= 150 && parsedDelta <= 3000) {
        flame_trigger_delta = parsedDelta;
        prefs.begin("hfire_cal", false);
        prefs.putInt("flame_delta", flame_trigger_delta);
        prefs.end();

        broadcastCommandToSatellites(1); // Sync delta
        String ack = "{\"event\":\"CAL_SUCCESS\",\"sensor\":\"FLAME_DELTA\",\"mac\":\"" + coreMacAddress + "\",\"delta\":" + String(flame_trigger_delta) + "}";
        mqttClient.publish(TOPIC_DATA, ack.c_str());
        Serial.printf("[Calibration] Flame Trigger Delta updated: %d mV\n", flame_trigger_delta);
      }
    }
  } else if (msg.indexOf("SET_THRESHOLDS") >= 0) {
    int idxSafe = msg.indexOf("\"safe\":");
    if (idxSafe < 0) idxSafe = msg.indexOf("safe:");
    int idxDanger = msg.indexOf("\"danger\":");
    if (idxDanger < 0) idxDanger = msg.indexOf("danger:");

    if (idxSafe >= 0 && idxDanger >= 0) {
      int parsedSafe = msg.substring(idxSafe + 5).replace("\"", "").replace(":", "").replace(" ", "").toInt();
      int parsedDanger = msg.substring(idxDanger + 7).replace("\"", "").replace(":", "").replace(" ", "").toInt();

      if (parsedSafe >= 100 && parsedDanger > parsedSafe) {
        threshold_safe_ppm = parsedSafe;
        threshold_danger_ppm = parsedDanger;

        prefs.begin("hfire_cal", false);
        prefs.putInt("safe_ppm", threshold_safe_ppm);
        prefs.putInt("danger_ppm", threshold_danger_ppm);
        prefs.end();

        broadcastCommandToSatellites(1); // Sync safe/danger
        String ack = "{\"event\":\"CAL_SUCCESS\",\"sensor\":\"THRESHOLDS\",\"mac\":\"" + coreMacAddress + "\",\"safe\":" + String(threshold_safe_ppm) + ",\"danger\":" + String(threshold_danger_ppm) + "}";
        mqttClient.publish(TOPIC_DATA, ack.c_str());
        Serial.printf("[Calibration] Dynamic Thresholds updated: Safe=%d, Danger=%d\n", threshold_safe_ppm, threshold_danger_ppm);
      }
    }
  } else if (msg.indexOf("GET_CALIBRATION") >= 0) {
    String state = "{\"event\":\"CAL_STATUS\",\"mac\":\"" + coreMacAddress + "\",";
    state += "\"mq2_r0\":" + String(mq2_R0, 2) + ",";
    state += "\"flame_base\":" + String(flame_ambient_baseline) + ",";
    state += "\"flame_delta\":" + String(flame_trigger_delta) + ",";
    state += "\"safe_ppm\":" + String(threshold_safe_ppm) + ",";
    state += "\"danger_ppm\":" + String(threshold_danger_ppm);
    state += "}";
    mqttClient.publish(TOPIC_DATA, state.c_str());
    Serial.println(F("[Calibration] Sent current calibration state via MQTT"));
  } else if (msg.indexOf("RESET_WIFI") >= 0) {
    display.clearDisplay();
    display.setTextSize(1);
    display.setTextColor(SSD1306_WHITE);
    display.setCursor(0, 20);
    display.println(F("WIFI RESET VIA APP"));
    display.println(F("Rebooting AP..."));
    display.display();

    WiFiManager wm;
    wm.resetSettings();
    WiFi.disconnect(true, true);
    delay(1000);
    ESP.restart();
  }
}

// ============================================================================
// 11. NON-BLOCKING MQTT & WIFI RECONNECTION
// ============================================================================
void maintainMqttConnection() {
  if (WiFi.status() != WL_CONNECTED) return;

  if (!mqttClient.connected()) {
    unsigned long now = millis();
    if (now - lastMqttReconnectAttempt > 5000) {
      lastMqttReconnectAttempt = now;
      String clientId = "HFire_Core_" + String(random(1000, 9999));
      
      if (mqttClient.connect(clientId.c_str(), MQTT_USER, MQTT_PASS)) {
        mqttClient.publish(TOPIC_STATUS, "Core Gateway Online");
        mqttClient.subscribe(TOPIC_COMMAND);
      }
    }
  } else {
    mqttClient.loop();
  }
}

// ============================================================================
// 12. WIFI SETUP VIA CAPTIVE PORTAL (WiFiManager)
// ============================================================================
void configModeCallback(WiFiManager *myWiFiManager) {
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.println(F("WIFI SETUP MODE"));
  display.drawLine(0, 9, 128, 9, SSD1306_WHITE);
  display.setCursor(0, 13);
  display.print(F("MAC: "));
  display.println(coreMacAddress);
  display.setCursor(0, 27);
  display.println(F("1. Connect Phone to:"));
  display.println(F("   [ H-Fire-Gateway ]"));
  display.setCursor(0, 49);
  display.println(F("2. Open 192.168.4.1"));
  display.display();
}

void setupWiFi() {
  WiFiManager wm;
  wm.setAPCallback(configModeCallback);
  wm.setConfigPortalTimeout(180); // 3-minute timeout for comfortable entry

  // 1. Set Title shown on 192.168.4.1
  wm.setTitle("H-FIRE EMERGENCY IOT GATEWAY");

  // 2. Custom CSS: Injects Dark Theme matching H-Fire Mobile App
  String customHead = F(
    "<style>"
    "body{background:#0B0F19 !important;color:#F9FAFB !important;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif !important;margin:0;padding:20px;text-align:center;}"
    "h1{color:#EF4444 !important;font-size:20px !important;margin-bottom:6px !important;letter-spacing:0.5px;}"
    "h3{color:#9CA3AF !important;font-size:12px !important;margin-bottom:18px !important;font-weight:normal;}"
    ".c{background:#111827 !important;border:1px solid #374151 !important;border-radius:12px !important;padding:20px !important;max-width:380px !important;margin:0 auto !important;box-shadow:0 8px 24px rgba(0,0,0,0.6) !important;}"
    "div,p,label{color:#9CA3AF !important;font-size:13px !important;}"
    "input[type='text'],input[type='password']{background:#1E293B !important;border:1px solid #334155 !important;border-radius:8px !important;color:#F9FAFB !important;padding:12px !important;box-sizing:border-box !important;margin:6px 0 14px 0 !important;width:100% !important;font-size:14px !important;}"
    "input[type='text']:focus,input[type='password']:focus{border-color:#3B82F6 !important;outline:none !important;box-shadow:0 0 0 2px rgba(59,130,246,0.3) !important;}"
    "button,input[type='submit']{background:#3B82F6 !important;color:#FFFFFF !important;border:none !important;border-radius:8px !important;padding:12px 20px !important;font-size:14px !important;font-weight:bold !important;cursor:pointer !important;width:100% !important;margin:8px 0 !important;transition:background 0.2s !important;}"
    "button:hover,input[type='submit']:hover{background:#2563EB !important;}"
    "a{color:#38BDF8 !important;text-decoration:none !important;font-weight:500;}"
    ".mac-badge{background:#1F2937;border:1px solid #374151;color:#60A5FA;font-family:monospace;font-size:12px;padding:6px 12px;border-radius:6px;margin:12px auto;display:inline-block;}"
    "</style>"
  );
  wm.setCustomHeadElement(customHead.c_str());

  // 3. Menu items visible on 192.168.4.1
  const char* menu[] = {"wifi", "info", "restart", "exit"};
  wm.setMenu(menu, 4);

  // 4. Hotspot Wi-Fi AP Name to connect to
  const char* apSSID = "H-Fire-Gateway";

  if (!wm.autoConnect(apSSID)) {
    Serial.println(F("WiFi Connection timed out. Running in OFFLINE mode."));
  } else {
    Serial.println(F("WiFi successfully connected!"));
  }

  coreMacAddress = WiFi.macAddress();
  espClient.setInsecure(); // Required for HiveMQ Cloud TLS handshake
  mqttClient.setServer(MQTT_SERVER, MQTT_PORT);
  mqttClient.setBufferSize(512);
  mqttClient.setCallback(onMqttCommand);
}

void checkFactoryResetButton() {
  if (digitalRead(PIN_RESET_BTN) == LOW) {
    unsigned long pressStart = millis();
    while (digitalRead(PIN_RESET_BTN) == LOW) {
      if (millis() - pressStart > 3000) {
        display.clearDisplay();
        display.setTextSize(1);
        display.setCursor(0, 20);
        display.println(F("RESETTING WIFI..."));
        display.display();
        
        WiFiManager wm;
        wm.resetSettings();
        WiFi.disconnect(true, true);
        delay(1500);
        ESP.restart();
      }
    }
  }
}

// ============================================================================
// 13. MAIN SETUP ROUTINE
// ============================================================================
void setup() {
  Serial.begin(115200);
  loadCalibrationFromFlash();

  pinMode(PIN_FLAME, INPUT_PULLUP);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_RESET_BTN, INPUT_PULLUP);
  digitalWrite(PIN_BUZZER, LOW);

  // Initialize SSD1306 Display
  Wire.begin();
  if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_I2C_ADDRESS)) {
    Serial.println(F("SSD1306 Allocation Failed!"));
    for (;;);
  }

  // Wake Wi-Fi STA to read hardware MAC address immediately on boot
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  delay(150);
  coreMacAddress = WiFi.macAddress();

  Serial.println(F("========================================"));
  Serial.println(F("🔥 H-FIRE CORE GATEWAY STARTING"));
  Serial.print(F("📡 CORE MAC ADDRESS: "));
  Serial.println(coreMacAddress);
  Serial.println(F("========================================"));

  // Display Boot Splash with Prominent MAC Address (4 Seconds)
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.println(F("H-FIRE CORE GATEWAY"));
  display.drawLine(0, 10, 128, 10, SSD1306_WHITE);
  
  display.setCursor(0, 16);
  display.println(F("CORE MAC ADDRESS:"));
  display.setCursor(0, 28);
  display.setTextSize(1);
  display.println(coreMacAddress);

  display.drawLine(0, 42, 128, 42, SSD1306_WHITE);
  display.setCursor(0, 48);
  display.println(F("Node 1: Master Unit"));
  display.setCursor(0, 56);
  display.println(F("Connecting to WiFi..."));
  display.display();
  delay(4000); // 4-second hold so user can read / copy MAC address

  // Proceed with Wi-Fi connection and captive portal setup
  setupWiFi();

  // Disable Wi-Fi power saving so ESP-NOW packets are never dropped
  esp_wifi_set_ps(WIFI_PS_NONE);

  // Initialize ESP-NOW
  if (esp_now_init() != ESP_OK) {
    Serial.println(F("Critical Error: ESP-NOW Init Failed!"));
  } else {
    esp_now_register_recv_cb((esp_now_recv_cb_t)OnDataRecv);
  addEspNowPeerSafe(broadcastAddress);
    Serial.println(F("ESP-NOW initialized and listener registered."));
  }

  // Initialize node states
  for (int i = 1; i <= 3; i++) {
    nodes[i].gas = 0;
    nodes[i].fire = false;
    nodes[i].online = (i == 1);
    nodes[i].last_seen = millis();
  }
}

// ============================================================================
// 14. MAIN LOOP (Zero Blocking Delays)
// ============================================================================
void loop() {
  unsigned long now = millis();
  checkFactoryResetButton();
  maintainMqttConnection();
  runSecondaryNodesWatchdog();

  // Read Local Core Sensors & Evaluate Hazards every 500ms
  if (now - lastSensorReadMillis >= 500) {
    lastSensorReadMillis = now;

    // 1. Read Node 1 Local Sensors
    nodes[1].gas       = readCalculatedPPM();
    nodes[1].fire      = readCalibratedFlame();
    nodes[1].online    = true;
    nodes[1].last_seen = now;

    // 2. Evaluate Multi-Node Overall Hazard State
    bool isDanger  = false;
    bool isWarning = false;

    for (int i = 1; i <= 3; i++) {
      if (nodes[i].online) {
        if (nodes[i].fire || nodes[i].gas >= threshold_danger_ppm) {
          isDanger = true;
        } else if (nodes[i].gas > threshold_safe_ppm) {
          isWarning = true;
        }
      }
    }

    const char* overallStatus = isDanger ? "Danger" : (isWarning ? "Warning" : "Normal");

    // 3. Drive Buzzer & OLED HUD
    manageBuzzerAlarm(isWarning, isDanger);
    updateOledHUD(isWarning, isDanger);

    // 4. Publish Telemetry to HiveMQ Cloud (every 1000ms or immediately on hazard)
    static String lastPublishedStatus = "Normal";
    bool statusChanged = (String(overallStatus) != lastPublishedStatus);

    if (now - lastMqttPublishMillis >= 1000 || statusChanged) {
      lastMqttPublishMillis = now;
      lastPublishedStatus = overallStatus;
      publishMqttTelemetry(overallStatus);
    }
  }
}
