import { describe, expect, it } from 'vitest'

import { blameDate, blameLabel, blameTitle, shortHash } from '../src/client/blame-view.ts'
import type { BlameLine } from '../src/client/GitWorkbenchPanel.tsx'

const line = (over: Partial<BlameLine> = {}): BlameLine => ({
  hash: 'a'.repeat(40),
  author: 'young1lin',
  time: 1780441400,
  summary: 'feat: task queue skeleton',
  uncommitted: false,
  ...over,
})

describe('shortHash', () => {
  it('abbreviates to seven, the way git does', () => {
    expect(shortHash('abcdef1234567890')).toBe('abcdef1')
  })

  it('answers empty for the not-committed-yet sha and for junk', () => {
    // All zeros IS a valid hex sha, so it abbreviates — the caller decides
    // that case from the flag, not from the string.
    expect(shortHash('')).toBe('')
    expect(shortHash('not a sha')).toBe('')
  })
})

describe('blameDate', () => {
  it('renders YYYY-MM-DD', () => {
    expect(blameDate(1780441400)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('agrees with the reader\'s own clock', () => {
    // Formatted from a local Date's parts, so it must match one built the same
    // way — not a UTC slice, which is a day off for half the world.
    const at = new Date(1780441400 * 1000)
    const pad = (v: number): string => String(v).padStart(2, '0')
    expect(blameDate(1780441400)).toBe(`${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`)
  })

  it('pads single-digit months and days', () => {
    expect(blameDate(Math.floor(new Date(2021, 0, 5, 12).getTime() / 1000))).toBe('2021-01-05')
  })

  it('answers empty when git gave no time', () => {
    expect(blameDate(0)).toBe('')
    expect(blameDate(Number.NaN)).toBe('')
  })
})

describe('blameLabel', () => {
  it('shows a short sha and a date', () => {
    expect(blameLabel(line(), 'not committed')).toMatch(/^aaaaaaa \d{4}-\d{2}-\d{2}$/)
  })

  it('says the drawer\'s own words for an uncommitted line', () => {
    // git names it in English whatever the reader's language is.
    expect(blameLabel(line({ uncommitted: true, hash: '0'.repeat(40) }), '尚未提交')).toBe('尚未提交')
  })

  it('answers empty for a line the blame did not cover', () => {
    // A truncated file, or a line added since the fetch — an empty cell keeps
    // the gutter's rows aligned with the code's.
    expect(blameLabel(undefined, 'not committed')).toBe('')
  })

  it('drops the half it does not have', () => {
    expect(blameLabel(line({ time: 0 }), 'x')).toBe('aaaaaaa')
    expect(blameLabel(line({ hash: '' }), 'x')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('blameTitle', () => {
  it('carries the author, the date and the subject', () => {
    const title = blameTitle(line(), 'x')
    expect(title).toContain('young1lin')
    expect(title).toContain('feat: task queue skeleton')
  })

  it('omits parts git did not give rather than leaving separators', () => {
    expect(blameTitle(line({ summary: '', time: 0 }), 'x')).toBe('young1lin')
  })

  it('says the uncommitted wording and nothing else', () => {
    expect(blameTitle(line({ uncommitted: true }), '尚未提交')).toBe('尚未提交')
  })
})
