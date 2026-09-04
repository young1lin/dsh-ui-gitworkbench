import { describe, expect, it } from 'vitest'

import { NO_RAIL, railNeeded, railsShown, sameMetric } from '../src/client/h-rail.ts'

describe('railNeeded', () => {
  it('shows a rail for a column whose content is wider than it is', () => {
    expect(railNeeded({ view: 600, content: 1800 })).toBe(true)
  })

  it('shows none for a column that fits', () => {
    expect(railNeeded({ view: 600, content: 600 })).toBe(false)
    expect(railNeeded({ view: 600, content: 420 })).toBe(false)
  })

  it('ignores a sub-pixel overflow, which every grid track has', () => {
    // A column that exactly fits still reports a fraction more scroll width
    // than client width. Without the slack every file grows a rail that
    // scrolls nowhere.
    expect(railNeeded({ view: 600, content: 600.34 })).toBe(false)
    expect(railNeeded({ view: 600, content: 601 })).toBe(false)
    expect(railNeeded({ view: 600, content: 601.5 })).toBe(true)
  })

  it('shows none before anything is measured, or for an unmounted column', () => {
    expect(railNeeded(NO_RAIL)).toBe(false)
    expect(railNeeded({ view: 0, content: 4000 })).toBe(false)
  })

  it('shows none for a measurement that is not a number', () => {
    expect(railNeeded({ view: Number.NaN, content: 4000 })).toBe(false)
    expect(railNeeded({ view: 600, content: Number.POSITIVE_INFINITY })).toBe(false)
  })
})

describe('railsShown', () => {
  it('shows the strip when either side overflows', () => {
    expect(railsShown({ view: 600, content: 1800 }, NO_RAIL)).toBe(true)
    expect(railsShown(NO_RAIL, { view: 600, content: 1800 })).toBe(true)
  })

  it('shows nothing when neither does — soft wrap, or a file of short lines', () => {
    expect(railsShown({ view: 600, content: 600 }, { view: 600, content: 590 })).toBe(false)
    expect(railsShown(NO_RAIL, NO_RAIL)).toBe(false)
  })
})

describe('sameMetric', () => {
  it('is what stops the measuring effect from re-rendering forever', () => {
    expect(sameMetric({ view: 600, content: 1800 }, { view: 600, content: 1800 })).toBe(true)
    expect(sameMetric({ view: 600, content: 1800 }, { view: 601, content: 1800 })).toBe(false)
    expect(sameMetric({ view: 600, content: 1800 }, { view: 600, content: 1801 })).toBe(false)
  })
})
