import type { Socket } from 'node:net'
import type { WebSocket } from 'ws'
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PNG } from 'pngjs'
import bwipjs from 'bwip-js'
import QRCode from 'qrcode'

export interface LabelElementText {
	type: 'text'
	x: number
	y: number
	font: string
	rotation: number
	xMult: number
	yMult: number
	content: string
}

export interface LabelElementBarcode {
	type: 'barcode'
	x: number
	y: number
	codeType: string
	height: number
	humanReadable: boolean
	rotation: number
	narrow: number
	wide: number
	content: string
	imageBase64: string
	imageWidth: number
	imageHeight: number
}

export interface LabelElementQRCode {
	type: 'qrcode'
	x: number
	y: number
	size: number
	content: string
	imageBase64: string
	imageWidth: number
	imageHeight: number
}

export interface LabelElementBox {
	type: 'box'
	x: number
	y: number
	xEnd: number
	yEnd: number
	thickness: number
}

export interface LabelElementBar {
	type: 'bar'
	x: number
	y: number
	width: number
	height: number
}

export type LabelElement =
	| LabelElementText
	| LabelElementBarcode
	| LabelElementQRCode
	| LabelElementBox
	| LabelElementBar

export interface LabelStickerJob {
	target: 'label'
	type: 'label_item'
	protocol: 'TSPL' | 'ZPL' | 'CUPS'
	widthMm: number
	heightMm: number
	widthDots: number
	heightDots: number
	copies: number
	elements?: LabelElement[]
	imageBase64?: string
	timestamp: string
}

/**
 * Parses and processes TSPL / TSPL2 stream
 */
