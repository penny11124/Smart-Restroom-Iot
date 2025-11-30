//-------------Arduino的Library下載-------------------------
#include <Wire.h>
#include <WiFi.h>
String macAddr;
#include <ArduinoJson.h>

//--------------Config 針腳等設定-------------------------
#include "config.h"
//-----壓力感測器-------
#include "HX711.h"
#include "Timer.h"
// --- 註解 NBIOT ---
// AM7020
#include "./include/PubSubClient/src/PubSubClient.cpp"

//INA219
#include "./include/Adafruit_INA219/Adafruit_INA219.cpp"
Adafruit_INA219 ina219;

#define DOUT_PIN  22
#define SCK_PIN   23
#define MHZ16_RX_PIN 4
#define MHZ16_TX_PIN 5
#define BATTERY_CAPACITY_LIMIT_MAH 1000.0f

float accumulatedConsumption_mWh = 0.0f;
float energyIncrementmWh=0.0f;
float currentVoltageV = 0.0f;
float currentCurrentmA = 0.0f;
const float TIME_INTERVAL_HRS = (float)UPLOAD_INTERVAL / (1000.0f * 3600.0f);
// 創建 HX711 物件
HX711 scale;

// +++ 新增 WiFi +++
const char* wifi_ssid = "HSNL-EXP-AP";
const char* wifi_password = "hsnl33564";
Timer t;
WiFiClient tcpClient; // <--- 使用 WiFiClient
// --- 新增 WiFi 結束 ---

PubSubClient mqttClient(MQTT_BROKER, MQTT_PORT, tcpClient); // <-- 現在會自動使用上面的 WiFiClient


void setup() {

  setCpuFrequencyMhz(80);

  SerialMon.begin(MONITOR_BAUDRATE);
  SerialAT.begin(9600, SERIAL_8N1, MHZ16_RX_PIN, MHZ16_TX_PIN);
  // --- 註解 NBIOT 結束 ---

  randomSeed(analogRead(A0));
   
  // +++ 新增 WiFi +++
  SerialMon.println();
  SerialMon.print(F("Connecting to WiFi: "));
  SerialMon.println(wifi_ssid);
  WiFi.begin(wifi_ssid, wifi_password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    SerialMon.print(F("."));
  }
  SerialMon.println();
  SerialMon.println(F("WiFi Connected!"));
  SerialMon.print(F("IP address: "));
  SerialMon.println(WiFi.localIP());
  // --- 新增 WiFi 結束 ---

  // --- 註解 NBIOT ---
  // nbConnect();
  // --- 註解 NBIOT 結束 ---

  mqttClient.setCallback(mqttCallback);
  mqttClient.setKeepAlive(300);

  Wire.begin(INASDA, INASCL);

  pinMode(FAN, OUTPUT);
  pinMode(LED, OUTPUT);
  digitalWrite(FAN, HIGH);
  digitalWrite(LED, HIGH);

  Serial.println("HX711 Test...");
   
  // 啟動 HX711
  scale.begin(DOUT_PIN, SCK_PIN);

  //if (scale.is_ready()) {
  //  Serial.println("HX711 is ready!");
    // 執行歸零 (Taring)
    scale.set_scale(50.f);    // 這個校準值需要根據您的感測器調整
    scale.tare();               // 歸零
  //} else {
  //  Serial.println("HX711 not found.");
  //}

  // MH-Z16 
  Serial.println("MH-Z16 UART init done"); // +++ 新增 UART +++

  WiFi.mode(WIFI_MODE_STA); // 這行本來就有，很好
  macAddr = WiFi.macAddress();
  macAddr.replace(":", "");
  Serial.println("MacAdress : " + macAddr);
}

long fanCloseTimer = -1;
long ledCloseTimer = -1;
int global_co2_ppm = 0;

// +++ 新增：重量逾時控制變數 +++
unsigned long weightStartTime = 0;      // 記錄重量開始的時間
bool ledForcedOff = false;              // 標記：是否因為超時而強制關閉
const unsigned long WEIGHT_TIMEOUT = 5 * 60 * 1000; // 5分鐘 (毫秒)
// +++ 新增結束 +++

