@echo off
setlocal
title Creative Advs CRM - stop
cd /d "%~dp0"

if /i "%~1"=="--reset" goto reset

echo  Stopping the local CRM (your data is kept)...
docker compose -f local\docker-compose.yml stop
echo  Stopped. Run start-crm.bat to start it again.
ping -n 5 127.0.0.1 >nul
exit /b 0

:reset
echo  This deletes ALL local CRM data (users, clients, everything) and starts fresh next time.
set /p ok=Type YES to continue:
if /i not "%ok%"=="YES" (
  echo  Cancelled.
  exit /b 0
)
docker compose -f local\docker-compose.yml down -v
echo  Local data deleted. Run start-crm.bat for a fresh CRM.
pause
