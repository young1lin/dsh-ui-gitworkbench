import { describe, expect, it } from 'vitest'
import { inCalRange, monthGrid, weekdayLabels, type CalendarCell } from '../src/client/calendar.ts'

describe('monthGrid', () => {
  it('lays out August 2026 Monday-first, previous-month days in the lead-in', () => {
    // 2026-08-01 is a Saturday → the week starts Monday with July 27..31.
    const grid = monthGrid(2026, 7, '2026-08-18')
    expect(grid).toHaveLength(6)
    expect(grid[0]).toHaveLength(7)
    const firstRow = grid[0]!
    expect(firstRow[0]).toMatchObject({ iso: '2026-07-27', day: 27, inMonth: false })
    expect(firstRow[4]).toMatchObject({ iso: '2026-07-31', day: 31, inMonth: false })
    expect(firstRow[5]).toMatchObject({ iso: '2026-08-01', day: 1, inMonth: true })
    expect(firstRow[6]).toMatchObject({ iso: '2026-08-02', day: 2, inMonth: true })
  })

  it('trailing cells carry the next month\'s days, marked out-of-month', () => {
    const grid = monthGrid(2026, 7, '2026-08-18')
    const flat = grid.flat()
    // August 2026 has 31 days; the last row begins Aug 31 (Monday).
    const last = grid[5]!
    expect(last[0]).toMatchObject({ iso: '2026-08-31', day: 31, inMonth: true })
    expect(last[1]).toMatchObject({ iso: '2026-09-01', day: 1, inMonth: false })
    expect(last[6]).toMatchObject({ iso: '2026-09-06', day: 6, inMonth: false })
    expect(flat.filter(c => c !== null && c.inMonth)).toHaveLength(31)
  })

  it('marks the single today cell', () => {
    const grid = monthGrid(2026, 7, '2026-08-18')
    const todays = grid.flat().filter(c => c !== null && c.isToday)
    expect(todays).toHaveLength(1)
    expect(todays[0]!.iso).toBe('2026-08-18')
  })

  it(' February without a leap: 28 days, no fifth row needed but grid stays 6 for height stability', () => {
    const grid = monthGrid(2027, 1, '2027-02-15')
    expect(grid.flat().filter(c => c !== null && c.inMonth)).toHaveLength(28)
    expect(grid).toHaveLength(6)
  })

  it('weekdayLabels are Monday-first', () => {
    expect(weekdayLabels('en-US')).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S'])
  })
})

describe('inCalRange', () => {
  it('tints the days strictly between two iso bounds', () => {
    expect(inCalRange('2026-08-10', '2026-08-01', '2026-08-31')).toBe(true)
    expect(inCalRange('2026-08-02', '2026-08-01', '2026-08-31')).toBe(true)
  })

  it('leaves the endpoints to the endpoint mark', () => {
    expect(inCalRange('2026-08-01', '2026-08-01', '2026-08-31')).toBe(false)
    expect(inCalRange('2026-08-31', '2026-08-01', '2026-08-31')).toBe(false)
  })

  it('excludes days outside the pair, month and year boundaries included', () => {
    expect(inCalRange('2026-07-31', '2026-08-01', '2026-08-31')).toBe(false)
    expect(inCalRange('2026-09-01', '2026-08-01', '2026-08-31')).toBe(false)
    expect(inCalRange('2025-12-31', '2026-01-01', '2026-01-31')).toBe(false)
    expect(inCalRange('2026-01-15', '2025-12-25', '2026-02-05')).toBe(true)
  })

  it('needs BOTH bounds — one alone is not a range', () => {
    expect(inCalRange('2026-08-10', '2026-08-01', '')).toBe(false)
    expect(inCalRange('2026-08-10', '', '2026-08-31')).toBe(false)
    expect(inCalRange('2026-08-10', '', '')).toBe(false)
  })

  it('ignores approxidate bounds, which name no grid day', () => {
    // A preset writes `after: 1 week ago`; the grid marks nothing for it, and
    // must not lexically compare "2026-08-10" against "1 week ago" either.
    expect(inCalRange('2026-08-10', '1 week ago', '2026-08-31')).toBe(false)
    expect(inCalRange('2026-08-10', '2026-08-01', 'yesterday')).toBe(false)
  })

  it('an inverted pair admits nothing, the same as the log it produces', () => {
    expect(inCalRange('2026-08-10', '2026-08-31', '2026-08-01')).toBe(false)
  })
})