void loop() {
  static unsigned long timer = 0;

  if (!mqttClient.connected()) {

    // +++ 新增 WiFi +++
    // 檢查 WiFi 連線，如果斷了就重連
    if (WiFi.status() != WL_CONNECTED) {
      SerialMon.println(F("WiFi disconnected. Reconnecting..."));
      WiFi.begin(wifi_ssid, wifi_password);
      while (WiFi.status() != WL_CONNECTED) {
        delay(500);
        SerialMon.print(F("."));
      }
      SerialMon.println(F("\nWiFi reconnected."));
    }
    // --- 新增 WiFi 結束 ---

    // 連接 MQTT (這會自動使用 WiFi)
    mqttConnect();
  }

  if (millis() >= timer) {

    timer = millis() + UPLOAD_INTERVAL;

    String uplink_data_payload = "";
    
#if defined(INASDA) && defined(INASCL)
    if (!ina219.begin()) {
      Serial.println("INA219 fail!");}
    else {
      currentVoltageV = ina219.getBusVoltage_V();
      currentCurrentmA = ina219.getCurrent_mA();
      uplink_data_payload += String(readVoltage()) + String(readCurrent());}
#endif

  if (!isnan(currentVoltageV) && !isnan(currentCurrentmA)) {
        
        // P = V * I (Watts)
        float powermW = currentVoltageV * currentCurrentmA; 
        
        // E_Wh = P * t_hrs
        energyIncrementmWh = powermW * TIME_INTERVAL_HRS;
        
        // 累積總電耗量
        accumulatedConsumption_mWh += energyIncrementmWh;
        
        SerialMon.printf("Acc. Energy: %.4f Wh (Inc: %.6f Wh)\n", accumulatedConsumption_mWh, energyIncrementmWh);
    }
    // 新增的 CO2 讀取
    uplink_data_payload += String(readCO2());
    //新增壓力讀取
    uplink_data_payload += String(readWeight());
    //新增電耗量
    uplink_data_payload += String(readEnergymWh(energyIncrementmWh));
    //新增累積電耗量
    uplink_data_payload += String(readEnergyAcc(accumulatedConsumption_mWh));
    String jsonBuffer = prepareJsonArray(macAddr, uplink_data_payload);

    if (jsonBuffer.length() > 0) {
      if(mqttClient.publish(MQTT_TOPIC, jsonBuffer.c_str())) {
        Serial.println("MQTT published OK.");
      } else {
        Serial.println("MQTT published FAILED.");
      }
    }
  }

  mqttClient.loop();
  updateCloseTimer();

  // +++ 重量控制 LED 自動控制邏輯 (修改版：加入5分鐘超時) +++
  // 只有在沒有執行 MQTT 定時任務時才執行自動控制
  if (ledCloseTimer <= 0) {
    // 讀取重量
    float currentWeight = scale.get_units(1); 
    
    // 判斷是否大於 10 (有東西放在上面)
    if (currentWeight > 10.0) {
      
      // 1. 如果是剛放上去 (計時器為 0)，開始計時
      if (weightStartTime == 0) {
        weightStartTime = millis();
      }

      // 2. 檢查是否超過 5 分鐘
      if (millis() - weightStartTime > WEIGHT_TIMEOUT) {
        ledForcedOff = true; // 標記為強制關閉
      }

      // 3. 根據狀態控制 LED
      if (ledForcedOff) {
        // --- 超時狀態：強制關閉 LED ---
        if (digitalRead(LED) == LOW) { // 如果目前是亮著 (LOW)，則關閉
          SerialMon.println("Auto: Weight detected > 5 mins, Force LED OFF");
          switchRelay(LED, HIGH, "0B00"); 
        }
      } else {
        // --- 正常狀態 (未超時)：開啟 LED ---
        if (digitalRead(LED) == HIGH) { // 如果目前是暗著 (HIGH)，則開啟
          SerialMon.println("Auto: Weight > 10 (" + String(currentWeight) + "), LED ON");
          switchRelay(LED, LOW, "0B01"); 
        }
      }

    } else {
      // --- 重量 <= 10 (東西拿起來了) ---
      
      // 1. 重置所有狀態，準備下一次偵測
      weightStartTime = 0;
      ledForcedOff = false;

      // 2. 關閉 LED
      if (digitalRead(LED) == LOW) { // 若目前是開啟狀態才動作
        SerialMon.println("Auto: Weight <= 10 (" + String(currentWeight) + "), LED OFF & Reset Timer");
        switchRelay(LED, HIGH, "0B00"); 
      }
    }
  } 
  // --- 自動控制結束 ---
  

  if (fanCloseTimer <= 0) {
    if (global_co2_ppm > 1000) {
      // --- CO2 > 1000 -> 開啟風扇 (LOW) ---
      if (digitalRead(FAN) == HIGH) { // 若目前是關閉才動作
        SerialMon.println("Auto: CO2 > 1000 (" + String(global_co2_ppm) + "), FAN ON");
        switchRelay(FAN, LOW, "0A01"); // 0A=10(FAN), 01=ON
      }
    } else {
      // --- CO2 <= 1000 -> 關閉風扇 (HIGH) ---
      // 增加 >0 的判斷是避免感測器錯誤(0)時誤關，但若您希望0也關則可移除
      if (global_co2_ppm <= 1000 && digitalRead(FAN) == LOW) { 
        SerialMon.println("Auto: CO2 <= 1000 (" + String(global_co2_ppm) + "), FAN OFF");
        switchRelay(FAN, HIGH, "0A00"); // 0A=10(FAN), 00=OFF
      }
    }
  }
  // --- 自動控制結束 ---
   
}


