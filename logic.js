// ==========================================
// 1. KONFIGURASI UTAMA
// ==========================================
const MQTT_CONFIG = {
  host: "broker.emqx.io",
  port: 8084, // WebSocket Port
  path: "/mqtt",
  topic_control: "projek/belajar/sensoe_suhu_ibnu_bro/control",
  topic_status: "projek/belajar/status/espkipas", // Untuk cek status online ESP
  topic_schedule: "projek/belajar/jadwal_kipas_ibnu_storage",
};

const TELEGRAM_CONFIG = {
  token: "7953899272:AAHBmPmT6ETf9Aif7d9drWMH-O7AznHMQWQ", // Token Bot Anda
  chatId: "1380155017", // ID Chat Anda
};

let client;
let schedules = [];
let lastExecutedTime = "";
let espWatchdog = null; // <--- Tambahkan variabel ini

// ==========================================
// 2. MQTT CONNECTION & LOGIC
// ==========================================
function initMQTT() {
  const clientId = "WebFan_" + Math.random().toString(16).substr(2, 8);
  const hostUrl = `ws://${MQTT_CONFIG.host}:${MQTT_CONFIG.port}${MQTT_CONFIG.path}`;

  console.log("Menghubungkan ke MQTT...", hostUrl);
  updateConnectionStatus("loading");

  client = mqtt.connect(hostUrl, {
    keepalive: 60,
    clientId: clientId,
    clean: true,
  });

  client.on("connect", () => {
    console.log("MQTT Terhubung!");
    updateConnectionStatus("online");

    // Subscribe ke topik penting
    client.subscribe(MQTT_CONFIG.topic_control);
    client.subscribe(MQTT_CONFIG.topic_schedule);
    client.subscribe(MQTT_CONFIG.topic_status);
  });

  client.on("message", (topic, message) => {
    const payload = message.toString();

    if (topic === MQTT_CONFIG.topic_control) {
      // Update UI jika ada perubahan status kipas (baik dari Web atau ESP)
      updateFanUI(payload);
    } else if (topic === MQTT_CONFIG.topic_schedule) {
      // Sinkronisasi jadwal dari Cloud
      try {
        schedules = JSON.parse(payload);
        renderScheduleList();
        console.log("Jadwal disinkronkan dari Cloud:", schedules);
      } catch (e) {
        console.error("Gagal parsing jadwal:", e);
      }
    } else if (topic === MQTT_CONFIG.topic_status) {
      try {
        const data = JSON.parse(payload);
        updateWifiDisplay(data);

        // --- TAMBAHAN LOGIKA WATCHDOG ---
        // 1. Reset timer setiap kali data diterima
        if (espWatchdog) clearTimeout(espWatchdog);

        // 2. Set timer baru: Jika 6 detik tidak ada data, set offline
        espWatchdog = setTimeout(() => {
          console.warn("Tidak ada sinyal dari ESP, dianggap offline.");
          updateConnectionStatus("offline");
          // Opsional: Kosongkan data agar terlihat putus
          document.getElementById("wifi-dbm").innerText = "0dBm";
          document.getElementById("wifi-qual").innerText = "0%";
          document.getElementById("wifi-qual").className =
            "text-red-400 font-bold";
        }, 6000); // 6000ms = 6 detik (karena ESP kirim tiap 3 detik)
        // ---------------------------------
      } catch (e) {
        console.error("Error parsing WiFi status", e);
      }
    }
  });

  client.on("offline", () => updateConnectionStatus("offline"));
  client.on("error", (err) => {
    console.error("MQTT Error:", err);
    updateConnectionStatus("offline");
  });
}

