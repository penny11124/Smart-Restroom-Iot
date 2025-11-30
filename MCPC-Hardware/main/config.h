#ifndef _CONFIG_H
#define _CONFIG_H

#define TINY_GSM_MODEM_SIM7020

/* Define the serial console for debug prints, if needed */
#define TINY_GSM_DEBUG SerialMon
/* uncomment to dump all AT commands */
//#define DEBUG_DUMP_AT_COMMAND

#define UPLOAD_INTERVAL         60000
#define SerialMon               Serial
#define MONITOR_BAUDRATE        115200  
#define SerialAT            Serial1
#define AM7020_BAUDRATE     115200
// 請插第22PIN
#define AM7020_RESET        22


/* set GSM PIN */
#define GSM_PIN             ""
// for CHT
#define APN               "internet.iot"
#define BAND              8
// MQTT Setting
#define MQTT_BROKER         "mqtt-pbl.kits.tw"
#define MQTT_PORT           1883
#define MQTT_USERNAME       "school"
#define MQTT_PASSWORD       "nthu-hsnl"
#define MQTT_TOPIC          "PBL/UL/"
#define MQTT_TOPIC_FAN_DL          "WAN-GW/DL/FAN"
#define MQTT_TOPIC_FAN_UL          "WAN-GW/UL/FAN"
#define MQTT_TOPIC_LED_DL          "WAN-GW/DL/LED"
#define MQTT_TOPIC_LED_UL          "WAN-GW/UL/LED"

//LED and FAN
#define FAN 10
#define LED 11

//INA219
#define INASDA 6
#define INASCL 7

//DHT22 DHT sensor
#define DHTPIN 21
#define DHTTYPE DHT22

//Light sensor PIN
#define lightSensorPIN 2

// SoilSensor Pin
#define soilPIN 3



#endif /* _CONFIG_H */
