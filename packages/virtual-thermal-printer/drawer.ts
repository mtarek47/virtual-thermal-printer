export interface DrawerKickOptions {
	pin?: number // 2 (Drawer 1) or 5 (Drawer 2)
	drawer?: number // 1 or 2
	pulseMs?: number // Pulse ON time in milliseconds (e.g. 50ms)
	protocol?: string // 'ESC/POS (ESC p)', 'Star BEL', 'ePOS XML', 'REST API', etc.
}

export interface DrawerKickRecord {
	protocol: string
	pin: number
	drawer: number
	pulseMs: number
	timestamp: string
}

export interface DrawerStatus {
	success: boolean
	isOpen: boolean
	drawer1: boolean // Pin 2 state
	drawer2: boolean // Pin 5 state
	isLocked: boolean // Key lock
	pinSensor: boolean // Pin 3 microswitch (true = circuit open / drawer open)
	voltage: string
	interface: string
	openCount: number
	lastKickedAt: string | null
	lastKickInfo: DrawerKickRecord | null
	autoCloseMs: number
}

export type DrawerListener = (event: {
	action: 'open' | 'close' | 'toggle' | 'lock_change' | 'status'
	status: DrawerStatus
	kickInfo?: DrawerKickRecord
	blocked?: boolean
}) => void

export class SmartCashDrawer {
	private _isOpen = false
	private _isLocked = false
	private _openCount = 0
	private _lastKickedAt: string | null = null
	private _lastKickInfo: DrawerKickRecord | null = null
	private _autoCloseMs = 4000
	private _autoCloseTimer: NodeJS.Timeout | null = null
	private _listeners = new Set<DrawerListener>()

	get isOpen(): boolean {
		return this._isOpen
	}

	get isLocked(): boolean {
		return this._isLocked
	}

	get openCount(): number {
		return this._openCount
	}

	get lastKickedAt(): string | null {
		return this._lastKickedAt
	}

	get lastKickInfo(): DrawerKickRecord | null {
		return this._lastKickInfo
	}

	get autoCloseMs(): number {
		return this._autoCloseMs
	}

	setAutoClose(ms: number) {
		this._autoCloseMs = Math.max(0, ms)
		this._notify('status')
	}

	subscribe(listener: DrawerListener): () => void {
		this._listeners.add(listener)
		return () => this._listeners.delete(listener)
	}

	private _notify(
		action: 'open' | 'close' | 'toggle' | 'lock_change' | 'status',
		kickInfo?: DrawerKickRecord,
		blocked?: boolean,
	) {
		const status = this.getStatus()
		for (const listener of this._listeners) {
			try {
				listener({ action, status, kickInfo, blocked })
			} catch (err) {
				console.error('Drawer listener error:', err)
			}
		}
	}

	getStatus(): DrawerStatus {
		return {
			success: true,
			isOpen: this._isOpen,
			drawer1: this._isOpen,
			drawer2: false,
			isLocked: this._isLocked,
			pinSensor: this._isOpen, // Pin 3 switch: HIGH when open
			voltage: '24V DC / 1A',
			interface: 'RJ12 (Pin 2 / Pin 5) • ESC/POS • Star • ePOS • UPOS',
			openCount: this._openCount,
			lastKickedAt: this._lastKickedAt,
			lastKickInfo: this._lastKickInfo,
			autoCloseMs: this._autoCloseMs,
		}
	}

	/**
	 * International standard cash drawer kick routine
	 * Triggered by ESC p, Star BEL, ePOS pulse, or REST API
	 */
	kick(options: DrawerKickOptions = {}): { kicked: boolean; reason?: string } {
		const pin = options.pin === 5 || options.drawer === 2 ? 5 : 2
		const drawer = pin === 5 ? 2 : 1
		const pulseMs = options.pulseMs ?? 50
		const protocol = options.protocol ?? 'ESC/POS (ESC p)'
		const now = new Date().toISOString()

		const kickRecord: DrawerKickRecord = {
			protocol,
			pin,
			drawer,
			pulseMs,
			timestamp: now,
		}

		if (this._isLocked) {
			console.log(`[CashDrawer] 24V Kick received on Pin ${pin} (${protocol}), but physical KEY LOCK is ENGAGED! Drawer remains locked.`)
			this._notify('status', kickRecord, true)
			return { kicked: false, reason: 'Hardware key lock is engaged' }
		}

		this._isOpen = true
		this._openCount++
		this._lastKickedAt = now
		this._lastKickInfo = kickRecord

		console.log(
			`[CashDrawer] ⚡ 24V Solenoid Pulse (${pulseMs}ms) fired on Pin ${pin} via ${protocol}. Drawer OPENED! (Total openings: ${this._openCount})`,
		)

		this._clearAutoCloseTimer()
		if (this._autoCloseMs > 0) {
			this._autoCloseTimer = setTimeout(() => {
				this.close()
			}, this._autoCloseMs)
		}

		this._notify('open', kickRecord)
		return { kicked: true }
	}

	close(): boolean {
		this._clearAutoCloseTimer()
		if (!this._isOpen) return false
		this._isOpen = false
		console.log('[CashDrawer] Drawer pushed closed.')
		this._notify('close')
		return true
	}

	toggle(): boolean {
		if (this._isOpen) {
			this.close()
			return false
		} else {
			this.kick({ protocol: 'Manual Toggle' })
			return true
		}
	}

	setLock(locked: boolean): boolean {
		this._isLocked = Boolean(locked)
		if (this._isLocked && this._isOpen) {
			this.close()
		}
		console.log(`[CashDrawer] Hardware key lock set to: ${this._isLocked ? 'LOCKED (Electronic Kick Disabled)' : 'UNLOCKED / AUTO'}`)
		this._notify('lock_change')
		return this._isLocked
	}

	private _clearAutoCloseTimer() {
		if (this._autoCloseTimer) {
			clearTimeout(this._autoCloseTimer)
			this._autoCloseTimer = null
		}
	}
}

export const cashDrawer = new SmartCashDrawer()
