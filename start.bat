@echo off
title Virtual Thermal & Barcode Label Printer Suite
cd /d "%~dp0"

echo =======================================================
echo    Virtual Thermal & Barcode Label Printer Suite
echo =======================================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not found! Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

if not exist "node_modules\" (
    echo [*] Installing dependencies (npm install)...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] npm install failed!
        pause
        exit /b 1
    )
)

if not exist "packages\virtual-thermal-printer\dist\" (
    echo [*] Building packages (npm run build)...
    call npm run build
)

echo   Web Interface:       http://localhost:8000
echo   Receipt Port:         9100 (ESC/POS / ePOS)
echo   Barcode Label Port:   9101 (TSPL / ZPL / CUPS)
echo -------------------------------------------------------
echo.

start "" "http://localhost:8000"

echo Server is starting... Press Ctrl+C to stop.
echo.
call npm run dev --workspace=packages/virtual-thermal-printer
pause
