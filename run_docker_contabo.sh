#!/usr/bin/env bash
# ==============================================================================
# BUSINESS LEADERS / CEYLON LEDGER - CONTABO DOCKER COMPOSE DEPLOYMENT SCRIPT
# ==============================================================================
# Features:
#  - Automatic Docker & Docker Compose setup on Contabo Ubuntu
#  - Persistent volumes for Database, Articles & Images
#  - Multi-stage Nginx + Node.js/Python build
#  - Auto-Sync scheduled every 8 hours (480 minutes)
# ==============================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}=====================================================================${NC}"
echo -e "${GREEN}  BUSINESS LEADERS NEWSROOM - DOCKER COMPOSE CONTABO DEPLOYER${NC}"
echo -e "${BLUE}=====================================================================${NC}"

if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}[ERROR] Please run this script as root or with sudo: sudo ./run_docker_contabo.sh${NC}"
  exit 1
fi

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

# 1. Install Docker & Docker Compose if missing
if ! command -v docker >/dev/null 2>&1; then
  echo -e "${YELLOW}[1/4] Docker not found. Installing Docker engine...${NC}"
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
fi

echo -e "${GREEN}[+] Docker version: $(docker --version)${NC}"

# 2. Ensure persistent storage files & directories exist before volume mounting
echo -e "${YELLOW}[2/4] Initializing volume data paths...${NC}"
mkdir -p downloaded_images news_images ft_images images editorial
touch news.db daily_news_export.xlsx news_feed.csv news_feed.json

# Ensure .env exists
if [ ! -f ".env" ]; then
  if [ -f ".env.example" ]; then
    cp .env.example .env
  fi
fi

# Ensure 8-hour sync in .env
if grep -q "AUTO_SYNC_INTERVAL_MINUTES=" .env; then
  sed -i 's/AUTO_SYNC_INTERVAL_MINUTES=.*/AUTO_SYNC_INTERVAL_MINUTES=480/g' .env
else
  echo "AUTO_SYNC_INTERVAL_MINUTES=480" >> .env
fi

# 3. Configure Firewall (UFW)
echo -e "${YELLOW}[3/4] Configuring Firewall ports (3000, 8080, 80, 443)...${NC}"
if command -v ufw >/dev/null 2>&1; then
  ufw allow OpenSSH >/dev/null 2>&1 || true
  ufw allow 3000/tcp >/dev/null 2>&1 || true
  ufw allow 8080/tcp >/dev/null 2>&1 || true
  ufw allow 80/tcp >/dev/null 2>&1 || true
  ufw allow 443/tcp >/dev/null 2>&1 || true
  echo "y" | ufw enable >/dev/null 2>&1 || true
fi

# 4. Build and start containers
echo -e "${YELLOW}[4/4] Building and launching Docker Compose containers...${NC}"
docker compose down --remove-orphans 2>/dev/null || true
docker compose up -d --build

SERVER_IP=$(curl -s -4 ifconfig.me || hostname -I | awk '{print $1}')

echo ""
echo -e "${BLUE}=====================================================================${NC}"
echo -e "${GREEN}  ✓ DOCKER COMPOSE DEPLOYMENT ACTIVE ON CONTABO!${NC}"
echo -e "${BLUE}=====================================================================${NC}"
echo -e "  🌐 Public News Portal : ${GREEN}http://${SERVER_IP}:3000${NC}"
echo -e "  🔐 Admin Dashboard    : ${GREEN}http://${SERVER_IP}:8080${NC} (or http://${SERVER_IP}:8080/login)"
echo -e "  ⏰ Auto Sync Schedule : ${GREEN}Every 8 Hours (480 mins)${NC}"
echo -e "  📜 Live Logs          : ${YELLOW}docker compose logs -f${NC}"
echo -e "  🔄 Restart Containers : ${YELLOW}docker compose restart${NC}"
echo -e "${BLUE}=====================================================================${NC}"
