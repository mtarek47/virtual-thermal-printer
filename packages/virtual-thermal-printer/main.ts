import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import type { ServerType } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { WebSocketServer, WebSocket } from 'ws'
import { parseArgs } from 'node:util'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { isSea, getAsset } from 'node:sea'
import { handleConnection, processEscPosStream } from './escpos.js'
import { cashDrawer } from './drawer.js'
import {
	handleLabelConnection,
	processTsplStream,
	processZplStream,
} from './label_engine.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const appVersion = (() => {
	if (isSea()) {
		return typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'unknown'
	}
	try {
		const pkgJson = JSON.parse(
			readFileSync(join(__dirname, 'package.json'), 'utf-8'),
		)
		if (typeof pkgJson.version === 'string') {
			return pkgJson.version
		}
	} catch (event) {
		console.error(
			'Failed to read app version from package.json:',
			event instanceof Error ? event.message : event,
		)
	}
	return 'unknown'
})()
console.log(`App version: ${appVersion}`)

const { values: flags } = parseArgs({
	args: process.argv.slice(2),
	options: {
		http: { type: 'string', default: '8000' },
		socket: { type: 'string', default: '9100' },
		labelSocket: { type: 'string', default: '9101' },
	},
})

function validatePort(portValue: string | number, portName: string): number {
	const port = typeof portValue === 'string' ? parseInt(portValue) : portValue
	if (isNaN(port) || port < 1 || port > 65535) {
		throw new Error(`Invalid ${portName} port.`)
	}
	return port
}

const httpPort = validatePort(flags['http'] ?? '8000', 'HTTP')
const socketPort = validatePort(flags['socket'] ?? '9100', 'Socket')
const labelSocketPort = validatePort(flags['labelSocket'] ?? '9101', 'Label Socket')

const app = new Hono()

app.get('/health', (context) => context.text('OK'))
app.get('/version', (context) => context.text(appVersion))

const eposEndpoint = '/cgi-bin/epos/service.cgi'
app.use(eposEndpoint, cors())
app.post(eposEndpoint, async (context) => {
	const requestBody = await context.req.text()

	// 1. Check for Epson ePOS XML <pulse> drawer kick tag
	if (requestBody.includes('<pulse')) {
		const drawerMatch = requestBody.match(/drawer="([^"]+)"/)
		const timeMatch = requestBody.match(/time="pulse_(\d+)"/)
		const drawerName = drawerMatch ? drawerMatch[1] : 'drawer_1'
		const pin = drawerName.includes('2') ? 5 : 2
		const pulseMs = timeMatch ? parseInt(timeMatch[1], 10) : 100
		cashDrawer.kick({
			pin,
			drawer: pin === 5 ? 2 : 1,
			pulseMs,
			protocol: 'Epson ePOS XML (<pulse>)',
		})
	}

	const commandMatch = requestBody.match(/<command>([^<]+)<\/command>/)
	if (!commandMatch || !commandMatch[1]) {
		// If it was just a pulse command without print payload
		if (requestBody.includes('<pulse')) {
			return context.text(
				`<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><response xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print" success="true" code="" status="0" batterystatus="0" drawerstatus="${cashDrawer.isOpen ? 'open' : 'closed'}" printjobid="1" /></s:Body></s:Envelope>`,
				200,
				{ 'Content-Type': 'text/xml' },
			)
		}
		return context.text('Invalid ePOS request', 400)
	}

	const hexCommand = commandMatch[1]
	const commandBytes = new Uint8Array(
		hexCommand.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)),
	)

	const stream = new ReadableStream({
		start(controller) {
			controller.enqueue(commandBytes)
			controller.close()
		},
	})

	await processEscPosStream(stream, connectedClients)

	return context.text(
		`<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><response xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print" success="true" code="" status="0" batterystatus="0" drawerstatus="${cashDrawer.isOpen ? 'open' : 'closed'}" printjobid="2" /></s:Body></s:Envelope>`,
		200,
		{ 'Content-Type': 'text/xml' },
	)
})

// ─── Cash Drawer REST & UPOS (UnifiedPOS) Endpoints ─────────────────────────
app.use('/cgi-bin/drawer/*', cors())

