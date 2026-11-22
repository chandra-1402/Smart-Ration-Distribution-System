#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <ESP32Servo.h>
#include <Wire.h> 
#include <LiquidCrystal_I2C.h> 
#include "HX711.h"

// --- YOUR WIFI CREDENTIALS ---
const char* ssid = "Redmi 12";
const char* password = "chandan00"; 

// --- PRODUCTION DEPLOYMENT URL ---
String serverUrl = "https://rationsetu.uniqway.online/api/hardware/sync";

// --- PINS ---
const int LOADCELL_DOUT_PIN = 16;
const int LOADCELL_SCK_PIN = 4;
const int SERVO_PIN = 18;
const int LED_RED = 25;
const int LED_YELLOW = 26;
const int LED_GREEN = 27;
const int BUZZER_PIN = 23; // Connect Buzzer module signal pin (GPIO 23)

// ==============================================================
// BUZZER CONFIGURATION
// 3-Pin Buzzer Modules (VCC, I/O, GND) are Active-LOW modules:
// - Pin HIGH (3.3V) = SILENT (OFF)
// - Pin LOW  (0V)   = BEEP (ON)
// ==============================================================
const bool BUZZER_IS_ACTIVE_HIGH = false; // false = Active-LOW module (standard for 3-pin modules)
const int BUZZER_ON  = BUZZER_IS_ACTIVE_HIGH ? HIGH : LOW;   // LOW turns buzzer ON
const int BUZZER_OFF = BUZZER_IS_ACTIVE_HIGH ? LOW  : HIGH;  // HIGH turns buzzer OFF (Silent)

HX711 scale;
Servo dispenserServo;
LiquidCrystal_I2C lcd(0x27, 16, 2); 

String currentStatus = "IDLE";
float currentWeight = 0.0;
float targetWeight = 0.0;

// Helper function to produce buzzer beep sounds
void beepBuzzer(int times, int durationMs, int pauseMs) {
  for (int i = 0; i < times; i++) {
    digitalWrite(BUZZER_PIN, BUZZER_ON);
    delay(durationMs);
    digitalWrite(BUZZER_PIN, BUZZER_OFF);
    if (i < times - 1) {
      delay(pauseMs);
    }
  }
}

void setup() {
  // Pre-latch pin to HIGH (OFF) before enabling output mode to prevent any startup click
  digitalWrite(BUZZER_PIN, BUZZER_OFF);
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, BUZZER_OFF);

  Serial.begin(115200);
  delay(1000);
  
  pinMode(LED_RED, OUTPUT);
  pinMode(LED_YELLOW, OUTPUT);
  pinMode(LED_GREEN, OUTPUT);
  digitalWrite(LED_RED, LOW);
  digitalWrite(LED_YELLOW, LOW);
  digitalWrite(LED_GREEN, LOW);

  lcd.init();
  lcd.backlight();
  lcd.setCursor(0,0);
  lcd.print("System Booting..");

  WiFi.begin(ssid, password);
  WiFi.setSleep(false); // Prevents WiFi dropping
  
  while (WiFi.status() != WL_CONNECTED) { 
    Serial.print(".");
    delay(500); 
  }
  Serial.println("\nWiFi Connected!");
  lcd.setCursor(0,0);
  lcd.print("WiFi Connected! ");
  delay(1000);

  // STARTING THE REAL LOAD CELL
  Serial.println("Initializing Load Cell...");
  lcd.clear();
  lcd.setCursor(0,0);
  lcd.print("Init Load Cell..");
  scale.begin(LOADCELL_DOUT_PIN, LOADCELL_SCK_PIN);
  
  // ---> CHANGE THIS TO YOUR EXACT FACTOR IF IT IS TOO FAST/SLOW <---
  scale.set_scale(-100000.0); 
  
  // WAIT FOR HX711 WITH TIMEOUT
  long startWait = millis();
  while (!scale.is_ready() && millis() - startWait < 3000) {
    delay(10);
  }
  
  if (scale.is_ready()) {
    scale.tare(); // Resets scale to 0
  } else {
    Serial.println("HX711 Not Ready! Skipping Tare...");
    lcd.setCursor(0,1);
    lcd.print("HX711 Error!  ");
    delay(2000);
  }

  lcd.clear();
  lcd.setCursor(0,0);
  lcd.print("Init Servo...   ");
  dispenserServo.attach(SERVO_PIN);
  dispenserServo.write(0); // Start with gate CLOSED
  digitalWrite(LED_YELLOW, HIGH); 
}

