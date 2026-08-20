/**
 * The History tab's two arrangements, and the one number they disagree on.
 *
 * The tab was three columns, then stacked, and now it is whichever the reader
 * picked — so the choice is stored, and a stored choice is a durable boundary:
 * it was written by whatever build ran last. These tests are mostly about what
 * happens when the value on disk is not one this build knows.
 */
import { describe, expect, it } from 'vitest'

import {
  COMMIT_ROW_H, DEFAULT_HISTORY_LAYOUT, HISTORY_LAYOUTS, isHistoryLayout,
} from '../src/client/history-layout.ts'

describe('the default layout', () => {
  it('is the three-column one', () => {
    // Asked for outright: whoever has not touched the switch gets columns.
    expect(DEFAULT_HISTORY_LAYOUT).toBe('columns')
  })

  it('is a layout the switch actually offers', () => {
    expect(HISTORY_LAYOUTS).toContain(DEFAULT_HISTORY_LAYOUT)
  })
})

describe('isHistoryLayout', () => {
  it('accepts every layout this build has', () => {
    for (const layout of HISTORY_LAYOUTS) expect(isHistoryLayout(layout)).toBe(true)
  })

  it('rejects a name no build ever wrote', () => {
    expect(isHistoryLayout('rows')).toBe(false)
    expect(isHistoryLayout('COLUMNS')).toBe(false)
    expect(isHistoryLayout('')).toBe(false)
  })

  it('rejects the shapes storage can hand back', () => {
    // A half-written value parses to anything; the reader falls back rather
    // than putting a non-string where a data attribute goes.
    expect(isHistoryLayout(null)).toBe(false)
    expect(isHistoryLayout(undefined)).toBe(false)
    expect(isHistoryLayout(0)).toBe(false)
    expect(isHistoryLayout(true)).toBe(false)
    expect(isHistoryLayout({ layout: 'columns' })).toBe(false)
    expect(isHistoryLayout(['columns'])).toBe(false)
  })
})

describe('the commit row height', () => {
  it('has an entry for every layout', () => {
    // A layout added without a height would publish `undefined` as a CSS
    // custom property, which invalidates the declaration and silently drops
    // the row's height altogether.
    expect(Object.keys(COMMIT_ROW_H).sort()).toEqual([...HISTORY_LAYOUTS].sort())
  })

  it('gives the column layout the taller row', () => {
    // The column has no width for the author and the date beside the subject,
    // so they take a line of their own and the row must fit two.
    expect(COMMIT_ROW_H.columns).toBeGreaterThan(COMMIT_ROW_H.stacked)
  })

  it('states both as usable pixel counts', () => {
    for (const height of Object.values(COMMIT_ROW_H)) {
      expect(Number.isInteger(height)).toBe(true)
      expect(height).toBeGreaterThan(0)
    }
  })
})
