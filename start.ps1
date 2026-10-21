# Virtual Thermal & Barcode Label Printer Suite
# PowerShell startup script for Windows

Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "   🖨️  Virtual Thermal & Barcode Label Printer Suite   " -ForegroundColor Green
Write-Host "=======================================================" -ForegroundColor Cyan

Set-Location -Path $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Node.js is not found! Please install Node.js from https://nodejs.org/" -ForegroundColor Red
    Read-Host "Press Enter to exit..."
    exit 1
}

if (-not (Test-Path "node_modules")) {
    Write-Host "[*] Installing dependencies (npm install)..." -ForegroundColor Yellow
    npm install
}

if (-not (Test-Path "packages/virtual-thermal-printer/dist")) {
    Write-Host "[*] Building packages (npm run build)..." -ForegroundColor Yellow
    npm run build
}

Write-Host "  🌐 Web Interface:      http://localhost:8000" -ForegroundColor Green
Write-Host "  🧾 Receipt Port:        9100 (ESC/POS / ePOS)" -ForegroundColor Green
Write-Host "  🏷️  Barcode Label Port:  9101 (TSPL / ZPL / CUPS)" -ForegroundColor Green
Write-Host "-------------------------------------------------------" -ForegroundColor Cyan

Start-Process "http://localhost:8000"

npm run dev --workspace=packages/virtual-thermal-printer