///////////////////////////////////////////////////////////////////////連接MQTT broker///////////////////////////////////////////
void mqttConnect(void) {
  // 這個函式不需要修改，PubSubClient 會自動處理底層的 (TinyGsmClient / WiFiClient)
  SerialMon.print(F("Connecting to "));
  SerialMon.print(MQTT_BROKER);
  SerialMon.print(F("..."));

  // Connect to MQTT Broker
  String mqttid = ("MQTTID_" + String(random(65536)));
  while (!mqttClient.connect(mqttid.c_str(), MQTT_USERNAME, MQTT_PASSWORD)) {
    SerialMon.println(F(" fail"));
    delay(2000); // 連線失敗時稍等一下
  }
  SerialMon.println(F(" success"));


  //訂閱Topic
  const char* topics[] = { MQTT_TOPIC, MQTT_TOPIC_FAN_DL, MQTT_TOPIC_LED_DL, MQTT_TOPIC_FAN_UL, MQTT_TOPIC_LED_UL };
  for (const char* topic : topics) {
    mqttClient.subscribe(topic);
  }
}

//////////////////////////////////////////////////////////////////收到訂閱的TOPIC處理/////////////////////////////////////////
void mqttCallback(char* topic, byte* payload, unsigned int len) {
  SerialMon.print(F("Message arrived ["));
  SerialMon.print(topic);
  SerialMon.print(F("]: "));
  SerialMon.write(payload, len);
  SerialMon.println();

  //將接收到的訊息拆分為macAddr與data
  DynamicJsonDocument doc(1024); 
  DeserializationError error = deserializeJson(doc, payload, len);
  if (error) {
    Serial.print(F("deserializeJson() failed: "));
    Serial.println(error.f_str());
    return;
  }
  String _macAddr = doc[0]["macAddr"].as<String>();
  String _data = doc[0]["data"].as<String>();

   // 若 macAddr 不符，直接返回
  if ( _macAddr != macAddr) return;
  SerialMon.println("macAddr Matched!");
  //只接受固定的長度
  int dataLength = _data.length();
  //只接受固定的header
  String _header = _data.substring(0, 2);  
  if ((!_header.equalsIgnoreCase("0F") && !_header.equalsIgnoreCase("1F")) || (dataLength != 6 && dataLength != 10)) {
    return;
  }
  int _pinNumber = strtol(_data.substring(2, 4).c_str(), nullptr, 16);  //取得PIN
  //判斷是開還是關
  String _ctrlType = (dataLength == 6) ? _data.substring(4, 6) : "";

  //確認FAN還是LED的UL Topic
  const char* ack1Topic = (_pinNumber == FAN) ? MQTT_TOPIC_FAN_UL : (_pinNumber == LED) ? MQTT_TOPIC_LED_UL
                                                                                          : nullptr;
  if (!ack1Topic) return;

  if (dataLength == 6) {
    SerialMon.println("Mannually control");

    if (_header.equalsIgnoreCase("0F")) {
      String jsonBuffer = prepareJsonArray(macAddr, "00" + _data);
      mqttClient.publish(ack1Topic, jsonBuffer.c_str());
      SerialMon.println(String(ack1Topic) + " ack 1 sent ! Received control command !");
      // 控制繼電器
      if (_ctrlType.equals("00")) switchRelay(_pinNumber, HIGH, _data.substring(2, 6));  // 關閉
      if (_ctrlType.equals("01")) switchRelay(_pinNumber, LOW, _data.substring(2, 6));   // 開啟
    }
  } else {
    // 根據時間控制繼電器
    SerialMon.println("Time control");
    long int _timer = strtol(_data.substring(4, 10).c_str(), nullptr, 16);

    if (_header.equalsIgnoreCase("1F")) {
      String jsonBuffer = prepareJsonArray(macAddr, "00" + _data);
      mqttClient.publish(ack1Topic, jsonBuffer.c_str());
      SerialMon.println(String(ack1Topic) + " ack 1 sent ! Received control command !");
      if (_timer > 0) {
        // 時間控制繼電器開啓
        switchRelay(_pinNumber, LOW, _data.substring(2, 4) + "01");  // 開啓
        registerClose(_pinNumber, _timer);                           // 註冊時間
      } else if (_timer == 0) {
        // 時間控制繼電器關閉
        switchRelay(_pinNumber, HIGH, _data.substring(2, 4) + "00");  // 關閉
      }
    }
  }
}
////////////////////////////////////////////////////////////////////Json格式處理///////////////////////////////////////////////////////
//處理要回送的payload
String prepareJsonArray(String macAddr, String data) {
  StaticJsonDocument<1024> jsonArrayDoc;
  JsonArray jsonArray = jsonArrayDoc.to<JsonArray>();
  JsonObject sendJson = jsonArray.createNestedObject();
  String jsonString;

  sendJson["macAddr"] = macAddr;
  sendJson["data"] = data;

  serializeJson(jsonArray,jsonString);
  Serial.println(jsonString);
  return jsonString;
}
/////////////////////////////////////////////////////////////////////////////Control///////////////////////////////////////////////////////
// 繼電器切換
void switchRelay(int _pinNumber, int ctrlCmd, String _data) {
  int pin = (_pinNumber == FAN) ? FAN : (_pinNumber == LED) ? LED
                                                          : -1;
  if (pin == -1) return;

  const char* ack2Topic = (_pinNumber == FAN) ? MQTT_TOPIC_FAN_UL : (_pinNumber == LED) ? MQTT_TOPIC_LED_UL
                                                                                          : nullptr;
  if (ack2Topic == nullptr) {
    Serial.println("Error: Invalid pin number, cannot assign ack2Topic.");
    return;
  }
  SerialMon.println(String((_pinNumber == FAN) ? "FAN" : "LED") + " switch to " + (ctrlCmd == 1 ? "close" : "open"));
  digitalWrite(pin, ctrlCmd);

  String jsonBuffer = prepareJsonArray(macAddr, "002F" + _data);
  mqttClient.publish(ack2Topic, jsonBuffer.c_str());  //回覆控制器已收到
  SerialMon.println(String(ack2Topic) + " ack 2 sent ! Device switched !");
}