// ==========================================
// 3. FUNGSI KONTROL KIPAS
// ==========================================
function setFan(speed) {
  if (!client || !client.connected) {
    showAlert("Offline", "Koneksi ke server terputus.", "error");
    return;
  }

  // Publish perintah ke MQTT
  const command = String(speed);
  client.publish(MQTT_CONFIG.topic_control, command, { qos: 1, retain: true });

  // UI akan update otomatis lewat event 'message' agar sinkron
  // Tapi kita bisa paksa update visual klik utk responsivitas
  updateFanUI(command);

  // Kirim Notifikasi Telegram (Opsional: Agar tau siapa yang mencet)
  // sendTelegram(`⚠️ *KONTROL MANUAL*\nKipas diubah ke: ${speed == 0 ? "OFF" : "Speed " + speed} via Web App`);
}

function updateFanUI(speedStr) {
  const speed = parseInt(speedStr);
  const btns = [0, 1, 2, 3];
  const icon = document.getElementById("fan-icon-main");
  const bgIcon = document.getElementById("fan-icon-bg");
  const statusLabel = document.getElementById("fan-status-label");

  // Reset Style
  btns.forEach((n) => {
    const btn = document.getElementById(`btn-${n}`);
    btn.className =
      "btn-fan h-14 rounded-xl bg-slate-800 font-bold text-slate-300 hover:bg-emerald-600/20";
    if (n === 0) btn.classList.add("text-red-400", "border-red-900/50");
  });

  // Active Style
  const activeBtn = document.getElementById(`btn-${speed}`);
  if (activeBtn) {
    if (speed === 0) {
      activeBtn.className =
        "btn-fan h-14 rounded-xl bg-red-600 text-white font-bold shadow-lg shadow-red-600/40 transform scale-105";
      icon.className = "fa-solid fa-fan text-2xl text-slate-400"; // Stop spin
      bgIcon.className =
        "fa-solid fa-fan absolute -right-6 -bottom-6 text-9xl text-slate-700/20";
      statusLabel.innerText = "Status: OFF";
      statusLabel.className = "text-xs text-red-400 font-bold";
    } else {
      activeBtn.className =
        "btn-fan h-14 rounded-xl bg-emerald-500 text-white font-bold shadow-lg shadow-emerald-500/40 transform scale-105";

      // Animasi Icon
      let spinClass =
        speed === 1 ? "spin-slow" : speed === 2 ? "spin-medium" : "spin-fast";
      icon.className = `fa-solid fa-fan text-2xl text-emerald-400 ${spinClass}`;
      bgIcon.className = `fa-solid fa-fan absolute -right-6 -bottom-6 text-9xl text-emerald-600/10 ${spinClass}`;

      statusLabel.innerText = `Status: SPEED ${speed}`;
      statusLabel.className = "text-xs text-emerald-400 font-bold";
    }
  }
}

// ==========================================
// 4. MANAJEMEN JADWAL
// ==========================================
function renderScheduleList() {
  const list = document.getElementById("schedule-list");
  list.innerHTML = "";

  if (schedules.length === 0) {
    list.innerHTML = `<div class="mt-10 opacity-50"><i class="fa-regular fa-calendar-xmark text-4xl mb-2"></i><p>Belum ada jadwal</p></div>`;
    return;
  }

  schedules.sort((a, b) => a.time.localeCompare(b.time));
  const dayNames = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

  schedules.forEach((item) => {
    const dayBadges = item.days
      .map(
        (d) =>
          `<span class="${item.days.includes(new Date().getDay()) && d === new Date().getDay() ? "text-emerald-400 font-bold" : ""}">${dayNames[d]}</span>`,
      )
      .join(", ");
    const speedColor =
      item.action == "0"
        ? "bg-red-500/20 text-red-400"
        : "bg-emerald-500/20 text-emerald-400";
    const speedText = item.action == "0" ? "OFF" : `Speed ${item.action}`;

    const li = document.createElement("li");
    li.className =
      "bg-slate-800/50 border border-slate-700 rounded-xl p-3 flex justify-between items-center group";

    // Perhatikan penambahan tombol Edit (fa-pen) di bawah ini
    li.innerHTML = `
            <div class="text-left flex-1" onclick="editSchedule(${item.id})">
                <div class="flex items-center gap-2 mb-1">
                    <span class="text-xl font-mono font-bold text-white tracking-wider">${item.time}</span>
                    <span class="text-[10px] px-2 py-0.5 rounded ${speedColor} font-bold uppercase">${speedText}</span>
                </div>
                <div class="text-xs text-slate-500 font-mono tracking-tight">${dayBadges}</div>
            </div>
            <div class="flex gap-2">
                <button onclick="editSchedule(${item.id})" class="w-8 h-8 rounded-full flex items-center justify-center text-slate-500 hover:bg-blue-500/20 hover:text-blue-400 transition">
                    <i class="fa-solid fa-pen"></i>
                </button>
                <button onclick="deleteSchedule(${item.id})" class="w-8 h-8 rounded-full flex items-center justify-center text-slate-500 hover:bg-red-500/20 hover:text-red-400 transition">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
        `;
    list.appendChild(li);
  });
}

