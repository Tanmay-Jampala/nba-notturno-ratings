@echo off
rem Full data update from this PC (stats.nba.com works here, unlike on GitHub's runners).
rem Run by the "Notturno NBA data update" scheduled task; output goes to logs\update.log.
cd /d "%~dp0..\.."
if not exist logs mkdir logs
echo ===== %date% %time% =====>> logs\update.log
set PYTHONIOENCODING=utf-8
python scripts\update_local.py >> logs\update.log 2>&1
echo exit code %errorlevel%>> logs\update.log
