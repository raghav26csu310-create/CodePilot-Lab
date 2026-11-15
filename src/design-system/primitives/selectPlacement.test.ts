import { describe, expect, it } from 'vitest'

import { placeMenu } from './selectPlacement'

const viewport = { width: 912, height: 766 }

function anchor(top: number, height = 38, left = 171, width = 168) {
  return { left, top, bottom: top + height, width }
}

describe('select menu placement', () => {
  it('opens below the trigger when there is room', () => {
    const menu = placeMenu(anchor(200), viewport)
    expect(menu.above).toBe(false)
    expect(menu.top).toBe(244)
    expect(menu.left).toBe(171)
    expect(menu.maxHeight).toBe(340)
    expect(menu.top + menu.maxHeight).toBeLessThanOrEqual(viewport.height)
  })

  it('flips above when the trigger is near the bottom', () => {
    const menu = placeMenu(anchor(720), viewport)
    expect(menu.above).toBe(true)
    expect(menu.top).toBeGreaterThanOrEqual(12)
    expect(menu.top + menu.maxHeight).toBeLessThanOrEqual(720)
  })

  it('never leaves the viewport on a short window', () => {
    const short = { width: 420, height: 400 }
    for (const top of [10, 120, 240, 330]) {
      const menu = placeMenu(anchor(top), short)
      expect(menu.top).toBeGreaterThanOrEqual(12)
      expect(menu.top + menu.maxHeight).toBeLessThanOrEqual(short.height - 12)
      expect(menu.maxHeight).toBeGreaterThanOrEqual(112)
    }
  })

  it('keeps the menu usable when the window is shorter than the minimum height', () => {
    const tiny = { width: 360, height: 200 }
    const menu = placeMenu(anchor(80), tiny)
    expect(menu.top).toBeGreaterThanOrEqual(12)
    expect(menu.top + menu.maxHeight).toBeLessThanOrEqual(tiny.height - 12)
  })

  it('clamps horizontally instead of overflowing a narrow viewport', () => {
    const menu = placeMenu(anchor(20, 38, 300, 260), { width: 320, height: 600 })
    expect(menu.width).toBeLessThanOrEqual(320 - 24)
    expect(menu.left).toBeGreaterThanOrEqual(12)
    expect(menu.left + menu.width).toBeLessThanOrEqual(320 - 12)
  })

  it('uses at least the minimum width when the trigger is narrow', () => {
    const menu = placeMenu(anchor(100, 30, 40, 120), viewport)
    expect(menu.width).toBe(220)
    expect(menu.left).toBe(40)
  })

  it('scrolls rather than shrinking below the minimum height', () => {
    const menu = placeMenu(anchor(300), { width: 900, height: 500 })
    expect(menu.maxHeight).toBeGreaterThanOrEqual(112)
    expect(menu.top + menu.maxHeight).toBeLessThanOrEqual(500)
  })
})
