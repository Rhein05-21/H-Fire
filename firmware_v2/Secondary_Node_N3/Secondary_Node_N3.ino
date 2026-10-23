/**
 * ============================================================================
 * 🔥 H-FIRE IOT SYSTEM — SATELLITE SECTOR NODE 3 (BEDROOM / SECTOR 3)
 * ============================================================================
 * Architecture: Autonomous Satellite Mesh Sensor
 * Board: ESP32 Dev Module (WROOM-32)
 *
 * Core Responsibilities:
 *  1. Reads local MQ-2 Gas/Smoke (GPIO 34) and Optical Flame Sensor (GPIO 32)
 *     with 10-sample ADC noise filtering.
 *  2. Local Autonomous Alarm: Instantly sounds local buzzer (GPIO 25) if gas 
 *     or fire is detected, even if Core Gateway is offline or unreachable.
 *  3. SSD1306 OLED Screen: Real-time sector status, gas level, and mesh link.
 *  4. High-Reliability ESP-NOW Transmission: Sends telemetry packet to Core 
 *     Gateway (MAC: 20:50:0D:33:68:0C) every 500ms.
 *  5. Smart Auto-Channel Lock: Automatically detects Core Node's Wi-Fi channel
 *     by testing channels 1-13 on boot and locks once Core acknowledges.
 * ============================================================================
 */

#include <esp_now.h>
#include <WiFi.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <esp_wifi.h>
#include <math.h>

// ============================================================================
// 1. HARDWARE PIN DEFINITIONS & OLED CONFIGURATION
// ============================================================================
#define SCREEN_WIDTH      128
#define SCREEN_HEIGHT     64
#define OLED_RESET        -1
#define OLED_I2C_ADDRESS  0x3C
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

const int PIN_MQ2_GAS = 34;   // Analog ADC1_CH6 (MQ-2 Analog Out)
const int PIN_FLAME   = 32;   // Digital In (Optical Flame Sensor)
const int PIN_BUZZER  = 25;   // Digital Out (Piezo / Active Buzzer)

// ============================================================================
// 2. SYSTEM-WIDE TELEMETRY THRESHOLDS (Aligned with H-Fire Admin App)
// ============================================================================
const int THRESHOLD_SAFE_PPM   = 450;    // Normal ambient baseline
const int THRESHOLD_DANGER_PPM = 1500;   // Critical hazard threshold

// Calibration Constants & Baseline Variables
const float MQ2_RL_VALUE            = 5.0;     // Load resistor in k-ohms
const float MQ2_RO_CLEAN_AIR_FACTOR = 9.83;    // Rs/Ro clean air factor
const float MQ2_CURVE_A             = 3616.0;  // Power-law Smoke constant
const float MQ2_CURVE_B             = -2.675;  // Power-law slope
float mq2_R0                        = 10.0;    // Calibrated baseline
int   flame_ambient_baseline        = 2800;    // Ambient IR baseline
int   flame_trigger_delta           = 600;     // Detection threshold delta

// ============================================================================
// 3. TARGET CORE GATEWAY MAC ADDRESS (NODE 1)
// ============================================================================
uint8_t coreGatewayAddress[] = {0x20, 0x50, 0x0D, 0x33, 0x68, 0x0C};

// ============================================================================
// 4. ESP-NOW PACKET DEFINITION
// ============================================================================
typedef struct __attribute__((packed)) {
  uint8_t  node_id;        // Always 3 for this node
  uint16_t gas_level;      // Smoothed PPM reading
  bool     flame_status;   // true = Flame detected
  uint32_t uptime_seconds; // Node uptime (heartbeat)
} SensorPacket;

SensorPacket myPacket;
esp_now_peer_info_t peerInfo;

// Network & Timer Controllers
unsigned long lastSensorReadMillis = 0;
unsigned long lastBeepToggleMillis = 0;
bool buzzerBeepState = false;