export async function processTsplStream(
	script: string,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	connectedClients: Set<any>,
): Promise<void> {
	// Default 40mm x 30mm @ 203 DPI (8 dots/mm)
	let widthMm = 40
	let heightMm = 30
	let widthDots = Math.round(widthMm * 8)
	let heightDots = Math.round(heightMm * 8)
	let elements: LabelElement[] = []

	const lines = script.split(/\r?\n/)

	for (const rawLine of lines) {
		const line = rawLine.trim()
		if (!line) continue

		// SIZE width [mm], height [mm]
		const sizeMatch = line.match(/^SIZE\s+([\d.]+)\s*(mm|dot)?\s*,\s*([\d.]+)\s*(mm|dot)?/i)
		if (sizeMatch) {
			const wVal = parseFloat(sizeMatch[1])
			const wUnit = sizeMatch[2]?.toLowerCase() || (wVal <= 10 ? 'inch' : 'mm')
			const hVal = parseFloat(sizeMatch[3])
			const hUnit = sizeMatch[4]?.toLowerCase() || (hVal <= 10 ? 'inch' : 'mm')

			if (wUnit === 'dot') {
				widthDots = Math.round(wVal)
				widthMm = Math.round(widthDots / 8)
			} else if (wUnit === 'inch') {
				widthMm = Math.round(wVal * 25.4)
				widthDots = Math.round(widthMm * 8)
			} else {
				widthMm = Math.round(wVal)
				widthDots = Math.round(widthMm * 8)
			}

			if (hUnit === 'dot') {
				heightDots = Math.round(hVal)
				heightMm = Math.round(heightDots / 8)
			} else if (hUnit === 'inch') {
				heightMm = Math.round(hVal * 25.4)
				heightDots = Math.round(heightMm * 8)
			} else {
				heightMm = Math.round(hVal)
				heightDots = Math.round(heightMm * 8)
			}
			continue
		}

		// CLS - Clear buffer
		if (/^CLS\b/i.test(line)) {
			elements = []
			continue
		}

		// TEXT x, y, "font", rot, x_mult, y_mult, "content"
		const textMatch = line.match(/^TEXT\s+(\d+)\s*,\s*(\d+)\s*,\s*"([^"]*)"\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(".*"|.*)$/i)
		if (textMatch) {
			const x = parseInt(textMatch[1])
			const y = parseInt(textMatch[2])
			const font = textMatch[3]
			const rot = parseInt(textMatch[4]) || 0
			const xMult = Math.max(1, parseInt(textMatch[5]) || 1)
			const yMult = Math.max(1, parseInt(textMatch[6]) || 1)
			let content = textMatch[7]
			if (content.startsWith('"') && content.endsWith('"')) {
				content = content.slice(1, -1)
			}
			elements.push({
				type: 'text',
				x,
				y,
				font,
				rotation: rot,
				xMult,
				yMult,
				content,
			})
			continue
		}

		// BARCODE x, y, "type", height, humanReadable, rot, narrow, wide, "content"
		const bcMatch = line.match(/^BARCODE\s+(\d+)\s*,\s*(\d+)\s*,\s*"([^"]*)"\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(".*"|.*)$/i)
		if (bcMatch) {
			const x = parseInt(bcMatch[1])
			const y = parseInt(bcMatch[2])
			const codeType = bcMatch[3]
			const height = parseInt(bcMatch[4]) || 50
			const humanReadable = bcMatch[5] === '1'
			const rot = parseInt(bcMatch[6]) || 0
			const narrow = parseInt(bcMatch[7]) || 2
			const wide = parseInt(bcMatch[8]) || 2
			let content = bcMatch[9]
			if (content.startsWith('"') && content.endsWith('"')) {
				content = content.slice(1, -1)
			}

			let imageBase64 = ''
			let imgW = 0
			let imgH = 0
			try {
				const bcid = codeType === '39' ? 'code39' : codeType.toLowerCase().includes('ean') ? 'ean13' : 'code128'
				const png = await bwipjs.toBuffer({
					bcid,
					text: content,
					scale: 2,
					height: Math.round(height / 6),
					includetext: humanReadable,
					textxalign: 'center',
				})
				const parsed = PNG.sync.read(png)
				imgW = parsed.width
				imgH = parsed.height
				imageBase64 = png.toString('base64')
			} catch (e) {
				console.error('Barcode render error in TSPL:', e)
			}

			elements.push({
				type: 'barcode',
				x,
				y,
				codeType,
				height,
				humanReadable,
				rotation: rot,
				narrow,
				wide,
				content,
				imageBase64,
				imageWidth: imgW,
				imageHeight: imgH,
			})
			continue
		}

		// QRCODE x, y, ECC, cellWidth, mode, rotation, "content"
		const qrMatch = line.match(/^QRCODE\s+(\d+)\s*,\s*(\d+)\s*,\s*([LMQH])\s*,\s*(\d+)\s*,\s*([AM])\s*,\s*(\d+)\s*,\s*(".*"|.*)$/i)
		if (qrMatch) {
			const x = parseInt(qrMatch[1])
			const y = parseInt(qrMatch[2])
			const cellWidth = parseInt(qrMatch[4]) || 4
			let content = qrMatch[7]
			if (content.startsWith('"') && content.endsWith('"')) {
				content = content.slice(1, -1)
			}

			let imageBase64 = ''
			let imgW = 0
			let imgH = 0
			try {
				const targetW = Math.max(64, cellWidth * 24)
				const png = await QRCode.toBuffer(content, {
					width: targetW,
					margin: 1,
					errorCorrectionLevel: 'M',
				})
				const parsed = PNG.sync.read(png)
				imgW = parsed.width
				imgH = parsed.height
				imageBase64 = png.toString('base64')
			} catch (e) {
				console.error('QR render error in TSPL:', e)
			}

			elements.push({
				type: 'qrcode',
				x,
				y,
				size: cellWidth,
				content,
				imageBase64,
				imageWidth: imgW,
				imageHeight: imgH,
			})
			continue
		}

		// BOX x, y, x_end, y_end, thickness
		const boxMatch = line.match(/^BOX\s+(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i)
		if (boxMatch) {
			elements.push({
				type: 'box',
				x: parseInt(boxMatch[1]),
				y: parseInt(boxMatch[2]),
				xEnd: parseInt(boxMatch[3]),
				yEnd: parseInt(boxMatch[4]),
				thickness: parseInt(boxMatch[5]) || 1,
			})
			continue
		}

		// BAR x, y, width, height
		const barMatch = line.match(/^BAR\s+(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i)
		if (barMatch) {
			elements.push({
				type: 'bar',
				x: parseInt(barMatch[1]),
				y: parseInt(barMatch[2]),
				width: parseInt(barMatch[3]),
				height: parseInt(barMatch[4]),
			})
			continue
		}

		// PRINT m[, n]
		const printMatch = line.match(/^PRINT\s+(\d+)(?:\s*,\s*(\d+))?/i)
		if (printMatch) {
			const copies = Math.min(20, Math.max(1, parseInt(printMatch[1]) || 1))
			const stickerJob: LabelStickerJob = {
				target: 'label',
				type: 'label_item',
				protocol: 'TSPL',
				widthMm,
				heightMm,
				widthDots,
				heightDots,
				copies,
				elements: [...elements],
				timestamp: new Date().toLocaleTimeString(),
			}

			const payload = JSON.stringify(stickerJob)
			for (const client of connectedClients) {
				client.send(payload)
			}
			console.log(`TSPL label sticker printed: ${widthMm}x${heightMm}mm (${copies} copies).`)
		}
	}
}

