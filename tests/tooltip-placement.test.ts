import { describe, expect, it } from 'vitest'
import { tooltipPlacement } from '../src/client/tooltip-placement.ts'

describe('non-interactive toolbar tooltip placement', () => {
  it('centers a short label below its action with a visible gap', () => {
    expect(tooltipPlacement({ left: 80, top: 20, width: 24, bottom: 44 }, { width: 100, height: 26 }, { width: 490, height: 600 }))
      .toEqual({ left: 42, top: 50 })
  })
  it('keeps a long label inside a narrow viewport at either edge', () => {
    for (const left of [0, 235]) {
      const tip = tooltipPlacement({ left, top: 20, width: 24, bottom: 44 }, { width: 240, height: 40 }, { width: 260, height: 600 })
      expect(tip.left).toBeGreaterThanOrEqual(8)
      expect(tip.left + 240).toBeLessThanOrEqual(252)
    }
  })
  it('moves above the action near the bottom of the viewport', () => {
    expect(tooltipPlacement({ left: 180, top: 570, width: 24, bottom: 594 }, { width: 160, height: 26 }, { width: 490, height: 600 }))
      .toEqual({ left: 112, top: 538 })
  })
})
