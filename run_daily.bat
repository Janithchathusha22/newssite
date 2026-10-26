@echo off
title Daily Biz and Gov AI News Sync Engine
echo =====================================================================
echo  SRI LANKA BUSINESS & GOVERNANCE NEWS - AUTOMATED SCRAPER & AI ENGINE
echo =====================================================================
cd /d "%~dp0"
echo [*] Triggering Daily News Scraper and Groq AI at %date% %time%...
python daily_runner.py
echo.
echo [*] Run finished at %date% %time%. Check news_feed.json & daily_news_export.xlsx
echo =====================================================================