/**
 * Parses and processes ZPL II stream (^XA ... ^XZ)
 */
export async function processZplStream(
	script: string,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	connectedClients: Set<any>,
): Promise<void> {
	let widthDots = 320 // 40mm
	let heightDots = 240 // 30mm
	let widthMm = 40
	let heightMm = 30

	// Split by ^XZ (end of format)
	const labels = script.split(/\^XZ/i)

	for (const labelRaw of labels) {
		if (!labelRaw.includes('^XA') && !labelRaw.includes('^xa')) continue

		const elements: LabelElement[] = []
		let currentX = 0
		let currentY = 0

		// Check ^PW (Print width) & ^LL (Label length)
		const pwMatch = labelRaw.match(/\^PW(\d+)/i)
		if (pwMatch) {
			widthDots = parseInt(pwMatch[1])
			widthMm = Math.round(widthDots / 8)
		}
		const llMatch = labelRaw.match(/\^LL(\d+)/i)
		if (llMatch) {
			heightDots = parseInt(llMatch[1])
			heightMm = Math.round(heightDots / 8)
		}

		// Match field origin: ^FOx,y
		// Tokenize commands
		const tokens = labelRaw.split(/\^/).filter(Boolean)

		for (let i = 0; i < tokens.length; i++) {
			const tok = tokens[i].trim()

			if (tok.startsWith('FO')) {
				const parts = tok.slice(2).split(',')
				currentX = parseInt(parts[0]) || 0
				currentY = parseInt(parts[1]) || 0
			} else if (tok.startsWith('BC')) {
				// Code 128: ^BCo,h,f,g,e
				const parts = tok.slice(2).split(',')
				const h = parseInt(parts[1]) || 50
				const showText = parts[2] === 'Y'

				// Next token usually ^FDdata^FS
				let content = ''
				if (i + 1 < tokens.length && tokens[i + 1].startsWith('FD')) {
					content = tokens[i + 1].slice(2).replace(/\^FS.*$/i, '').trim()
					i++
				}
				if (content) {
					let imageBase64 = ''
					let imgW = 0
					let imgH = 0
					try {
						const png = await bwipjs.toBuffer({
							bcid: 'code128',
							text: content,
							scale: 2,
							height: Math.round(h / 6),
							includetext: showText,
							textxalign: 'center',
						})
						const parsed = PNG.sync.read(png)
						imgW = parsed.width
						imgH = parsed.height
						imageBase64 = `data:image/png;base64,${png.toString('base64')}`
					} catch (e) {
						console.error('ZPL Barcode error:', e)
					}

					elements.push({
						type: 'barcode',
						x: currentX,
						y: currentY,
						codeType: '128',
						height: h,
						humanReadable: showText,
						rotation: 0,
						narrow: 2,
						wide: 2,
						content,
						imageBase64,
						imageWidth: imgW,
						imageHeight: imgH,
					})
				}
			} else if (tok.startsWith('BQ')) {
				// QR Code: ^BQo,2,mag
				let content = ''
				if (i + 1 < tokens.length && tokens[i + 1].startsWith('FD')) {
					content = tokens[i + 1].slice(2).replace(/\^FS.*$/i, '').replace(/^QA,/i, '').trim()
					i++
				}
				if (content) {
					let imageBase64 = ''
					let imgW = 0
					let imgH = 0
					try {
						const png = await QRCode.toBuffer(content, {
							width: 120,
							margin: 1,
							errorCorrectionLevel: 'M',
						})
						const parsed = PNG.sync.read(png)
						imgW = parsed.width
						imgH = parsed.height
						imageBase64 = `data:image/png;base64,${png.toString('base64')}`
					} catch (e) {
						console.error('ZPL QR error:', e)
					}

					elements.push({
						type: 'qrcode',
						x: currentX,
						y: currentY,
						size: 4,
						content,
						imageBase64,
						imageWidth: imgW,
						imageHeight: imgH,
					})
				}
			} else if (tok.startsWith('FD')) {
				// Plain text: ^FDtext^FS
				const content = tok.slice(2).replace(/\^FS.*$/i, '').trim()
				if (content) {
					elements.push({
						type: 'text',
						x: currentX,
						y: currentY,
						font: '0',
						rotation: 0,
						xMult: 1,
						yMult: 1,
						content,
					})
				}
			} else if (tok.startsWith('GB')) {
				// Graphic box: ^GBw,h,t
				const parts = tok.slice(2).split(',')
				const w = parseInt(parts[0]) || 50
				const h = parseInt(parts[1]) || 50
				const t = parseInt(parts[2]) || 1
				elements.push({
					type: 'box',
					x: currentX,
					y: currentY,
					xEnd: currentX + w,
					yEnd: currentY + h,
					thickness: t,
				})
			}
		}

		if (elements.length > 0) {
			const stickerJob: LabelStickerJob = {
				target: 'label',
				type: 'label_item',
				protocol: 'ZPL',
				widthMm,
				heightMm,
				widthDots,
				heightDots,
				copies: 1,
				elements,
				timestamp: new Date().toLocaleTimeString(),
			}

			const payload = JSON.stringify(stickerJob)
			for (const client of connectedClients) {
				client.send(payload)
			}
			console.log(`ZPL label sticker printed: ${widthMm}x${heightMm}mm.`)
		}
	}
}

