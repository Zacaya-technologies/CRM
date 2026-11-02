@echo off
setlocal
title Creative Advs CRM - local server
cd /d "%~dp0"
set "URL=http://localhost:8088"

echo.
echo  Creative Advs CRM - starting on your computer
echo  ---------------------------------------------

where docker >nul 2>&1
if errorlevel 1 (
  echo  Docker Desktop is not installed.
  echo  Install it from https://www.docker.com/products/docker-desktop/ and run this again.
  pause
  exit /b 1
)

docker info >nul 2>&1
if not errorlevel 1 goto docker_ready
echo  Starting Docker Desktop ^(first start can take a minute^)...
if exist "%ProgramFiles%\Docker\Docker\Docker Desktop.exe" start "" "%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
set /a tries=0
:wait_docker
ping -n 4 127.0.0.1 >nul
docker info >nul 2>&1
if not errorlevel 1 goto docker_ready
set /a tries+=1
if %tries% lss 60 goto wait_docker
echo  Docker did not start. Open Docker Desktop yourself, wait until it says "running", then run this again.
pause
exit /b 1

:docker_ready
echo  Starting the web server and database ^(first run downloads them, a few minutes^)...
docker compose -f local\docker-compose.yml up -d --build
if errorlevel 1 (
  echo  Could not start the containers. See the messages above.
  pause
  exit /b 1
)

echo  Waiting for the CRM to answer...
set /a tries=0
:wait_api
ping -n 3 127.0.0.1 >nul
curl -s -o nul -w "%%{http_code}" -H "X-CRM: 1" "%URL%/api/index.php?r=health" 2>nul | findstr /x "200" >nul
if not errorlevel 1 goto ready
set /a tries+=1
if %tries% lss 90 goto wait_api
echo  The CRM is taking unusually long. Try opening %URL% in a minute.
goto open

:ready
echo.
echo  Ready!  %URL%
echo  First visit: create your admin account, then click "Load demo data" on the Dashboard.
:open
if not defined CRM_NO_BROWSER start "" "%URL%"
echo.
echo  To stop the CRM later, run stop-crm.bat. Your data is kept between runs.
echo.
if not defined CRM_NO_BROWSER ping -n 9 127.0.0.1 >nul
