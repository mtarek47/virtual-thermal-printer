# Virtual Thermal & Barcode Label Printer Suite

A web-based dual virtual printer simulator that emulates both a real ESC/POS & Epson ePOS **Receipt Printer** and a TSPL / ZPL **Barcode Sticker Printer**. Designed for developers who need to test point-of-sale (POS) and inventory label applications without physical hardware.

## Features

- **Receipt Printer (Bay 1):**
  - **Epson ePOS:** Receives and processes Epson ePOS XML commands via `/cgi-bin/epos/service.cgi`.
  - **ESC/POS Socket:** Receives raw ESC/POS commands over TCP port `9100`.
  - **macOS CUPS Driver:** Prints system documents and receipts directly from macOS apps.
- **Barcode Sticker Printer (Bay 2):**
  - **TSPL / TSPL2 Protocol:** Standard label script commands (`SIZE`, `GAP`, `CLS`, `BARCODE`, `QRCODE`, `TEXT`, `BOX`, `PRINT`).
  - **ZPL II Protocol:** Zebra programming language (`^XA`, `^FO`, `^BC`, `^BQ`, `^FD`, `^XZ`).
  - **High-Resolution Vector Barcodes:** 1D Barcodes (Code 128, EAN, Code 39) & 2D QR codes rendered with crisp vectors.
  - **TCP Socket:** Dedicated TCP port `9101` for raw label streams.
  - **HTTP Endpoints:** `POST /cgi-bin/label/tspl`, `POST /cgi-bin/label/zpl`, `POST /cgi-bin/label/print`.
- **Dual Side-by-Side Web Interface:**
  - Real-time live status and paper animations for both printers at `http://localhost:8000`.
  - Hardware aesthetic casings with LED indicators and quick-test buttons.
  - Built-in slide-out Settings drawer with copyable endpoints and one-click macOS CUPS setup commands.

---

## Quick Start (Any OS)

### 🍎 macOS & 🐧 Linux
Run the start script in your terminal:
```bash
./start.sh
```
*(Or run `npm start`)*

### 🪟 Windows
- Simply **double-click** `start.bat` in File Explorer!
- Or in Command Prompt / PowerShell:
```cmd
start.bat
```
*(Or `npm start`)*

### ⚡ Universal (Any Platform with Node.js)
```bash
npm start
```
*This will automatically install dependencies if needed, build the packages, launch your browser at `http://localhost:8000`, and start the printer server.*

---

## Ports & Endpoints

| Service | Port / URL | Protocol | Description |
|---|---|---|---|
| **Web UI** | `http://localhost:8000` | HTTP / WebSocket | Dual visual interface |
| **Receipt Socket** | `127.0.0.1:9100` | TCP (Raw) | ESC/POS receipt stream |
| **Receipt ePOS** | `http://localhost:8000/cgi-bin/epos/service.cgi` | HTTP (POST XML) | Epson ePOS SOAP service |
| **Label Socket** | `127.0.0.1:9101` | TCP (Raw) | TSPL / ZPL label stream |
| **TSPL HTTP** | `http://localhost:8000/cgi-bin/label/tspl` | HTTP (POST Text) | Direct TSPL script |
| **ZPL HTTP** | `http://localhost:8000/cgi-bin/label/zpl` | HTTP (POST Text) | Direct ZPL II script |

---

## macOS CUPS Printer Setup

To add these virtual printers as real system printers on macOS (so you can print with **Cmd + P** from Chrome, Word, QZ Tray, or POS software):

**Receipt Printer:**
```bash
lpadmin -p "Virtual_Thermal_Printer" -E -v "socket://127.0.0.1:9100" -D "Virtual Thermal Printer" -L "Localhost" -P "/System/Library/Frameworks/ApplicationServices.framework/Versions/A/Frameworks/PrintCore.framework/Versions/A/Resources/GenericPrinter.ppd" && cupsenable Virtual_Thermal_Printer && cupsaccept Virtual_Thermal_Printer
```

**Barcode Sticker Printer:**
```bash
lpadmin -p "Virtual_Label_Printer" -E -v "socket://127.0.0.1:9101" -D "Virtual Barcode Label Printer" -L "Localhost" -P "/System/Library/Frameworks/ApplicationServices.framework/Versions/A/Frameworks/PrintCore.framework/Versions/A/Resources/GenericPrinter.ppd" && cupsenable Virtual_Label_Printer && cupsaccept Virtual_Label_Printer
```

---

## Manual Development

Requires [Node.js](https://nodejs.org/) 22+.

```bash
git clone https://github.com/mtarek47/virtual-thermal-printer.git
cd virtual-thermal-printer
npm install
npm run build
npm run dev
```

---

## Docker

```bash
npm run docker:build
npm run docker:start
```
Or manually:
```bash
docker build -t virtual-thermal-printer .
docker run --rm -p 8000:80 -p 9100:9100 -p 9101:9101 virtual-thermal-printer
```

The web UI is available at `http://localhost:8000` and the TCP socket on port `9100`.

## Releasing

1. Bump the version and create a git tag:
   ```bash
   npm run version:bump              # patch (0.0.x)
   npm run version:bump -- --part=minor  # minor (0.x.0)
   npm run version:bump -- --part=major  # major (x.0.0)
   ```
2. Push the tag to trigger the release workflow:
   ```bash
   git push && git push --tags
   ```

GitHub Actions then builds platform binaries (Linux, macOS, Windows) and a Docker image, and creates a GitHub Release.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start dev server with hot reload on port 8000 |
| `npm run build` | Build `escpos-decoder` and the frontend |
| `npm test` | Run all tests across all packages |
| `npm run docker:build` | Build Docker image |
| `npm run docker:start` | Run Docker container |
| `npm run version:bump` | Bump patch version, commit and tag |

## License

[MIT](LICENSE)