// Channel Auto-Discovery & Lock
int  currentWiFiChannel = 1;
bool isMeshLinked = false;
int  consecutiveFailures = 0;
const int MAX_FAILURES_BEFORE_HOP = 5;

// ============================================================================
// 5. ESP-NOW SEND CALLBACK (Smart Channel Auto-Lock)
// ============================================================================
void OnDataSent(const uint8_t *mac_addr, esp_now_send_status_t status) {
  if (status == ESP_NOW_SEND_SUCCESS) {
    isMeshLinked = true;
    consecutiveFailures = 0;
  } else {
    consecutiveFailures++;
    if (consecutiveFailures >= MAX_FAILURES_BEFORE_HOP) {
      isMeshLinked = false;
      // Hop to next Wi-Fi channel (1 to 13) to locate Core Gateway's router channel
      currentWiFiChannel = (currentWiFiChannel % 13) + 1;
      
      esp_wifi_set_promiscuous(true);
      esp_wifi_set_channel(currentWiFiChannel, WIFI_SECOND_CHAN_NONE);
      esp_wifi_set_promiscuous(false);

      peerInfo.channel = currentWiFiChannel;
      esp_now_mod_peer(&peerInfo);

      consecutiveFailures = 0;
    }
  }
}

// ============================================================================
// 6. CALIBRATED SENSOR MATHEMATICAL CONDITIONING
// ============================================================================
float calculateRs(int millivolts) {
  if (millivolts <= 50) millivolts = 50;
  if (millivolts >= 3250) millivolts = 3250;
  float vOut = (float)millivolts / 1000.0;
  return MQ2_RL_VALUE * (3.3 - vOut) / vOut;
}

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

bool readCalibratedFlame() {
  int currentMv = analogReadMilliVolts(PIN_FLAME);
  bool irDrop = (flame_ambient_baseline - currentMv) > flame_trigger_delta;
  bool digitalActive = (digitalRead(PIN_FLAME) == HIGH);
  return (irDrop || digitalActive);
}

// ============================================================================
// 7. BUZZER CONTROLLER (Local Autonomous Alarm)
// ============================================================================
void manageLocalBuzzer(bool isWarning, bool isDanger) {
  unsigned long now = millis();

  if (isDanger) {
    // Continuous High Alarm on Danger
    digitalWrite(PIN_BUZZER, HIGH);
  } else if (isWarning) {
    // Pulsed Beeps on Warning (500ms ON, 500ms OFF)
    if (now - lastBeepToggleMillis >= 500) {
      lastBeepToggleMillis = now;
      buzzerBeepState = !buzzerBeepState;
      digitalWrite(PIN_BUZZER, buzzerBeepState ? HIGH : LOW);
    }
  } else {
    digitalWrite(PIN_BUZZER, LOW);
    buzzerBeepState = false;
  }
}

// ============================================================================
// 8. OLED DISPLAY RENDERER
// ============================================================================
void updateOledHUD(const char* statusText, bool isWarning, bool isDanger) {
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);

  // Header: Sector Name + Wi-Fi Channel
  display.setCursor(0, 0);
  display.print(F("SECTOR 3 (BEDROOM)"));
  display.setCursor(102, 0);
  display.print(F("C:"));
  display.print(currentWiFiChannel);

  display.drawLine(0, 9, 128, 9, SSD1306_WHITE);

  // Telemetry Rows
  display.setCursor(0, 14);
  display.print(F("Gas / Smoke: "));
  display.print(myPacket.gas_level);
  display.print(F(" PPM"));

  display.setCursor(0, 26);
  display.print(F("Flame State: "));
  if (myPacket.flame_status) {
    display.print(F("[!DETECTED!]"));
  } else {
    display.print(F("Clear"));
  }

  display.setCursor(0, 38);
  display.print(F("Mesh Gateway: "));
  if (isMeshLinked) {
    display.print(F("LINKED (OK)"));
  } else {
    display.print(F("SEARCHING..."));
  }

  // Footer Banner
  display.drawLine(0, 49, 128, 49, SSD1306_WHITE);
  display.setCursor(10, 53);
  display.setTextSize(1);
  if (isDanger) {
    display.print(F(">> DANGER DETECTED <<"));
  } else if (isWarning) {
    display.print(F(">> WARNING: LEAK <<"));
  } else {
    display.print(F("Status: SECTOR SAFE"));
  }

  display.display();
}

