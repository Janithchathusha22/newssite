# Contabo Server - Docker Compose Deployment Guide

මෙම project එක සම්පූර්ණයෙන්ම **Docker Compose** මඟින් Contabo Ubuntu Server එකේ Host කිරීමට සහ **සෑම පැය 8 කට වරක් ස්වයංක්‍රීයව News Sync (Auto-Sync)** වීමට අවශ්‍ය සියලුම configurations සකස් කර ඇත.

---

## 🚀 Contabo Server එකේ Docker Compose මඟින් Host කරන ආකාරය

### පියවර 1: Contabo Server එකට SSH මඟින් Log වන්න
```bash
ssh root@YOUR_SERVER_IP
```

### පියවර 2: Project එක Server එකට ලබාගන්න
```bash
mkdir -p /var/www/newssite
cd /var/www/newssite

# ඔබගේ Git Repository එකෙන් Clone කරගන්න (හෝ files upload කරන්න)
git clone https://github.com/YOUR_USERNAME/newssite.git .
```

### පියවර 3: One-Click Docker Script එක Run කරන්න
```bash
chmod +x run_docker_contabo.sh
sudo ./run_docker_contabo.sh
```

*(හෝ සෘජුවම Docker Compose command එකෙන් run කිරීමට අවශ්‍ය නම්:)*
```bash
docker compose up -d --build
```

---

## 🛠️ මෙම Setup එකෙන් ලැබෙන විශේෂාංග:
1. **Frontend & Admin Container (`ceylon_ledger_web`):**
   * Nginx Production Web Server එක මඟින් Port 80 හරහා Public News Portal එකත්, Port 8080 හරහා Admin Console එකත් run වේ.
2. **Backend & Scraper Container (`ceylon_ledger_backend`):**
   * Node.js 20 Express API Server එක සහ Python 3 AI Scraper Worker එක එකම container එක තුළ ආරක්ෂිතව run වේ.
3. **Auto Sync Every 8 Hours (පැය 8 න් 8 ට):**
   * `AUTO_SYNC_INTERVAL_MINUTES=480` ලෙස configure කර ඇති බැවින් container එක start වූ සැණින් පළමු scrape එකද, ඉන්පසු සෑම පැය 8 කට වරක් ස්වයංක්‍රීයව නවතම පුවත්පත් ලිපි 240+ scrape කර publish කිරීමද සිදුකරයි.
4. **Persistent Data Storage (දත්ත සුරැකීම):**
   * Database (`news.db`), Excel file, News JSON සහ Scrape කරගත් සියලුම Images (`ft_images`, `news_images`, `downloaded_images`) container එක restart වුවද அழී නොයන ලෙස Server Host එකට map කර ඇත.

---

## 🌐 Server එකට පිවිසෙන URLs:
* **ප්‍රධාන News Website එක:**
  👉 `http://YOUR_SERVER_IP`
* **Admin Editorial Console එක:**
  👉 `http://YOUR_SERVER_IP:8080` (හෝ `http://YOUR_SERVER_IP:8080/login`)

---

## 📋 ප්‍රයෝජනවත් Docker Commands:

* **Live Logs බැලීමට (Scraper එක සහ Backend ක්‍රියාකාරිත්වය):**
  ```bash
  docker compose logs -f
  ```
* **Backend Logs පමණක් බැලීමට:**
  ```bash
  docker compose logs -f backend
  ```
* **Containers Restart කිරීමට:**
  ```bash
  docker compose restart
  ```
* **Containers Stop කිරීමට:**
  ```bash
  docker compose down
  ```
* **නව Code Changes upload කළ පසු නැවත Build කර run කිරීමට:**
  ```bash
  git pull
  docker compose up -d --build
  ```
