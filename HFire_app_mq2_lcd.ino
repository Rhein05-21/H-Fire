#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

// Network & HiveMQ Credentials
const char* ssid = "TigleWifi";
const char* password = "TigleWifi2025";
const char* mqtt_server = "16e51255d95244c2b069b92cf77ebf81.s1.eu.hivemq.cloud";
const char* mqtt_user = "RheinTigle";
const char* mqtt_pass = "052105@Rhein";

// MQTT Topics
const char* topic_data = "hfire/house1/data";
const char* topic_status = "hfire/house1/status";

// Pins & Thresholds
const int MQ2_PIN = 34;
const int BUZZER_PIN = 25;
const int SAFE_LIMIT = 450;
const int DANGER_LIMIT = 1500;

WiFiClientSecure espClient;
PubSubClient client(espClient);
LiquidCrystal_I2C lcd(0x27, 16, 2);

String deviceMac = "";

void setup_wifi() {
  delay(10);
  Serial.println();
  Serial.print("Connecting to ");
  Serial.println(ssid);

  WiFi.begin(ssid, password);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("");
  Serial.println("WiFi connected");
  Serial.println("IP address: ");
  Serial.println(WiFi.localIP());

  // Capture the MAC address for unique identification
  deviceMac = WiFi.macAddress();
  
  // HiveMQ Cloud requires SSL/TLS
  espClient.setInsecure(); 
}

void reconnect() {
  while (!client.connected()) {
    Serial.print("Attempting MQTT connection...");
    // Using the MAC address as the unique Client ID
    if (client.connect(deviceMac.c_str(), mqtt_user, mqtt_pass)) {
      Serial.println("connected");
      client.publish(topic_status, "System Online");
    } else {
      Serial.print("failed, rc=");
      Serial.print(client.state());
      Serial.println(" try again in 5 seconds");
      delay(5000);
    }
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(BUZZER_PIN, OUTPUT);
  
  lcd.init();
  lcd.backlight();
  
  setup_wifi();
  
  // Show MAC address on boot for device identification
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("ID: ");
  lcd.print(deviceMac.substring(9)); // Shows the unique end part of the MAC
  lcd.setCursor(0, 1);
  lcd.print("System Ready");
  delay(3000);
  
  client.setServer(mqtt_server, 8883);
}

void loop() {
  if (!client.connected()) {
    reconnect();
  }
  client.loop();

  int ppm = analogRead(MQ2_PIN);
  String statusMsg;

  // Logic for Local & Remote Alerting
  if (ppm <= SAFE_LIMIT) {
    statusMsg = "SAFE";
    digitalWrite(BUZZER_PIN, LOW);
  } 
  else if (ppm > SAFE_LIMIT && ppm <= DANGER_LIMIT) {
    statusMsg = "WARNING: SMOKE";
    // Intermittent beep for warning
    digitalWrite(BUZZER_PIN, HIGH); 
    delay(100); 
    digitalWrite(BUZZER_PIN, LOW);
  } 
  else {
    statusMsg = "CRITICAL: FIRE/GAS";
    digitalWrite(BUZZER_PIN, HIGH); // Continuous alarm for danger
  }

  // Update LCD
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("PPM: "); 
  lcd.print(ppm);
  lcd.setCursor(0, 1); 
  lcd.print(statusMsg);

  // Publish to HiveMQ
  // We include the MAC address in the status topic to identify the device in the cloud
  String dataPayload = "{\"mac\":\"" + deviceMac + "\", \"ppm\":" + String(ppm) + "}";
  client.publish(topic_data, dataPayload.c_str());
  client.publish(topic_status, statusMsg.c_str());

  delay(2000); // 2-second reporting interval
}