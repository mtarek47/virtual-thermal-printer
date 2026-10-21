import { Readable } from 'node:stream'
import type { Socket } from 'node:net'
import { EscPosTransformer } from 'escpos-decoder'
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PNG } from 'pngjs'

const ESC = 0x1b
const INITIALIZE_PRINTER = 0x40 // '@' - the byte after ESC in "ESC @"

// Positive validation instead of a per-protocol blocklist: a genuine ESC/POS
// print job opens with "ESC @" (Initialize Printer). Every ESC/POS library
// emits it first and both of this project's fixtures start with it. Port
// scanners probing :9100 for other services all open with something else, so
// none pass this gate:
//   Redis     "*1\r\n$4\r\nPING\r\n"          -> '*'  (0x2a)
//   Memcached "stats\r\n"                       -> 's'  (0x73)
//   MongoDB   "..admin.$cmd..isMaster.."        -> message-length prefix
//   PJL       "@PJL INFO STATUS"                 -> '@'  (0x40)
//   PJL+UEL   "ESC %-12345X@PJL.."              -> ESC then '%' (0x25), not '@'
//   HTTP      "GET / HTTP/1.1"                   -> 'G'  (0x47)
//   TLS       ClientHello                        -> 0x16
//   Null-byte banner grab                        -> 0x00
// Requiring "ESC @" specifically (rather than any control byte) is what closes
// the UEL case, whose "ESC %" opening would otherwise pass an ESC-lead check.
//
// Trade-off: "ESC @" is a convention, not a protocol requirement — the printer
// prints without it. Standard libraries and drivers (python-escpos, node
// escpos, Epson/Star) emit it first to reset state, so ordinary print software
// is unaffected. But a client that opens the connection with something else is
// rejected, e.g.:
//   - a raw/minimal client sending plain text (echo "..." | nc host 9100);
//   - a driver that leads with a status/ID query such as DLE EOT (0x10 0x04)
//     or a code-page selection before initializing;
//   - a client relying on persistent printer state that sends a follow-up job
//     on a fresh connection without re-initializing.
// These are rare in practice and the accepted price for dropping every scanner
// protocol without chasing per-protocol signatures. A rejected connection is
// logged as "Connection did not start as ESC/POS" (see ProbeFilterTransformer);
// if a legitimate client trips it, restrict access by source IP instead — that
// is the only gate with neither false positives nor false negatives.
export type EscPosStartVerdict = 'accept' | 'reject' | 'incomplete'

// Classify a connection's leading bytes. 'incomplete' means we cannot decide
// yet and need more bytes — only possible when a split TCP write delivers just
// the lone ESC of "ESC @" so far. The buffer is held (never forwarded) until it
// resolves to 'accept' or 'reject', so a probe that fragments a leading ESC
// byte cannot slip through on the "wait-and-see" byte.
export function classifyEscPosStart(leading: Uint8Array): EscPosStartVerdict {
	if (leading.length === 0) {
		return 'incomplete'
	}
	if (leading[0] !== ESC) {
		return 'reject'
	}
	if (leading.length < 2) {
		return 'incomplete'
	}
	return leading[1] === INITIALIZE_PRINTER ? 'accept' : 'reject'
}

class ProbeFilterTransformer implements Transformer<Uint8Array, Uint8Array> {
	#decided = false
	#pending: Uint8Array = new Uint8Array(0)