// Fungsi Baru: Mengisi Form saat mau Edit
function editSchedule(id) {
  const item = schedules.find((s) => s.id === id);
  if (!item) return;

  // Isi data ke modal
  document.getElementById("modal-title").innerText = "Edit Jadwal";
  document.getElementById("edit-id").value = item.id; // Simpan ID
  document.getElementById("input-time").value = item.time;

  // Set Radio Button Speed
  const radios = document.getElementsByName("speed");
  radios.forEach((r) => {
    if (r.value == item.action) r.checked = true;
  });

  // Set Checkbox Hari
  const checkboxes = document.querySelectorAll(".day-chk");
  checkboxes.forEach((chk) => {
    chk.checked = item.days.includes(parseInt(chk.value));
  });

  openModal();
}

// Update Fungsi Save untuk menangani Edit & Buat Baru
function saveSchedule() {
  const idEdit = document.getElementById("edit-id").value;
  const time = document.getElementById("input-time").value;
  const actionEl = document.querySelector('input[name="speed"]:checked');
  const dayCheckboxes = document.querySelectorAll(".day-chk:checked");

  if (!time || !actionEl || dayCheckboxes.length === 0) {
    showAlert(
      "Data Kurang",
      "Mohon lengkapi waktu, kecepatan, dan hari.",
      "warning",
    );
    return;
  }

  const days = Array.from(dayCheckboxes).map((cb) => parseInt(cb.value));
  const action = actionEl.value;

  if (idEdit) {
    // --- MODE EDIT ---
    // Cari index dan update
    const index = schedules.findIndex((s) => s.id == idEdit);
    if (index !== -1) {
      schedules[index].time = time;
      schedules[index].action = action;
      schedules[index].days = days;
      showAlert(
        "Berhasil",
        idEdit
          ? "Jadwal berhasil diperbarui."
          : "Jadwal baru berhasil disimpan.",
        "success",
      );
    }
  } else {
    // --- MODE BARU ---
    const newSchedule = {
      id: Date.now(),
      time: time,
      action: action,
      days: days,
      active: true,
    };
    schedules.push(newSchedule);

    sendTelegram(`📅 *JADWAL BARU*\nPukul: ${time}\nAksi: Speed ${action}`);
    showAlert("Tersimpan", "Jadwal baru berhasil disimpan.", "success");
  }

  saveToCloud();
  closeModal();
  renderScheduleList();
}

function deleteSchedule(id) {
  deleteTargetId = id; // Simpan ID
  document.getElementById("confirm-title").innerText = "Hapus Jadwal?";
  document.getElementById("confirm-msg").innerText =
    "Jadwal ini akan dihapus permanen.";
  document.getElementById("modal-confirm").showModal(); // Munculkan modal
}

function saveToCloud() {
  if (client && client.connected) {
    client.publish(MQTT_CONFIG.topic_schedule, JSON.stringify(schedules), {
      qos: 1,
      retain: true,
    });
  }
}