app.get('/cgi-bin/drawer/status', (context) => {
	return context.json(cashDrawer.getStatus())
})

app.post('/cgi-bin/drawer/open', async (context) => {
	let pin = 2
	let pulseMs = 50
	let protocol = 'UnifiedPOS / REST API'
	try {
		const body = await context.req.json()
		if (body.pin === 5 || body.drawer === 2) pin = 5
		if (body.pulseMs) pulseMs = Number(body.pulseMs)
		if (body.protocol) protocol = String(body.protocol)
	} catch {
		// Empty body is valid
	}
	const result = cashDrawer.kick({ pin, pulseMs, protocol })
	return context.json({ ...cashDrawer.getStatus(), ...result })
})

app.post('/cgi-bin/drawer/close', (context) => {
	cashDrawer.close()
	return context.json(cashDrawer.getStatus())
})

app.post('/cgi-bin/drawer/toggle', (context) => {
	cashDrawer.toggle()
	return context.json(cashDrawer.getStatus())
})

app.post('/cgi-bin/drawer/lock', async (context) => {
	let locked = !cashDrawer.isLocked
	try {
		const body = await context.req.json()
		if (typeof body.locked === 'boolean') {
			locked = body.locked
		}
	} catch {}
	cashDrawer.setLock(locked)
	return context.json(cashDrawer.getStatus())
})

app.post('/cgi-bin/drawer/auto-close', async (context) => {
	try {
		const body = await context.req.json()
		if (typeof body.autoCloseMs === 'number') {
			cashDrawer.setAutoClose(body.autoCloseMs)
		}
	} catch {}
	return context.json(cashDrawer.getStatus())
})

// Barcode Sticker / Label Printer Endpoints (TSPL / ZPL / JSON)
const labelEndpoint = '/cgi-bin/label/print'
app.use(labelEndpoint, cors())
app.post(labelEndpoint, async (context) => {
	const body = await context.req.text()
	try {
		const json = JSON.parse(body)
		if (json.protocol === 'zpl' || (typeof json.data === 'string' && json.data.includes('^XA'))) {
			await processZplStream(json.data || '', connectedClients)
		} else {
			await processTsplStream(json.data || json.tspl || body, connectedClients)
		}
		return context.json({ success: true, message: 'Label print job processed' })
	} catch {
		if (body.includes('^XA') || body.includes('^xa')) {
			await processZplStream(body, connectedClients)
		} else {
			await processTsplStream(body, connectedClients)
		}
		return context.json({ success: true, message: 'Raw label script processed' })
	}
})

app.use('/cgi-bin/label/tspl', cors())
app.post('/cgi-bin/label/tspl', async (context) => {
	const body = await context.req.text()
	await processTsplStream(body, connectedClients)
	return context.text('OK\n')
})

app.use('/cgi-bin/label/zpl', cors())
app.post('/cgi-bin/label/zpl', async (context) => {
	const body = await context.req.text()
	await processZplStream(body, connectedClients)
	return context.text('OK\n')
})

