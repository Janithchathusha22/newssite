@echo off
title Business Leaders Newsroom - Full Automation Engine
echo =====================================================================
echo  BUSINESS LEADERS SRI LANKA - AUTOMATED NEWS & EDITORIAL ENGINE
echo =====================================================================
cd /d "%~dp0"

echo [*] Starting Backend API & Auto-Scraper Scheduler (Port 5000)...
start "Newsroom Backend & Scraper Scheduler" cmd /k "node server.js"

echo [*] Starting Editorial Admin Console (Port 5174)...
start "Newsroom Admin Console" cmd /k "npm run dev:admin"

echo.
echo [OK] Both Backend and Admin Console launched successfully!
echo   - Backend API & Auto-Scraper : http://localhost:5000
echo   - Admin Editorial Console   : http://localhost:5174
echo.
echo Keep the backend window open to ensure news auto-syncs every 60 minutes.
echo =====================================================================
pause
