@echo off
title Portal Launcher
color 0A
cd /d "C:\Users\jacob\Projects\Portal"

:menu
cls
echo.
echo  ============================================
echo       PORTAL - Spatial OS Launcher
echo  ============================================
echo.
echo    1.  Start Hub Server only       (port 3141)
echo    2.  Start UI only               (port 5173)
echo    3.  Start BOTH (Hub + UI)       (recommended)
echo    4.  Start Tauri Desktop App
echo    5.  Install / Reinstall Dependencies
echo    6.  Check Hub Health
echo    7.  Open UI in Browser
echo    8.  Stop All (kill node processes)
echo    9.  Exit
echo.
echo  ============================================
set /p choice="  Pick a number: "

if "%choice%"=="1" goto hub
if "%choice%"=="2" goto ui
if "%choice%"=="3" goto both
if "%choice%"=="4" goto tauri
if "%choice%"=="5" goto install
if "%choice%"=="6" goto health
if "%choice%"=="7" goto browser
if "%choice%"=="8" goto stop
if "%choice%"=="9" goto quit
echo  Invalid choice. Try again.
timeout /t 2 >nul
goto menu

:hub
cls
echo  Starting Hub Server on port 3141...
echo  Press Ctrl+C to stop.
echo.
npx tsx packages/hub/src/server.ts
pause
goto menu

:ui
cls
echo  Starting UI dev server on port 5173...
echo  Press Ctrl+C to stop.
echo.
npm run dev:ui
pause
goto menu

:both
cls
echo  Starting Hub + UI together...
echo  Hub = port 3141   UI = port 5173
echo.
echo  Two windows will open. Close both to stop.
echo.
start "Portal Hub" cmd /k "cd /d C:\Users\jacob\Projects\Portal && npx tsx packages/hub/src/server.ts"
timeout /t 3 >nul
start "Portal UI" cmd /k "cd /d C:\Users\jacob\Projects\Portal && npm run dev:ui"
timeout /t 2 >nul
echo.
echo  Both servers starting...
echo  Opening browser in 5 seconds...
timeout /t 5 >nul
start http://localhost:5173
echo.
echo  Press any key to return to menu.
echo  (The servers keep running in their own windows)
pause >nul
goto menu

:tauri
cls
echo  Starting Tauri Desktop App...
echo  This also starts the hub automatically.
echo.
npm run tauri dev
pause
goto menu

:install
cls
echo  Installing dependencies...
echo.
npm install
echo.
echo  Done!
pause
goto menu

:health
cls
echo  Checking Hub health at http://127.0.0.1:3141/health ...
echo.
curl -s http://127.0.0.1:3141/health
echo.
echo.
echo  If you see JSON above, the hub is running!
echo  If you see an error, start the hub first (option 1 or 3).
echo.
pause
goto menu

:browser
cls
echo  Opening http://localhost:5173 in your default browser...
start http://localhost:5173
timeout /t 2 >nul
goto menu

:stop
cls
echo  Stopping all Node.js processes...
taskkill /f /im node.exe 2>nul
echo.
echo  Done. All Node processes killed.
echo.
pause
goto menu

:quit
exit