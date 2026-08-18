import { describe, expect, it } from 'vitest'
import { formatCommitDate } from '../src/client/commit-filter.ts'

describe('formatCommitDate', () => {
  it('renders the exact moment in the given locale and timezone', () => {
    // Fixed locale and timezone keep the assertion deterministic; production
    // calls it with no options and gets the viewer's own.
    const text = formatCommitDate('2026-08-04T09:30:12Z', { locale: 'en-US', timeZone: 'UTC' })
    expect(text).toMatch(/^Aug 4, 2026, \d{1,2}:30\s?[AP]M$/)
  })

  it('converts to the timezone it is handed — the same instant, another clock', () => {
    const utc = formatCommitDate('2026-08-04T09:30:12Z', { locale: 'en-US', timeZone: 'UTC' })
    const shanghai = formatCommitDate('2026-08-04T09:30:12Z', { locale: 'en-US', timeZone: 'Asia/Shanghai' })
    expect(utc).not.toBe(shanghai)
    expect(shanghai).toMatch(/5:30\s?PM/)
  })

  it('returns an empty string for an absent or unparsable date', () => {
    expect(formatCommitDate('')).toBe('')
    expect(formatCommitDate('not a date')).toBe('')
  })
})
