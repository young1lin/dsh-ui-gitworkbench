import { describe, expect, it } from 'vitest'

import { RowHeights, displayColumns, estimateRowHeight, variableRowWindow } from '../src/client/row-heights.ts'
import { WINDOW_WHOLE_BELOW } from '../src/client/row-window.ts'

/** A file of `n` rows, all one line tall. */
const flat = (n: number, h = 20): RowHeights => new RowHeights(Array.from({ length: n }, () => h))

describe('displayColumns', () => {
  it('counts a plain ASCII line as its length', () => {
    expect(displayColumns('const x = 1')).toBe(11)
  })

  it('advances a tab to the next stop rather than counting it as one', () => {
    // `\tab` is four columns of indent plus three letters, not four characters.
    expect(displayColumns('\tab', 4)).toBe(6)
    expect(displayColumns('ab\tc', 4)).toBe(5)
    expect(displayColumns('abcd\te', 4)).toBe(9)
  })

  it('counts full-width characters as two columns', () => {
    // The reason a naive length is badly wrong rather than slightly wrong: a
    // line of Chinese is twice as wide as its character count suggests.
    expect(displayColumns('已被忽略')).toBe(8)
    expect(displayColumns('a已b')).toBe(4)
  })

  it('is zero for an empty line', () => {
    expect(displayColumns('')).toBe(0)
  })
})

describe('estimateRowHeight', () => {
  it('gives one line to anything that fits', () => {
    expect(estimateRowHeight('short', 80, 20)).toBe(20)
    expect(estimateRowHeight('', 80, 20)).toBe(20)
  })

  it('grows with the number of times the line goes round', () => {
    expect(estimateRowHeight('x'.repeat(200), 80, 20)).toBe(60)
    expect(estimateRowHeight('x'.repeat(160), 80, 20)).toBe(40)
  })

  it('assumes one line while the pane has no measured width', () => {
    // The first paint happens before layout; guessing a huge height there
    // would give the file a scrollbar it then has to take back.
    expect(estimateRowHeight('x'.repeat(500), 0, 20)).toBe(20)
    expect(estimateRowHeight('x'.repeat(500), Number.NaN, 20)).toBe(20)
  })
})

