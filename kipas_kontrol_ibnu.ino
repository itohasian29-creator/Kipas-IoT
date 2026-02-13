#include <ESP8266WiFi.h>
#include <PubSubClient.h>
#include <WiFiClientSecure.h>
#include <UniversalTelegramBot.h>  // Library tambahan untuk Kontrol via Telegram

// --- KONFIGURASI WIFI & MQTT ---
const char* mqtt_server = "broker.emqx.io";
const char* mqtt_topic_control = "projek/belajar/sensoe_suhu_ibnu_bro/control";
const char* mqtt_topic_status = "projek/belajar/status/espkipas";  // Untuk status online
const char* mqtt_topic_schedule = "projek/belajar/jadwal_kipas_ibnu_storage";

// --- KONFIGURASI TELEGRAM ---
#define BOTtoken "7953899272:AAHBmPmT6ETf9Aif7d9drWMH-O7AznHMQWQ"  // Ganti dengan Token Bot Father
#define CHAT_ID "1380155017"          // Ganti dengan ID User Anda

// --- [BAGIAN 1: HAPUS CONST CHAR SSID/PASSWORD LAMA, GANTI INI] ---
struct WifiLogin {
  const char* ssid;
  const char* pass;
};

// Daftar WiFi Prioritas (Ganti dengan WiFi Anda)
const WifiLogin daftarWifi[] = {
  { "LUCIA ANDREAS 2", "28011987" },  // Prioritas 1
  { "LUCIA ANDREAS", "28011987" },    // Prioritas 2
};
const int jumlahWifi = sizeof(daftarWifi) / sizeof(daftarWifi[0]);

// --- PIN RELAY KIPAS ---
const int RELAY_SPEED_1 = 5;  // D1 adalah GPIO 5
const int RELAY_SPEED_2 = 4;  // D2 adalah GPIO 4
const int RELAY_SPEED_3 = 2;  // D4 adalah GPIO 2

X509List cert(TELEGRAM_CERTIFICATE_ROOT);
WiFiClientSecure secClient;
UniversalTelegramBot bot(BOTtoken, secClient);
WiFiClient espClient;
PubSubClient client(espClient);

unsigned long lastCheckTime = 0;
unsigned long lastStatusTime = 0;

void turnOffAll() {
  digitalWrite(RELAY_SPEED_1, HIGH);
  digitalWrite(RELAY_SPEED_2, HIGH);
  digitalWrite(RELAY_SPEED_3, HIGH);
}

void setSpeed(int speed) {
  turnOffAll();
  delay(100);
  if (speed == 1) digitalWrite(RELAY_SPEED_1, LOW);
  else if (speed == 2) digitalWrite(RELAY_SPEED_2, LOW);
  else if (speed == 3) digitalWrite(RELAY_SPEED_3, LOW);
}

// Handler Pesan Telegram
void handleNewMessages(int numNewMessages) {
  for (int i = 0; i < numNewMessages; i++) {
    String chat_id = String(bot.messages[i].chat_id);
    if (chat_id != CHAT_ID) continue;  // Keamanan: Hanya respon ID pemilik

    String text = bot.messages[i].text;
    if (text == "/speed1") {
      setSpeed(1);
      bot.sendMessage(chat_id, "Kipas Speed 1 Aktif", "");
    } else if (text == "/speed2") {
      setSpeed(2);
      bot.sendMessage(chat_id, "Kipas Speed 2 Aktif", "");
    } else if (text == "/speed3") {
      setSpeed(3);
      bot.sendMessage(chat_id, "Kipas Speed 3 Aktif", "");
    } else if (text == "/off") {
      setSpeed(0);
      bot.sendMessage(chat_id, "Kipas Dimatikan", "");
    } else if (text == "/status") {
      bot.sendMessage(chat_id, "Kipas Online. Siap menerima perintah.", "");
    }
  }
}