void loop() {
  // Ensure buzzer is strictly off in regular operation
  digitalWrite(BUZZER_PIN, BUZZER_OFF);

  if (WiFi.status() == WL_CONNECTED) {
    
    // READ THE REAL PHYSICAL WEIGHT
    if (scale.is_ready()) {
      currentWeight = scale.get_units(1);
      if (currentWeight < 0) currentWeight = 0.0; // Prevents negative numbers
    }

    WiFiClientSecure client;
    client.setInsecure(); // Required to connect to HTTPS (Render) without verifying SSL certificates
    HTTPClient http;
    http.begin(client, serverUrl);
    http.addHeader("Content-Type", "application/json");

    DynamicJsonDocument txDoc(1024);
    txDoc["device_id"] = "ESP32_01";
    txDoc["current_weight"] = currentWeight;
    
    JsonObject sensors = txDoc.createNestedObject("sensors");
    
    JsonObject sLoadCell = sensors.createNestedObject("load_cell");
    sLoadCell["status"] = scale.is_ready() ? "CONNECTED" : "UNPLUGGED";
    sLoadCell["value"] = String(currentWeight) + " kg";

    JsonObject sServo = sensors.createNestedObject("servo");
    sServo["status"] = "CONNECTED";
    sServo["value"] = currentStatus == "DISPENSING" ? "90 deg" : "0 deg";

    JsonObject sRed = sensors.createNestedObject("led_red");
    sRed["status"] = "CONNECTED";
    sRed["value"] = currentStatus == "STOP" ? "ON" : "OFF";

    JsonObject sYellow = sensors.createNestedObject("led_yellow");
    sYellow["status"] = "CONNECTED";
    sYellow["value"] = currentStatus == "IDLE" ? "ON" : "OFF";

    JsonObject sGreen = sensors.createNestedObject("led_green");
    sGreen["status"] = "CONNECTED";
    sGreen["value"] = currentStatus == "DISPENSING" ? "ON" : "OFF";

    JsonObject sLcd = sensors.createNestedObject("lcd");
    sLcd["status"] = "CONNECTED";
    sLcd["value"] = currentStatus;

    JsonObject sBuzzer = sensors.createNestedObject("buzzer");
    sBuzzer["status"] = "CONNECTED";
    sBuzzer["value"] = "READY";
    
    String payload;
    serializeJson(txDoc, payload);
    int httpResponseCode = http.POST(payload);

    if (httpResponseCode > 0) {
      String response = http.getString();
      DynamicJsonDocument rxDoc(1024);
      deserializeJson(rxDoc, response);
      
      String newStatus = rxDoc["status"].as<String>();
      if (newStatus == "COMPLETED") {
          newStatus = "STOP";
      }
      targetWeight = rxDoc["target_weight"].as<float>();
      String beneficiaryName = rxDoc.containsKey("beneficiary_name") ? rxDoc["beneficiary_name"].as<String>() : "";
      
      // --- DYNAMIC SAFETY LIMIT ---
      if (currentStatus == "DISPENSING" && currentWeight >= targetWeight) {
         dispenserServo.write(0); // INSTANTLY CLOSE GATE
         newStatus = "STOP";      // Force the system to stop
      }

      lcd.clear();
      lcd.setCursor(0, 0);
      
      if (newStatus == "IDLE") {
        
        // --- AUTO TARE: Zeros out the scale when idle! ---
        if (scale.is_ready()) {
          scale.tare();
          currentWeight = 0.0;
        }

        lcd.print("Ready. Awaiting");
        lcd.setCursor(0, 1);
        lcd.print("Verification...");
      } 
      else if (newStatus == "DISPENSING") {
        String firstLine = "Hi " + beneficiaryName;
        if (firstLine.length() > 16) firstLine = firstLine.substring(0, 16);
        lcd.print(firstLine);
        lcd.setCursor(0, 1);
        lcd.print("Weight: " + String(currentWeight, 2) + " kg");
      } 
      else if (newStatus == "STOP") {
        if (currentStatus == "DISPENSING") {
          // Handled in the Physical Hardware section below
        } else {
          if (currentWeight > 0.1) {
            lcd.print("Transaction Done");
            lcd.setCursor(0, 1);
            lcd.print("Remove Container");
          } else {
            lcd.print("Ready. Awaiting");
            lcd.setCursor(0, 1);
            lcd.print("Verification...");
          }
        }
      }

      // HANDLE PHYSICAL HARDWARE CHANGES
      if (newStatus == "DISPENSING" && currentStatus != "DISPENSING") {
         digitalWrite(LED_RED, LOW);
         digitalWrite(LED_YELLOW, LOW);
         digitalWrite(LED_GREEN, HIGH);
         dispenserServo.write(90); // OPEN GATE

         // 2 beeps of 1 second each to notify beneficiary dispensing has STARTED
         beepBuzzer(2, 1000, 500);
         digitalWrite(BUZZER_PIN, BUZZER_OFF);
      } 
      else if (newStatus == "STOP" && currentStatus == "DISPENSING") {
         digitalWrite(LED_RED, HIGH);
         digitalWrite(LED_YELLOW, LOW);
         digitalWrite(LED_GREEN, LOW);
         dispenserServo.write(0); // CLOSE GATE

         // Display Success Message and Freeze for 10 Seconds
         lcd.clear();
         lcd.setCursor(0, 0);
         lcd.print("SUCCESS!");
         lcd.setCursor(0, 1);
         lcd.print("Take your Ration");
         
         // 2 beeps of 1 second each to notify beneficiary transaction is COMPLETED
         beepBuzzer(2, 1000, 500);
         digitalWrite(BUZZER_PIN, BUZZER_OFF);
         
         delay(7500); // Wait remaining time (total 10 seconds) so user can take ration
      }
      else if (newStatus == "IDLE" && currentStatus != "IDLE") {
         digitalWrite(LED_RED, LOW);
         digitalWrite(LED_YELLOW, HIGH);
         digitalWrite(LED_GREEN, LOW);
         dispenserServo.write(0); // Ensure gate is closed
      }
      
      currentStatus = newStatus;
    } else {
      Serial.print("HTTP Error: ");
      Serial.println(httpResponseCode);
      lcd.clear();
      lcd.setCursor(0, 0);
      lcd.print("Server Error");
      lcd.setCursor(0, 1);
      lcd.print("Code: ");
      lcd.print(httpResponseCode);
    }
    http.end();
  }
  delay(1000); 
}