// ==========================================
// 5. SISTEM PENGECEKAN WAKTU (SCHEDULER)
// ==========================================
setInterval(() => {
  const now = new Date();
  const currentDay = now.getDay();
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const currentTime = `${hours}:${minutes}`;

  // Cek setiap jadwal
  schedules.forEach((s) => {
    if (s.active && s.days.includes(currentDay) && s.time === currentTime) {
      // Cegah eksekusi ganda dalam 1 menit yang sama
      const triggerKey = `${s.id}-${currentTime}`;
      if (lastExecutedTime !== triggerKey) {
        console.log("Eksekusi Jadwal:", s);

        // 1. Kontrol Kipas
        setFan(s.action);

        // 2. Kirim Notifikasi
        const actionText =
          s.action == "0"
            ? "MEMATIKAN KIPAS (OFF)"
            : `MENYALAKAN KIPAS (SPEED ${s.action})`;
        sendTelegram(
          `⏰ *JADWAL TEREKSEKUSI*\n\nWaktu: ${currentTime}\nSistem berhasil ${actionText} secara otomatis.`,
        );

        lastExecutedTime = triggerKey;
      }
    }
  });
}, 1000); // Cek setiap detik

// ==========================================
// 6. UTILITIES (Telegram & UI)
// ==========================================
function sendTelegram(message) {
  const url = `https://api.telegram.org/bot${TELEGRAM_CONFIG.token}/sendMessage?chat_id=${TELEGRAM_CONFIG.chatId}&text=${encodeURIComponent(message)}&parse_mode=Markdown`;

  fetch(url)
    .then((response) => response.json())
    .then((data) => {
      if (!data.ok) console.error("Telegram Error:", data);
    })
    .catch((err) => console.error("Telegram Fetch Error:", err));
}

function updateConnectionStatus(status) {
  const dot = document.getElementById("status-dot");
  const text = document.getElementById("status-text");

  if (status === "online") {
    dot.className =
      "w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_10px_#10b981]";
    text.innerText = "Online";
    text.className = "text-emerald-400 font-bold";
  } else if (status === "offline") {
    dot.className = "w-2 h-2 rounded-full bg-red-500";
    text.innerText = "Offline";
    text.className = "text-red-400";
  } else {
    dot.className = "w-2 h-2 rounded-full bg-yellow-500 animate-pulse";
    text.innerText = "Connecting...";
    text.className = "text-yellow-400";
  }
}

function openModal() {
  const modal = document.getElementById("modal-add");

  // [TAMBAHAN BARU: Reset Toggle Cepat setiap modal dibuka]
  document.getElementById("toggle-today").checked = false;
  document.getElementById("toggle-all").checked = false;

  // Reset Form jika mode tambah baru
  if (
    document.activeElement &&
    document.activeElement.innerText.includes("Tambah")
  ) {
    document.getElementById("modal-title").innerText = "Buat Jadwal Baru";
    document.getElementById("edit-id").value = "";
    document.getElementById("input-time").value = "";
    document.querySelectorAll(".day-chk").forEach((c) => (c.checked = false));
    document.querySelector('input[name="speed"][value="1"]').checked = true;
  }

  modal.showModal();
}

function closeModal() {
  document.getElementById("modal-add").close();
}

// Start System
window.onload = initMQTT;

// --- REGISTRASI PWA ---
if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("./sw.js")
    .then((reg) => console.log("Service Worker Registered"))
    .catch((err) => console.log("SW Registration Failed", err));
}

// Fungsi Alert Pengganti Swal
function showAlert(title, msg, type = "success") {
  const modal = document.getElementById("modal-alert");
  const icon = document.getElementById("alert-icon");

  document.getElementById("alert-title").innerText = title;
  document.getElementById("alert-msg").innerText = msg;

  if (type === "success") {
    icon.innerHTML =
      '<i class="fa-solid fa-circle-check text-emerald-500"></i>';
  } else if (type === "error") {
    icon.innerHTML = '<i class="fa-solid fa-circle-xmark text-red-500"></i>';
  } else {
    icon.innerHTML =
      '<i class="fa-solid fa-triangle-exclamation text-amber-500"></i>';
  }

  modal.showModal();
}