////////////////////////// 註冊時間


void registerClose(int _pinNumber, long int duration) {
  if (_pinNumber != FAN && _pinNumber != LED) return;  // 非法的 pinNumber，直接返回
  long closeTime = duration * 1000;
  if (_pinNumber == FAN) fanCloseTimer = closeTime;
  if (_pinNumber == LED) ledCloseTimer = closeTime;

  SerialMon.println("Registered " + String((_pinNumber == FAN) ? "FAN" : "LED") + " close time: " + String(closeTime));
}

// 更新時間
void updateCloseTimer() {
  static unsigned long last = millis();
  unsigned long now = millis();
  long dTime = (now >= last) ? now - last : 0;
  last = now;
  // 處理 FAN 和 LED 的關閉計時器
  for (int pin : { FAN, LED }) {
    long* closeTimer = (pin == FAN) ? &fanCloseTimer : &ledCloseTimer;
    if (*closeTimer > 0) {
      *closeTimer -= dTime;
      if (*closeTimer <= 0) {
        *closeTimer = -1;
        SerialMon.println(String("Close timer of ") + (pin == FAN ? "FAN" : "LED") + " reached 0.");
        char hexString[16];
        sprintf(hexString, "%02x", pin);
        switchRelay(pin, HIGH, String(hexString) + "00");  // 關閉控制器
      }
    }
  }
}

