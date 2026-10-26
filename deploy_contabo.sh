#!/usr/bin/env bash
# ==============================================================================
# BUSINESS LEADERS / CEYLON LEDGER - AUTOMATED CONTABO VPS DEPLOYMENT SCRIPT
# ==============================================================================
# Usage:
#   chmod +x deploy_contabo.sh
#   sudo ./deploy_contabo.sh
# ==============================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=====================================================================${NC}"
echo -e "${GREEN}  BUSINESS LEADERS NEWSROOM - CONTABO AUTO-DEPLOYMENT ENGINE${NC}"
echo -e "${BLUE}=====================================================================${NC}"

# Check for root/sudo
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}[ERROR] Please run this script as root or with sudo: sudo ./deploy_contabo.sh${NC}"
  exit 1
fi

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"
echo -e "${GREEN}[*] Target Project Directory: ${APP_DIR}${NC}"

# 1. Update OS and install prerequisites
echo -e "${YELLOW}[1/8] Updating system packages & installing core dependencies...${NC}"
apt-get update -y
apt-get install -y curl git nginx python3 python3-pip python3-venv build-essential ufw

# 2. Install Node.js 20 LTS if needed
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v)" != v20* && "$(node -v)" != v22* ]]; then
  echo -e "${YELLOW}[2/8] Installing Node.js 20 LTS...${NC}"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
echo -e "${GREEN}[+] Node.js version: $(node -v)${NC}"
echo -e "${GREEN}[+] NPM version: $(npm -v)${NC}"

# 3. Install PM2 globally
if ! command -v pm2 >/dev/null 2>&1; then
  echo -e "${YELLOW}[3/8] Installing PM2 process manager...${NC}"
  npm install -g pm2
fi
echo -e "${GREEN}[+] PM2 version: $(pm2 -v)${NC}"

# 4. Set up Python Virtual Environment
echo -e "${YELLOW}[4/8] Setting up Python virtual environment & scraper libraries...${NC}"
if [ ! -d "venv" ]; then
  python3 -m venv venv
fi
./venv/bin/pip install --upgrade pip
./venv/bin/pip install -r requirements.txt
echo -e "${GREEN}[+] Python dependencies installed successfully.${NC}"

# 5. Setup .env file
echo -e "${YELLOW}[5/8] Checking production environment settings...${NC}"
if [ ! -f ".env" ]; then
  if [ -f ".env.example" ]; then
    cp .env.example .env
    echo -e "${YELLOW}[!] Created .env from .env.example. Please review API keys if needed.${NC}"
  fi
fi

# Ensure PYTHON_EXECUTABLE is mapped to the virtual environment
if grep -q "PYTHON_EXECUTABLE=" .env 2>/dev/null; then
  sed -i "s|PYTHON_EXECUTABLE=.*|PYTHON_EXECUTABLE=${APP_DIR}/venv/bin/python3|g" .env
else
  echo "PYTHON_EXECUTABLE=${APP_DIR}/venv/bin/python3" >> .env
fi

# Ensure apps/public/.env has VITE_DEMO_MODE=true for local backend
if [ -f "apps/public/.env" ]; then
  sed -i 's/VITE_DEMO_MODE=false/VITE_DEMO_MODE=true/g' apps/public/.env
fi

# Create logs directory
mkdir -p logs downloaded_images news_images ft_images images

# 6. Install NPM dependencies & Build Frontend Apps
echo -e "${YELLOW}[6/8] Building Frontend Apps (Public + Admin Console)...${NC}"
npm install --include=dev
cd apps/public && npm install && cd "$APP_DIR"
cd apps/admin && npm install && cd "$APP_DIR"

npm run build:apps
echo -e "${GREEN}[+] Production React builds generated in apps/public/dist & apps/admin/dist.${NC}"

# 7. Configure Nginx
echo -e "${YELLOW}[7/8] Configuring Nginx reverse proxy...${NC}"
NGINX_TARGET="/etc/nginx/sites-available/newssite"

# Replace standard path in nginx-contabo.conf if project directory is different
sed "s|/var/www/newssite|${APP_DIR}|g" nginx-contabo.conf > "$NGINX_TARGET"

# Enable site
rm -f /etc/nginx/sites-enabled/default
ln -sf "$NGINX_TARGET" /etc/nginx/sites-enabled/newssite

# Test and reload Nginx
nginx -t
systemctl restart nginx
echo -e "${GREEN}[+] Nginx configured & restarted successfully.${NC}"

# 8. Setup Firewall (UFW)
echo -e "${YELLOW}[8/8] Configuring UFW Firewall...${NC}"
ufw allow OpenSSH >/dev/null 2>&1 || true
ufw allow 80/tcp >/dev/null 2>&1 || true
ufw allow 8080/tcp >/dev/null 2>&1 || true
ufw allow 443/tcp >/dev/null 2>&1 || true
echo "y" | ufw enable >/dev/null 2>&1 || true

# 9. Start/Restart PM2 Backend
echo -e "${YELLOW}[*] Starting Backend API & Scraper Scheduler via PM2...${NC}"
pm2 delete news-backend >/dev/null 2>&1 || true
pm2 start ecosystem.config.js
pm2 save
env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u root --hp /root || true

# Detect Server IP
SERVER_IP=$(curl -s -4 ifconfig.me || hostname -I | awk '{print $1}')

echo ""
echo -e "${BLUE}=====================================================================${NC}"
echo -e "${GREEN}  ✓ DEPLOYMENT COMPLETED SUCCESSFULLY ON CONTABO SERVER!${NC}"
echo -e "${BLUE}=====================================================================${NC}"
echo -e "  🌐 Public News Portal : ${GREEN}http://${SERVER_IP}${NC}"
echo -e "  🔐 Admin Dashboard    : ${GREEN}http://${SERVER_IP}:8080${NC} (or http://${SERVER_IP}:8080/login)"
echo -e "  ⚙️ Backend API Logs   : ${YELLOW}pm2 logs news-backend${NC}"
echo -e "  🔄 Restart Backend    : ${YELLOW}pm2 restart news-backend${NC}"
echo -e "${BLUE}=====================================================================${NC}"
