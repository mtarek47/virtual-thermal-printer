#!/usr/bin/env node

import { existsSync } from 'node:fs'
import { spawn, execSync } from 'node:child_process'
import { platform } from 'node:os'

const isWindows = platform() === 'win32'
const isMac = platform() === 'darwin'
const isLinux = platform() === 'linux'
const npmCmd = isWindows ? 'npm.cmd' : 'npm'

console.log('\x1b[36m%s\x1b[0m', '=======================================================')
console.log('\x1b[1m\x1b[32m%s\x1b[0m', '   🖨️  Virtual Thermal & Barcode Label Printer Suite')
console.log('\x1b[36m%s\x1b[0m', '=======================================================')
console.log('  🌐 Web Interface:      http://localhost:8000')
console.log('  🧾 Receipt Port:        9100 (ESC/POS / ePOS)')
console.log('  🏷️  Barcode Label Port:  9101 (TSPL / ZPL / CUPS)')
console.log('\x1b[36m%s\x1b[0m', '-------------------------------------------------------')

// 1. Check node_modules
if (!existsSync('node_modules')) {
	console.log('📦 Installing dependencies (npm install)...')
	execSync(`${npmCmd} install`, { stdio: 'inherit', shell: true })
}

// 1.1 Ensure platform-specific esbuild binary is installed on Windows
if (isWindows && !existsSync('node_modules/@esbuild/win32-x64')) {
	console.log('📦 Installing Windows esbuild binary (@esbuild/win32-x64)...')
	try {
		execSync(`${npmCmd} install @esbuild/win32-x64@0.24.2 --no-save`, { stdio: 'inherit', shell: true })
	} catch (err) {
		console.warn('Notice: @esbuild/win32-x64 direct install attempted.')
	}
}

// 2. Check build output
if (
	!existsSync('packages/virtual-thermal-printer/dist') ||
	!existsSync('packages/escpos-decoder/dist')
) {
	console.log('🔨 Building packages (npm run build)...')
	execSync(`${npmCmd} run build`, { stdio: 'inherit', shell: true })
}

// 3. Open browser automatically
setTimeout(() => {
	try {
		const url = 'http://localhost:8000'
		if (isMac) {
			execSync(`open ${url}`, { stdio: 'ignore' })
		} else if (isWindows) {
			execSync(`start ${url}`, { stdio: 'ignore' })
		} else if (isLinux) {
			execSync(`xdg-open ${url}`, { stdio: 'ignore' })
		}
	} catch {}
}, 2500)

// 4. Start server
console.log('🚀 Starting printer server...')
const child = spawn(
	npmCmd,
	['run', 'dev', '--workspace=packages/virtual-thermal-printer'],
	{
		stdio: 'inherit',
		shell: true,
	},
)

child.on('exit', (code) => {
	process.exit(code ?? 0)
})