if (isSea()) {
	const mimeTypes: Record<string, string> = {
		html: 'text/html; charset=utf-8',
		js: 'application/javascript',
		css: 'text/css',
		png: 'image/png',
		mp3: 'audio/mpeg',
		json: 'application/json',
		webmanifest: 'application/manifest+json',
		map: 'application/json',
	}
	app.use('/*', (context) => {
		const assetKey = context.req.path.replace(/^\//, '') || 'index.html'
		const ext = assetKey.split('.').pop() ?? ''
		try {
			const data = getAsset(assetKey) as ArrayBuffer
			return context.body(data, 200, { 'Content-Type': mimeTypes[ext] ?? 'application/octet-stream' })
		} catch {
			try {
				const data = getAsset('index.html') as ArrayBuffer
				return context.body(data, 200, { 'Content-Type': 'text/html; charset=utf-8' })
			} catch {
				return context.text('Not found', 404)
			}
		}
	})
} else {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	app.use('/*', serveStatic({ root: join(__dirname, 'dist') }) as any)
}

const connectedClients = new Set<WebSocket>()

cashDrawer.subscribe((event) => {
	const payload = JSON.stringify({
		type: 'drawer',
		action: event.action,
		status: event.status,
		kickInfo: event.kickInfo,
		blocked: event.blocked,
	})
	for (const client of connectedClients) {
		try {
			client.send(payload)
		} catch {}
	}
})

const server: ServerType = serve(
	{
		fetch: app.fetch,
		port: httpPort,
		hostname: '0.0.0.0',
	},
	(info) => {
		console.log(`Listening to HTTP on http://${info.address}:${info.port}.`)
	},
)

const wss = new WebSocketServer({ noServer: true })

server.on('upgrade', (request, socket, head) => {
	if (request.url === '/stream') {
		wss.handleUpgrade(request, socket, head, (ws) => {
			wss.emit('connection', ws, request)
		})
	} else {
		socket.destroy()
	}
})

wss.on('connection', (ws) => {
	console.log('WebSocket opened.')
	connectedClients.add(ws)

	// Send current cash drawer state immediately on connect
	try {
		ws.send(
			JSON.stringify({
				type: 'drawer',
				action: 'status',
				status: cashDrawer.getStatus(),
			}),
		)
	} catch {}

	ws.on('message', (raw) => {
		try {
			const msg = JSON.parse(raw.toString())
			if (msg.type === 'drawer_action') {
				if (msg.action === 'kick' || msg.action === 'open') {
					cashDrawer.kick({
						pin: msg.pin || 2,
						drawer: msg.drawer || (msg.pin === 5 ? 2 : 1),
						pulseMs: msg.pulseMs || 50,
						protocol: msg.protocol || 'Web Dashboard (Manual Kick)',
					})
				} else if (msg.action === 'close') {
					cashDrawer.close()
				} else if (msg.action === 'toggle') {
					cashDrawer.toggle()
				} else if (msg.action === 'lock') {
					cashDrawer.setLock(Boolean(msg.locked))
				} else if (msg.action === 'auto_close') {
					cashDrawer.setAutoClose(Number(msg.delayMs) ?? 4000)
				}
			}
		} catch {}
	})

	ws.on('close', () => {
		console.log('WebSocket closed.')
		connectedClients.delete(ws)
	})
	ws.on('error', (err) => {
		console.log('WebSocket error:', err.message)
		connectedClients.delete(ws)
	})
})

server.on('error', (err: any) => {
	console.error('HTTP server error:', err)
})

const escposServer = createServer((socket) => {
	handleConnection(socket, connectedClients)
})
let actualSocketPort = socketPort
escposServer.on('error', (err: any) => {
	if (err.code === 'EADDRINUSE') {
		console.warn(`⚠️ Warning: Port ${actualSocketPort} is already in use by another program or service (e.g. POS Printer Emulator).`)
		if (actualSocketPort === socketPort && socketPort === 9100) {
			actualSocketPort = 9102
			console.log(`🔄 Retrying ESC/POS raw socket server on fallback port ${actualSocketPort}...`)
			escposServer.listen(actualSocketPort, '0.0.0.0')
		} else {
			console.warn(`⚠️ ESC/POS raw socket listener could not be bound, but HTTP Web UI & ePOS API (port ${httpPort}) remain active!`)
		}
	} else {
		console.error('ESC/POS server error:', err)
	}
})
escposServer.listen(actualSocketPort, '0.0.0.0', () => {
	console.log(`Listening to Socket on port ${actualSocketPort}.`)
})

const labelServer = createServer((socket) => {
	handleLabelConnection(socket, connectedClients)
})
let actualLabelPort = labelSocketPort
labelServer.on('error', (err: any) => {
	if (err.code === 'EADDRINUSE') {
		console.warn(`⚠️ Warning: Port ${actualLabelPort} is already in use by another process.`)
		if (actualLabelPort === labelSocketPort && labelSocketPort === 9101) {
			actualLabelPort = 9103
			console.log(`🔄 Retrying Label socket server on fallback port ${actualLabelPort}...`)
			labelServer.listen(actualLabelPort, '0.0.0.0')
		} else {
			console.warn(`⚠️ Label socket listener could not be bound, but HTTP Web UI & Label API remain active!`)
		}
	} else {
		console.error('Label server error:', err)
	}
})
labelServer.listen(actualLabelPort, '0.0.0.0', () => {
	console.log(`Listening to Label Socket on port ${actualLabelPort}.`)
})
