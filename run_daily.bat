@echo off
title Daily Biz and Gov AI News Sync Engine
echo Starting Daily Biz and Gov Automated Scraping and AI Sync Pipeline...
cd /d "%~dp0"
python daily_runner.py >> pipeline_automation.log 2>&1
echo Completed run at %date% %time% >> pipeline_automation.log