/**
 * Handles PDF / PostScript CUPS print jobs on label port (9101)
 */
async function handleLabelDocumentStream(
	socket: Socket,
	firstChunk: Buffer,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	connectedClients: Set<any>,
) {
	const chunks: Buffer[] = [firstChunk]
	const remoteAddressString = socket.remoteAddress && socket.remotePort
		? `${socket.remoteAddress}:${socket.remotePort}`
		: 'unknown'

	console.log(`Receiving label document (CUPS PDF) from ${remoteAddressString}...`)

	socket.on('data', (chunk: Buffer) => {
		chunks.push(chunk)
	})

	await new Promise<void>((resolve) => {
		socket.on('end', () => resolve())
		socket.on('close', () => resolve())
		socket.on('error', () => resolve())
	})

	const fullBuffer = Buffer.concat(chunks)
	// Immediately close the socket so CUPS/spooler finishes instantly without waiting
	try {
		socket.destroy()
	} catch {}

	if (fullBuffer.length === 0) return

	// Detect requested copies if specified in PostScript / CUPS header
	let detectedCopies = 1
	const headerPreview = fullBuffer.subarray(0, 4096).toString('latin1')
	const copiesMatch = headerPreview.match(/#copies\s+(\d+)/) || headerPreview.match(/%%NumCopies:\s*(\d+)/)
	if (copiesMatch) {
		detectedCopies = Math.max(1, parseInt(copiesMatch[1]) || 1)
	}

	const tempBase = join(tmpdir(), `vlp-${Date.now()}-${Math.random().toString(36).slice(2)}`)
	const isPdf = fullBuffer.subarray(0, 4).toString() === '%PDF'
	const pdfPath = `${tempBase}.pdf`
	const pngPath = `${tempBase}.png`

	try {
		if (isPdf) {
			writeFileSync(pdfPath, fullBuffer)
		} else {
			const psPath = `${tempBase}.ps`
			writeFileSync(psPath, fullBuffer)
			try {
				execSync(`cupsfilter -m application/pdf "${psPath}" > "${pdfPath}" 2>/dev/null`)
			} catch {
				writeFileSync(pdfPath, fullBuffer)
			}
			try { unlinkSync(psPath) } catch {}
		}

		if (existsSync(pdfPath)) {
			// Convert PDF to PNG resampled to sticker width using sips
			try {
				execSync(`/usr/bin/sips -s format png --resampleWidth 380 "${pdfPath}" --out "${pngPath}" 2>/dev/null`)
			} catch (e) {
				console.error('sips conversion error:', e)
			}

			if (existsSync(pngPath)) {
				const pngBuf = readFileSync(pngPath)
				const originalPng = PNG.sync.read(pngBuf)

				// Trim bottom whitespace
				let lastNonWhiteY = originalPng.height - 1
				for (let y = originalPng.height - 1; y >= 0; y--) {
					let hasContent = false
					for (let x = 0; x < originalPng.width; x++) {
						const idx = (originalPng.width * y + x) << 2
						const r = originalPng.data[idx]
						const g = originalPng.data[idx + 1]
						const b = originalPng.data[idx + 2]
						const a = originalPng.data[idx + 3]
						if (a > 10 && (r < 245 || g < 245 || b < 245)) {
							hasContent = true
							break
						}
					}
					if (hasContent) {
						lastNonWhiteY = Math.min(originalPng.height - 1, y + 16)
						break
					}
				}

				const trimmedHeight = Math.max(60, lastNonWhiteY + 1)
				const trimmedPng = new PNG({ width: originalPng.width, height: trimmedHeight })
				originalPng.data.copy(trimmedPng.data, 0, 0, originalPng.width * trimmedHeight * 4)
				const finalPngBuf = PNG.sync.write(trimmedPng)

				const stickerJob: LabelStickerJob = {
					target: 'label',
					type: 'label_item',
					protocol: 'CUPS',
					widthMm: 40,
					heightMm: 30,
					widthDots: trimmedPng.width,
					heightDots: trimmedPng.height,
					copies: detectedCopies,
					imageBase64: finalPngBuf.toString('base64'),
					timestamp: new Date().toLocaleTimeString(),
				}

				console.log(`CUPS Label Document rendered: ${trimmedPng.width}x${trimmedPng.height}.`)

				for (const client of connectedClients) {
					client.send(JSON.stringify(stickerJob))
				}
			}
		}
	} catch (err) {
		console.error('Failed to process label print document:', err)
	} finally {
		try { unlinkSync(pdfPath) } catch {}
		try { unlinkSync(pngPath) } catch {}
	}
}

/**
 * Handles incoming TCP socket connection on Label Port 9101
 */
export async function handleLabelConnection(
	socket: Socket,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	connectedClients: Set<any>,
): Promise<void> {
	const remoteAddressString = socket.remoteAddress && socket.remotePort
		? `${socket.remoteAddress}:${socket.remotePort}`
		: 'unknown'
	console.log(`New connection to Label Printer from ${remoteAddressString}.`)

	socket.once('data', async (firstChunk: Buffer) => {
		try {
			// Check if incoming is PDF (%PDF) or PostScript (%!) from CUPS
			if (
				firstChunk.length >= 2 &&
				firstChunk[0] === 0x25 && // '%'
				(firstChunk[1] === 0x21 || firstChunk[1] === 0x50) // '!' or 'P'
			) {
				await handleLabelDocumentStream(socket, firstChunk, connectedClients)
			} else {
				// Accumulate TSPL or ZPL text stream
				const chunks: Buffer[] = [firstChunk]
				socket.on('data', (c) => chunks.push(c))

				await new Promise<void>((resolve) => {
					socket.on('end', () => resolve())
					socket.on('close', () => resolve())
					socket.on('error', () => resolve())
				})

				const fullText = Buffer.concat(chunks).toString('utf-8')
				if (fullText.includes('^XA') || fullText.includes('^xa')) {
					await processZplStream(fullText, connectedClients)
				} else {
					await processTsplStream(fullText, connectedClients)
				}
			}
		} catch (error) {
			console.error(`Error handling Label connection from ${remoteAddressString}:`, error)
		} finally {
			try {
				socket.destroy()
			} catch {}
			console.log(`Label connection from ${remoteAddressString} closed.`)
		}
	})
}
