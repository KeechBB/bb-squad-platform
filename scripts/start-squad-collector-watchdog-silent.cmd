@echo off
REM Silent watchdog start for Task Scheduler (no admin pause).
cd /d "%~dp0"
where python >nul 2>&1
if errorlevel 1 (
  where py >nul 2>&1
  if errorlevel 1 exit /b 1
  start "" /MIN py -3 -u "%~dp0squad_collector_watchdog.py"
) else (
  start "" /MIN python -u "%~dp0squad_collector_watchdog.py"
)
exit /b 0