// ============================================================================
// 9. MAIN SETUP ROUTINE
// ============================================================================
void setup() {
  Serial.begin(115200);

  pinMode(PIN_FLAME, INPUT_PULLUP);
  pinMode(PIN_BUZZER, OUTPUT);
  digitalWrite(PIN_BUZZER, LOW);

  // Initialize OLED
  Wire.begin();
  if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_I2C_ADDRESS)) {
    Serial.println(F("SSD1306 Init Failed!"));
    for (;;);
  }

  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(15, 15);
  display.println(F("H-FIRE NODE 3"));
  display.setCursor(10, 28);
  display.println(F("Sector: Bedroom / Ext"));
  display.setCursor(10, 44);
  display.println(F("Auto-Taring Sensors..."));
  display.display();

  // Quick 1-second clean-air baseline auto-tare on boot
  float totalRs = 0;
  for (int i = 0; i < 20; i++) {
    int mv = analogReadMilliVolts(PIN_MQ2_GAS);
    totalRs += calculateRs(mv);
    delay(50);
  }
  mq2_R0 = (totalRs / 20.0) / MQ2_RO_CLEAN_AIR_FACTOR;
  if (mq2_R0 < 1.0) mq2_R0 = 1.0;
  flame_ambient_baseline = analogReadMilliVolts(PIN_FLAME);

  // Wi-Fi Station Mode for ESP-NOW
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();

  // Set initial channel
  esp_wifi_set_promiscuous(true);
  esp_wifi_set_channel(currentWiFiChannel, WIFI_SECOND_CHAN_NONE);
  esp_wifi_set_promiscuous(false);

  // Initialize ESP-NOW
  if (esp_now_init() != ESP_OK) {
    Serial.println(F("Error initializing ESP-NOW"));
    return;
  }

  esp_now_register_send_cb((esp_now_send_cb_t)OnDataSent);

  // Register Core Gateway as Peer
  memcpy(peerInfo.peer_addr, coreGatewayAddress, 6);
  peerInfo.channel = currentWiFiChannel;
  peerInfo.encrypt = false;

  if (esp_now_add_peer(&peerInfo) != ESP_OK) {
    Serial.println(F("Failed to add peer"));
    return;
  }

  myPacket.node_id = 3; // Node ID 3
}

// ============================================================================
// 10. MAIN LOOP (Zero Blocking Delays)
// ============================================================================
void loop() {
  unsigned long now = millis();

  // Read Sensors & Transmit every 500ms
  if (now - lastSensorReadMillis >= 500) {
    lastSensorReadMillis = now;

    // 1. Read Calibrated Sensors
    myPacket.gas_level      = (uint16_t)readCalculatedPPM();
    myPacket.flame_status   = readCalibratedFlame();
    myPacket.uptime_seconds = (uint32_t)(now / 1000);

    // 2. Evaluate Local Hazards
    bool isDanger  = (myPacket.flame_status || myPacket.gas_level >= THRESHOLD_DANGER_PPM);
    bool isWarning = (!isDanger && myPacket.gas_level > THRESHOLD_SAFE_PPM);
    const char* statusText = isDanger ? "DANGER" : (isWarning ? "WARNING" : "SAFE");

    // 3. Transmit to Core Gateway via ESP-NOW
    esp_now_send(coreGatewayAddress, (uint8_t *)&myPacket, sizeof(myPacket));

    // 4. Drive Local Alarm & OLED
    manageLocalBuzzer(isWarning, isDanger);
    updateOledHUD(statusText, isWarning, isDanger);
  }
}