describe('RowHeights', () => {
  it('places every row at the running total of the ones above', () => {
    const heights = new RowHeights([20, 40, 20, 60])
    expect(heights.topAt(0)).toBe(0)
    expect(heights.topAt(1)).toBe(20)
    expect(heights.topAt(2)).toBe(60)
    expect(heights.topAt(3)).toBe(80)
    expect(heights.total()).toBe(140)
  })

  it('finds the row at a pixel offset', () => {
    const heights = new RowHeights([20, 40, 20, 60])
    expect(heights.rowAt(0)).toBe(0)
    expect(heights.rowAt(19)).toBe(0)
    expect(heights.rowAt(20)).toBe(1)
    expect(heights.rowAt(59)).toBe(1)
    expect(heights.rowAt(60)).toBe(2)
    expect(heights.rowAt(139)).toBe(3)
    // Past the end clamps rather than running off: a file can shrink under a
    // live poll while the scroller is still where it was.
    expect(heights.rowAt(10_000)).toBe(3)
    expect(heights.rowAt(-5)).toBe(0)
  })

  it('moves every offset below a row when that row is measured', () => {
    const heights = new RowHeights([20, 20, 20])
    expect(heights.set(0, 100)).toBe(true)
    expect(heights.topAt(1)).toBe(100)
    expect(heights.topAt(2)).toBe(120)
    expect(heights.total()).toBe(140)
    expect(heights.rowAt(100)).toBe(1)
  })

  it('reports a measurement that changed nothing, so a caller can skip a render', () => {
    const heights = new RowHeights([20, 20])
    expect(heights.set(0, 20)).toBe(false)
    expect(heights.set(0, 40)).toBe(true)
    expect(heights.set(0, 40)).toBe(false)
  })

  it('says how much of it is real, so the measuring can be proven viewport-sized', () => {
    const heights = flat(5_000)
    expect(heights.measured()).toBe(0)
    for (let i = 100; i < 220; i += 1) heights.set(i, 40)
    expect(heights.measured()).toBe(120)
    // Measuring the same row again does not count it twice.
    heights.set(100, 60)
    expect(heights.measured()).toBe(120)
  })

  it('refuses an index or a height the DOM had no business producing', () => {
    const heights = new RowHeights([20, 20])
    expect(heights.set(-1, 40)).toBe(false)
    expect(heights.set(2, 40)).toBe(false)
    expect(heights.set(0.5, 40)).toBe(false)
    heights.set(0, Number.NaN)
    expect(heights.heightAt(0)).toBe(0)
  })

  it('answers on an empty file without walking off either end', () => {
    const heights = new RowHeights([])
    expect(heights.count).toBe(0)
    expect(heights.total()).toBe(0)
    expect(heights.rowAt(50)).toBe(0)
    expect(heights.topAt(0)).toBe(0)
  })

  it('agrees with a plain running total, over a mix of heights', () => {
    // The property the Fenwick tree exists to make fast, checked against the
    // slow version it replaces.
    const raw = Array.from({ length: 500 }, (_, i) => 20 + (i % 7) * 10)
    const heights = new RowHeights(raw)
    let running = 0
    for (let i = 0; i < raw.length; i += 1) {
      expect(heights.topAt(i)).toBe(running)
      running += raw[i]!
    }
    expect(heights.total()).toBe(running)
    for (let i = 0; i < raw.length; i += 17) {
      expect(heights.rowAt(heights.topAt(i))).toBe(i)
      expect(heights.rowAt(heights.topAt(i) + raw[i]! - 1)).toBe(i)
    }
  })
})

describe('variableRowWindow', () => {
  it('renders a short file whole, exactly as the fixed-height window does', () => {
    const heights = flat(WINDOW_WHOLE_BELOW)
    expect(variableRowWindow(0, 600, heights)).toEqual({
      start: 0, end: WINDOW_WHOLE_BELOW, padTop: 0, padBottom: 0,
    })
  })

  it('reserves the whole file height in the spacers, whatever it renders', () => {
    const heights = flat(5_000)
    const win = variableRowWindow(10_000, 600, heights)
    const rendered = heights.topAt(win.end) - heights.topAt(win.start)
    expect(win.padTop + rendered + win.padBottom).toBe(heights.total())
  })

  it('follows rows that grew, not a row count', () => {
    const heights = flat(5_000)
    // A block of tall wrapped rows near the top.
    for (let i = 0; i < 100; i += 1) heights.set(i, 100)
    const win = variableRowWindow(0, 400, heights)
    // 400px of viewport now holds four rows, not twenty.
    expect(win.start).toBe(0)
    expect(win.end).toBeLessThan(50)
    expect(win.padTop).toBe(0)
  })

  it('keeps overscan on both edges and never inverts', () => {
    const heights = flat(5_000)
    const win = variableRowWindow(20_000, 600, heights, 40)
    expect(win.start).toBe(heights.rowAt(20_000) - 40)
    expect(win.end).toBeGreaterThan(win.start)
    expect(win.padTop).toBe(heights.topAt(win.start))
  })

  it('scrolled past the end still answers with spacers that add up', () => {
    const heights = flat(2_000)
    const win = variableRowWindow(10_000_000, 600, heights)
    expect(win.end).toBeGreaterThanOrEqual(win.start)
    const rendered = heights.topAt(win.end) - heights.topAt(win.start)
    expect(win.padTop + rendered + win.padBottom).toBe(heights.total())
  })

  it('assumes a screenful before the scroller has been measured', () => {
    const heights = flat(5_000)
    const unmeasured = variableRowWindow(0, 0, heights)
    expect(unmeasured.end).toBeGreaterThan(60)
  })
})
