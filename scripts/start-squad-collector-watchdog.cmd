@echo off
REM Watchdog коллектора заходов Squad. Можно повесить в автозагрузку / Планировщик заданий.
cd /d "%~dp0"
python -u squad_collector_watchdog.py
pause