// Variabel global untuk menyimpan ID yang akan dihapus
let deleteTargetId = null;

function closeConfirm() {
  document.getElementById("modal-confirm").close();
  deleteTargetId = null;
}

// Logic Eksekusi Hapus (Dipanggil saat klik "Ya, Hapus")
document.getElementById("btn-confirm-yes").onclick = function () {
  if (deleteTargetId) {
    schedules = schedules.filter((s) => s.id !== deleteTargetId);
    saveToCloud();
    renderScheduleList();
    closeConfirm();
    showAlert("Terhapus", "Jadwal berhasil dihapus.", "success");
  }
};

function updateWifiDisplay(data) {
  const loadingDiv = document.getElementById("status-loading");
  const dataDiv = document.getElementById("status-data");
  const ssidElem = document.getElementById("wifi-ssid"); // Ambil elemen SSID

  // Sembunyikan loading, tampilkan data
  loadingDiv.classList.add("hidden");
  loadingDiv.classList.remove("flex");

  dataDiv.classList.remove("hidden");
  dataDiv.classList.add("flex");

  // Masukkan data dari ESP
  ssidElem.innerText = data.ssid; // Update teks SSID

  // Logika Animasi: Jika SSID panjang (>10 karakter), jalankan animasi
  if (data.ssid.length > 10) {
    ssidElem.classList.add("marquee-content");
    ssidElem.parentElement.classList.add("marquee-container");
  } else {
    // Jika pendek, matikan animasi biar diam
    ssidElem.classList.remove("marquee-content");
    ssidElem.style.transform = "none"; // Reset posisi
  }

  document.getElementById("wifi-dbm").innerText = data.dbm + "dBm";
  document.getElementById("wifi-qual").innerText = data.qual + "%";

  // Ubah warna berdasarkan kualitas sinyal
  const qualElem = document.getElementById("wifi-qual");
  if (data.qual > 70) qualElem.className = "text-emerald-400 font-bold";
  else if (data.qual > 40) qualElem.className = "text-yellow-400 font-bold";
  else qualElem.className = "text-red-400 font-bold";
}

// Update fungsi updateConnectionStatus untuk menghandle offline
function updateConnectionStatus(status) {
  // Jika offline, kembalikan ke tampilan "Connecting..."
  if (status !== "online") {
    document.getElementById("status-data").classList.add("hidden");
    document.getElementById("status-data").classList.remove("flex");

    document.getElementById("status-loading").classList.remove("hidden");
    document.getElementById("status-loading").classList.add("flex");

    const text = document.getElementById("status-text");
    const dot = document.getElementById("status-dot");

    text.innerText = status === "offline" ? "Terputus" : "Menghubungkan...";
    dot.className =
      status === "offline"
        ? "w-2 h-2 rounded-full bg-red-500"
        : "w-2 h-2 rounded-full bg-yellow-500 animate-pulse";
  }
}

// ==========================================
// 7. LOGIKA TOGGLE HARI (BARU)
// ==========================================
function toggleToday(el) {
  const checkboxes = document.querySelectorAll(".day-chk");
  const todayIndex = new Date().getDay(); // 0 = Minggu, 1 = Senin, dst

  // Matikan "Pilih Semua" agar tidak bingung
  if (el.checked) document.getElementById("toggle-all").checked = false;

  checkboxes.forEach((chk) => {
    // Jika dicentang, hanya pilih hari ini. Jika tidak, hapus semua.
    if (el.checked) {
      chk.checked = parseInt(chk.value) === todayIndex;
    } else {
      chk.checked = false;
    }
  });
}

function toggleAll(el) {
  const checkboxes = document.querySelectorAll(".day-chk");

  // Matikan "Hanya Hari Ini"
  if (el.checked) document.getElementById("toggle-today").checked = false;

  // Centang/Hapus semua sesuai status toggle ini
  checkboxes.forEach((chk) => (chk.checked = el.checked));
}
