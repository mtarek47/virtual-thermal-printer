import { describe, it, expect, beforeEach } from 'vitest'
import { SmartCashDrawer } from './drawer.js'

describe('SmartCashDrawer', () => {
	let drawer: SmartCashDrawer

	beforeEach(() => {
		drawer = new SmartCashDrawer()
		drawer.setAutoClose(0) // disable auto-close during unit test
	})

	it('initializes with closed, unlocked state', () => {
		const status = drawer.getStatus()
		expect(status.isOpen).toBe(false)
		expect(status.isLocked).toBe(false)
		expect(status.openCount).toBe(0)
		expect(status.lastKickedAt).toBeNull()
		expect(status.pinSensor).toBe(false)
	})

	it('opens when kicked via ESC/POS Pin 2 pulse', () => {
		const result = drawer.kick({
			pin: 2,
			pulseMs: 50,
			protocol: 'ESC/POS (ESC p)',
		})
		expect(result.kicked).toBe(true)
		expect(drawer.isOpen).toBe(true)
		expect(drawer.openCount).toBe(1)
		expect(drawer.lastKickInfo?.pin).toBe(2)
		expect(drawer.lastKickInfo?.pulseMs).toBe(50)
		expect(drawer.getStatus().pinSensor).toBe(true)
	})

	it('opens secondary drawer via Pin 5 (ESC p 1)', () => {
		const result = drawer.kick({
			pin: 5,
			drawer: 2,
			pulseMs: 100,
			protocol: 'ESC/POS Pin 5',
		})
		expect(result.kicked).toBe(true)
		expect(drawer.isOpen).toBe(true)
		expect(drawer.lastKickInfo?.pin).toBe(5)
		expect(drawer.lastKickInfo?.drawer).toBe(2)
	})

	it('closes manually when pushed shut', () => {
		drawer.kick({ pin: 2 })
		expect(drawer.isOpen).toBe(true)
		const closed = drawer.close()
		expect(closed).toBe(true)
		expect(drawer.isOpen).toBe(false)
		expect(drawer.getStatus().pinSensor).toBe(false)
	})

	it('blocks electronic kick when key lock is engaged (LOCKED)', () => {
		drawer.setLock(true)
		expect(drawer.isLocked).toBe(true)

		const result = drawer.kick({ pin: 2, protocol: 'ESC/POS' })
		expect(result.kicked).toBe(false)
		expect(result.reason).toContain('Hardware key lock')
		expect(drawer.isOpen).toBe(false)
		expect(drawer.openCount).toBe(0)
	})

	it('unlocks and allows electronic kick again', () => {
		drawer.setLock(true)
		drawer.setLock(false)
		expect(drawer.isLocked).toBe(false)

		const result = drawer.kick({ pin: 2 })
		expect(result.kicked).toBe(true)
		expect(drawer.isOpen).toBe(true)
	})

	it('auto-closes after specified duration', async () => {
		drawer.setAutoClose(50)
		drawer.kick({ pin: 2 })
		expect(drawer.isOpen).toBe(true)

		await new Promise((r) => setTimeout(r, 70))
		expect(drawer.isOpen).toBe(false)
	})

	it('notifies subscribers on open and close events', () => {
		const events: string[] = []
		drawer.subscribe((e) => events.push(e.action))

		drawer.kick({ pin: 2 })
		drawer.close()

		expect(events).toContain('open')
		expect(events).toContain('close')
	})
})