// Sensor functions
//////////////////////////////////////////////////////////////

// INA219
char* readVoltage() {
  static char out[16];
  float v = ina219.getBusVoltage_V();
  // 增加 NaN 檢查
  if (isnan(v)) {
    sprintf(out, "02A70000");
  } else {
    sprintf(out, "02A7%04x", (unsigned int)(v * 100));
  }
  return out;
}

char* readCurrent() {
  static char out[16];
  float c = ina219.getCurrent_mA();
  // 增加 NaN 檢查
  if (isnan(c)) {
     sprintf(out, "02760000");
  } else {
     sprintf(out, "0276%04x", (unsigned int)min(int(c * 1000), 65535));
  }
  return out;
}

// MH-Z16 UART 讀取
//////////////////////////////////////////////////////////////
char* readCO2() {
  static char out[16];
  byte cmd[9] = {0xFF, 0x01, 0x86, 0x00, 0x00, 0x00, 0x00, 0x00, 0x79};
  byte response[9];

  // 清空 SerialAT (Serial1) 的接收緩衝區
  while(SerialAT.available()) {
    SerialAT.read();
  }

  // 發送讀取命令
  SerialAT.write(cmd, 9);

  // 設置 1000ms (1秒) 的讀取超時
  SerialAT.setTimeout(1000);

  // 讀取 9 bytes 的回傳資料
  int bytesRead = SerialAT.readBytes(response, 9);

  if (bytesRead < 9) {
    sprintf(out, "02730000"); // 讀取失敗 (超時)
    Serial.println("MH-Z16 UART read timeout");
    return out;
  }

  // 驗證回傳資料
  if (response[0] != 0xFF || response[1] != 0x86) {
    sprintf(out, "02730000"); // 讀取失敗 (標頭錯誤)
    Serial.println("MH-Z16 UART header error");
    return out;
  }

  // 驗證校驗和 (Checksum)
  byte check = 0;
  for (int i = 1; i < 8; i++) { // 從 byte 1 (0x86) 加到 byte 7
    check += response[i];
  }
  check = 0xFF - check;
  check += 1;

  if (response[8] != check) {
    sprintf(out, "02730000"); // 讀取失敗 (Checksum 錯誤)
    Serial.println("MH-Z16 UART checksum error");
    return out;
  }

  // 計算 PPM
  // PPM = HighByte * 256 + LowByte
  unsigned int ppm = (response[2] * 256) + response[3];

  // 格式化輸出
  sprintf(out, "0273%04x", ppm*10);

  Serial.printf("MH-Z16 CO2 UART : %d ppm\n", ppm);
  global_co2_ppm = ppm;
  return out;
}

// +++ 新增 HX711 讀取函式 +++
char* readWeight() {
  static char out[16];
  float weight = scale.get_units(1);
  unsigned int weightHex = (unsigned int)(weight + 0.5);
    
  sprintf(out, "028d%04x", weightHex);
  Serial.printf("Weight: %.0f kg (Hex: %04x)\n", weight, weightHex);

  return out;
}
char* readEnergymWh(float energyWh) {
    static char out[16];
    
    // 執行四捨五入 (加 0.5 後取整)
    unsigned int energyInt = (unsigned int)(energyWh + 0.5f);

    sprintf(out, "02a1%04x", energyInt);  
    return out;
}
char* readEnergyAcc(float energyWh) {
    static char out[16];
    
    // 執行四捨五入 (加 0.5 後取整)
    unsigned int energyInt = (unsigned int)(energyWh + 0.5f);

    sprintf(out, "026f%04x", energyInt);  
    return out;
}