	transform(
		chunk: Uint8Array,
		controller: TransformStreamDefaultController<Uint8Array>,
	) {
		if (this.#decided) {
			controller.enqueue(chunk)
			return
		}

		// Accumulate leading bytes until we can tell whether the connection opens
		// with "ESC @". Nothing is forwarded downstream until we're sure.
		const merged = new Uint8Array(this.#pending.length + chunk.length)
		merged.set(this.#pending)
		merged.set(chunk, this.#pending.length)
		this.#pending = merged

		switch (classifyEscPosStart(this.#pending)) {
			case 'incomplete':
				return
			case 'reject':
				console.log(
					'Connection did not start as ESC/POS, ignoring (probe/scan).',
				)
				controller.terminate()
				return
			case 'accept':
				this.#decided = true
				controller.enqueue(this.#pending)
				this.#pending = new Uint8Array(0)
				return
		}
	}
}

export async function processEscPosStream(
	stream: ReadableStream<Uint8Array>,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	connectedClients: Set<any>,
) {
	const escPosTransformer = new TransformStream(new EscPosTransformer())

	try {
		const parsedBlocks = stream.pipeThrough(escPosTransformer)

		const reader = parsedBlocks.getReader()
		try {
			while (true) {
				const { done, value: block } = await reader.read()
				if (done) break

				const dataToSend = JSON.stringify(block)
				for (const client of connectedClients) {
					client.send(dataToSend)
				}
			}
		} finally {
			reader.releaseLock()
		}
	} catch (error) {
		console.error('Error in handling connection or parsing stream:', error)
	}
}

async function handleDocumentStream(
	socket: Socket,
	firstChunk: Buffer,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	connectedClients: Set<any>,
) {
	const chunks: Buffer[] = [firstChunk]
	const remoteAddressString = socket.remoteAddress && socket.remotePort
		? `${socket.remoteAddress}:${socket.remotePort}`
		: 'unknown'

	console.log(`Receiving print document (PDF/PS) from ${remoteAddressString}...`)

	socket.on('data', (chunk: Buffer) => {
		chunks.push(chunk)
	})

	await new Promise<void>((resolve) => {
		socket.on('end', () => resolve())
		socket.on('close', () => resolve())
		socket.on('error', () => resolve())
	})

	const fullBuffer = Buffer.concat(chunks)
	if (fullBuffer.length === 0) return

	const tempBase = join(tmpdir(), `vtp-${Date.now()}-${Math.random().toString(36).slice(2)}`)
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
			// Convert PDF to PNG resampled to 512px width
			execSync(`sips -s format png --resampleWidth 512 "${pdfPath}" --out "${pngPath}" 2>/dev/null`)

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
						lastNonWhiteY = Math.min(originalPng.height - 1, y + 20)
						break
					}
				}

				const trimmedHeight = Math.max(50, lastNonWhiteY + 1)
				const trimmedPng = new PNG({ width: originalPng.width, height: trimmedHeight })
				originalPng.data.copy(trimmedPng.data, 0, 0, originalPng.width * trimmedHeight * 4)
				const finalPngBuf = PNG.sync.write(trimmedPng)

				const imageBlock = {
					type: 'image',
					width: trimmedPng.width,
					height: trimmedPng.height,
					base64: `data:image/png;base64,${finalPngBuf.toString('base64')}`,
					alignment: 1, // center
				}
				const cutBlock = {
					type: 'command',
					name: 'Cut Paper',
				}

				console.log(`Document rendered to ${trimmedPng.width}x${trimmedPng.height} receipt image.`)

				for (const client of connectedClients) {
					client.send(JSON.stringify(imageBlock))
					client.send(JSON.stringify(cutBlock))
				}
			}
		}
	} catch (err) {
		console.error('Failed to process print document:', err)
	} finally {
		try { unlinkSync(pdfPath) } catch {}
		try { unlinkSync(pngPath) } catch {}
	}
}

export async function handleConnection(
	socket: Socket,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	connectedClients: Set<any>,
) {
	const remoteAddressString = socket.remoteAddress && socket.remotePort
		? `${socket.remoteAddress}:${socket.remotePort}`
		: 'unknown'
	console.log(`New connection from ${remoteAddressString}.`)

	socket.once('data', async (firstChunk: Buffer) => {
		try {
			if (
				firstChunk.length >= 2 &&
				firstChunk[0] === 0x25 && // '%'
				(firstChunk[1] === 0x21 || firstChunk[1] === 0x50) // '!' or 'P'
			) {
				await handleDocumentStream(socket, firstChunk, connectedClients)
			} else {
				socket.unshift(firstChunk)
				const readable = Readable.toWeb(socket) as ReadableStream<Uint8Array>
				await processEscPosStream(
					readable.pipeThrough(
						new TransformStream(new ProbeFilterTransformer()),
					),
					connectedClients,
				)
			}
		} catch (error) {
			if (!(error instanceof Error && error.message.includes('terminate'))) {
				console.error(
					`Error handling connection from ${remoteAddressString}:`,
					error,
				)
			}
		} finally {
			try {
				socket.destroy()
			} catch (_error) {
				// Socket might already be closed
			}
			console.log(`Connection from ${remoteAddressString} closed.`)
		}
	})
}
