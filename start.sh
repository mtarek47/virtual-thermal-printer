#!/usr/bin/env bash

# Virtual Thermal & Barcode Label Printer Suite
# Cross-platform startup script for macOS and Linux

set -e

cd "$(dirname "$0")"

# Colors
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${CYAN}=======================================================${NC}"
echo -e "${GREEN}   🖨️  Virtual Thermal & Barcode Label Printer Suite   ${NC}"
echo -e "${CYAN}=======================================================${NC}"

# Check for Node.js
if ! command -v node >/dev/null 2>&1; then
    echo -e "${YELLOW}❌ Node.js is not installed! Please install Node.js (v20+) from https://nodejs.org/${NC}"
    exit 1
fi

NODE_VERSION=$(node -v)
echo -e "Node.js Version: ${GREEN}${NODE_VERSION}${NC}"

# Install dependencies if missing
if [ ! -d "node_modules" ]; then
    echo -e "${CYAN}📦 Installing dependencies...${NC}"
    npm install
fi

# Build packages if dist doesn't exist
if [ ! -d "packages/virtual-thermal-printer/dist" ] || [ ! -d "packages/escpos-decoder/dist" ]; then
    echo -e "${CYAN}🔨 Building frontend and decoders...${NC}"
    npm run build
fi

echo -e "  🌐 Web Interface:      ${GREEN}http://localhost:8000${NC}"
echo -e "  🧾 Receipt Port:        ${GREEN}9100${NC} (ESC/POS / ePOS)"
echo -e "  🏷️  Barcode Label Port:  ${GREEN}9101${NC} (TSPL / ZPL / CUPS)"
echo -e "${CYAN}-------------------------------------------------------${NC}"

# Open browser in background
(
    sleep 2
    if [[ "$OSTYPE" == "darwin"* ]]; then
        open "http://localhost:8000" >/dev/null 2>&1 || true
    elif command -v xdg-open >/dev/null 2>&1; then
        xdg-open "http://localhost:8000" >/dev/null 2>&1 || true
    fi
) &

echo -e "${GREEN}🚀 Server is running! Press Ctrl+C to stop.${NC}"
npm run start --workspace=packages/virtual-thermal-printer
