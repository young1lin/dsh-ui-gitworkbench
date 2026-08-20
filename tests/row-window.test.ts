/**
 * The window that stops a long file freezing the pane.
 *
 * Two properties matter more than any single number here: the rendered rows
 * must cover what the reader can actually see, and the two spacers plus the
 * rendered rows must always add up to the file's full height — a scrollbar
 * that changes length as you scroll is worse than a slow pane.
 */
import { describe, expect, it } from 'vitest'

import {
  DIFF_ROW_H, WINDOW_OVERSCAN, WINDOW_WHOLE_BELOW, rowTop, rowWindow,
} from '../src/client/row-window.ts'

/** Total scrollable height the window implies, which must not move. */
function spanned(win: { start: number; end: number; padTop: number; padBottom: number }, rowH = DIFF_ROW_H): number {
  return win.padTop + (win.end - win.start) * rowH + win.padBottom
}

describe('a file short enough to have never been slow', () => {
  it('is rendered whole, with no spacers at all', () => {
    const win = rowWindow(0, 800, 120)
    expect(win).toEqual({ start: 0, end: 120, padTop: 0, padBottom: 0 })
  })

  it('stays whole however far it is scrolled', () => {
    // The pane below the threshold must produce exactly the DOM it produced
    // before windowing existed, at every scroll position.
    expect(rowWindow(4000, 800, WINDOW_WHOLE_BELOW).end).toBe(WINDOW_WHOLE_BELOW)
    expect(rowWindow(4000, 800, WINDOW_WHOLE_BELOW).padTop).toBe(0)
  })

  it('handles the empty file', () => {
    expect(rowWindow(0, 800, 0)).toEqual({ start: 0, end: 0, padTop: 0, padBottom: 0 })
  })
})

describe('a long file', () => {
  const ROWS = 4000

  it('renders a viewport plus overscan, not the file', () => {
    const win = rowWindow(0, 800, ROWS)
    expect(win.start).toBe(0)
    // 800px of viewport is 40 rows; the rest of the window is overscan.
    expect(win.end).toBe(40 + WINDOW_OVERSCAN)
    expect(win.end - win.start).toBeLessThan(ROWS / 10)
  })

  it('covers everything the reader can see', () => {
    const top = 10_000
    const view = 800
    const win = rowWindow(top, view, ROWS)
    // Every row with any part inside the viewport must be rendered.
    const firstVisible = Math.floor(top / DIFF_ROW_H)
    const lastVisible = Math.ceil((top + view) / DIFF_ROW_H)
    expect(win.start).toBeLessThanOrEqual(firstVisible)
    expect(win.end).toBeGreaterThanOrEqual(lastVisible)
  })

  it('keeps the scrollable height fixed at every position', () => {
    // THE property. If this drifts, the scrollbar changes length while the
    // reader drags it.
    const whole = ROWS * DIFF_ROW_H
    for (const top of [0, 500, 10_000, 40_000, 79_000, 80_000]) {
      expect(spanned(rowWindow(top, 800, ROWS)), `at scrollTop ${top}`).toBe(whole)
    }
  })

  it('keeps overscan above once there is room for it', () => {
    const win = rowWindow(10_000, 800, ROWS)
    expect(win.start).toBe(Math.floor(10_000 / DIFF_ROW_H) - WINDOW_OVERSCAN)
    expect(win.padTop).toBe(win.start * DIFF_ROW_H)
  })

  it('does not run off either end', () => {
    const atTop = rowWindow(0, 800, ROWS)
    expect(atTop.start).toBe(0)
    expect(atTop.padTop).toBe(0)
    const atEnd = rowWindow(ROWS * DIFF_ROW_H, 800, ROWS)
    expect(atEnd.end).toBe(ROWS)
    expect(atEnd.padBottom).toBe(0)
  })

  it('survives the numbers a scroller actually hands over', () => {
    // Rubber-band scrolling reports a negative offset; an unmeasured scroller
    // reports 0 height; a detached one reports NaN.
    expect(rowWindow(-40, 800, ROWS).start).toBe(0)
    expect(rowWindow(0, 0, ROWS).end).toBeGreaterThan(WINDOW_OVERSCAN)
    expect(spanned(rowWindow(Number.NaN, Number.NaN, ROWS))).toBe(ROWS * DIFF_ROW_H)
  })

  it('answers an empty window rather than an inverted one past the end', () => {
    // A file that shrank under a live poll leaves the scroller past its end.
    const win = rowWindow(999_999, 800, ROWS)
    expect(win.end).toBeGreaterThanOrEqual(win.start)
    expect(spanned(win)).toBe(ROWS * DIFF_ROW_H)
  })
})

describe('rowTop', () => {
  it('places a row by arithmetic, which is what the change walk needs', () => {
    expect(rowTop(0)).toBe(0)
    expect(rowTop(1)).toBe(DIFF_ROW_H)
    expect(rowTop(3999)).toBe(3999 * DIFF_ROW_H)
  })

  it('never answers below zero', () => {
    expect(rowTop(-5)).toBe(0)
  })
})