void callback(char* topic, byte* payload, unsigned int length) {
  String message = "";
  for (int i = 0; i < length; i++) message += (char)payload[i];
  Serial.println("MQTT: " + message);

  if (message == "1") setSpeed(1);
  else if (message == "2") setSpeed(2);
  else if (message == "3") setSpeed(3);
  else if (message == "0" || message == "OFF" || message == "off") setSpeed(0);
}

void reconnect() {
  while (!client.connected()) {
    String clientId = "FanControl-" + String(random(0xffff), HEX);
    if (client.connect(clientId.c_str())) {
      client.subscribe(mqtt_topic_control);
    } else {
      delay(5000);
    }
  }
}

// --- [BAGIAN 2: TAMBAHKAN FUNGSI KONEKSI BARU] ---
void connectToPriorityWifi() {
  Serial.println("\n[WiFi] Memindai jaringan...");
  WiFi.mode(WIFI_STA);
  int n = WiFi.scanNetworks();

  for (int k = 0; k < jumlahWifi; k++) {
    for (int i = 0; i < n; ++i) {
      if (WiFi.SSID(i) == String(daftarWifi[k].ssid)) {
        Serial.printf("Menghubungkan ke: %s\n", daftarWifi[k].ssid);
        WiFi.begin(daftarWifi[k].ssid, daftarWifi[k].pass);

        unsigned long start = millis();
        while (WiFi.status() != WL_CONNECTED && millis() - start < 10000) {
          delay(500);
          Serial.print(".");
        }

        if (WiFi.status() == WL_CONNECTED) {
          Serial.println("\n✅ Berhasil Terhubung!");
          Serial.println(WiFi.localIP());
          secClient.setTrustAnchors(&cert);  // PENTING: Set sertifikat Telegram setelah konek
          return;
        }
      }
    }
  }
  Serial.println("\n❌ Tidak ada WiFi yang cocok.");
}

// --- [BAGIAN 3: UPDATE VOID SETUP] ---
void setup() {
  Serial.begin(115200);
  pinMode(RELAY_SPEED_1, OUTPUT);
  pinMode(RELAY_SPEED_2, OUTPUT);
  pinMode(RELAY_SPEED_3, OUTPUT);
  turnOffAll();

  // Hapus WiFi.begin(ssid, password) yang lama, ganti dengan:
  connectToPriorityWifi();

  client.setServer(mqtt_server, 1883);
  client.setCallback(callback);
}

void loop() {
  // Tambahkan logika reconnect WiFi otomatis
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi Putus! Menghubungkan ulang...");
    connectToPriorityWifi();
  }

  if (!client.connected()) reconnect();
  client.loop();
  // Cek Telegram setiap 1 detik
  if (millis() - lastCheckTime > 1000) {
    int numNewMessages = bot.getUpdates(bot.last_message_received + 1);
    while (numNewMessages) {
      handleNewMessages(numNewMessages);
      numNewMessages = bot.getUpdates(bot.last_message_received + 1);
    }
    lastCheckTime = millis();
  }

  // [TAMBAHAN BARU: LOGIKA KIRIM STATUS WIFI REALTIME (Setiap 3 Detik)]
  if (millis() - lastStatusTime > 3000) {
    lastStatusTime = millis();
    
    if (WiFi.status() == WL_CONNECTED) {
       // 1. Hitung Kualitas Sinyal
      long rssi = WiFi.RSSI();
      int quality = 2 * (rssi + 100);
      if (quality > 100) quality = 100;
      if (quality < 0) quality = 0;

      // 2. Buat JSON Payload
      String payload = "{\"ssid\":\"" + WiFi.SSID() + "\",";
      payload += "\"dbm\":" + String(rssi) + ",";
      payload += "\"qual\":" + String(quality) + "}";

      // 3. Kirim ke MQTT
      client.publish(mqtt_topic_status, payload.c_str());
    }
  }
}