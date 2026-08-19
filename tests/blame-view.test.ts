import { describe, expect, it } from 'vitest'

import { blameDate, blameLabel, blameRunStart, blameTitle, blameWhen, shortHash } from '../src/client/blame-view.ts'
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
  it('shows who last changed the line, not which commit did', () => {
    // A hash is an identifier, not an answer: reading down a file the question
    // is who wrote this, and a column of hex says nothing until you look each
    // entry up. The commit is what a click reveals.
    expect(blameLabel(line(), 'not committed')).toBe('young1lin')
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

  it('answers empty when git named no author', () => {
    expect(blameLabel(line({ author: '' }), 'x')).toBe('')
  })

  it('is unaffected by a missing time or hash — the name is the whole label', () => {
    expect(blameLabel(line({ time: 0, hash: '' }), 'x')).toBe('young1lin')
  })
})

describe('blameWhen', () => {
  it('carries the clock time as well as the day', () => {
    // Two commits on one afternoon are a common thing to be telling apart.
    expect(blameWhen(1780441400)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  })

  it('agrees with the date the gutter would have shown', () => {
    expect(blameWhen(1780441400).startsWith(blameDate(1780441400))).toBe(true)
  })

  it('pads a single-digit hour and minute', () => {
    const at = new Date(2021, 0, 5, 9, 7)
    expect(blameWhen(Math.floor(at.getTime() / 1000))).toBe('2021-01-05 09:07')
  })

  it('answers empty when git gave no time', () => {
    expect(blameWhen(0)).toBe('')
    expect(blameWhen(Number.NaN)).toBe('')
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

describe('blameRunStart', () => {
  const run = (...hashes: string[]): BlameLine[] =>
    hashes.map(hash => line({ hash: hash.repeat(40) }))

  it('marks the first line of the file', () => {
    expect(blameRunStart(run('a', 'a'), 1)).toBe(true)
  })

  it('leaves the rest of a commit run unmarked', () => {
    // Forty repeats of one name is forty copies of one fact, and it buries
    // the boundaries — which are the only thing the column really reports.
    const lines = run('a', 'a', 'a')
    expect(blameRunStart(lines, 2)).toBe(false)
    expect(blameRunStart(lines, 3)).toBe(false)
  })

  it('marks the line where the commit changes', () => {
    expect(blameRunStart(run('a', 'b'), 2)).toBe(true)
  })

  it('keys on the commit, not the author', () => {
    // Two commits by one person are two runs: the gutter shows a name, but
    // what it is dividing is history.
    const lines = [
      line({ hash: 'a'.repeat(40), author: 'young1lin' }),
      line({ hash: 'b'.repeat(40), author: 'young1lin' }),
    ]
    expect(blameRunStart(lines, 2)).toBe(true)
  })

  it('marks the line after a gap the blame did not cover', () => {
    const lines = [line(), line({ hash: '', author: '' }), line()]
    expect(blameRunStart(lines, 3)).toBe(true)
  })

  it('answers false for a line past the end', () => {
    expect(blameRunStart(run('a'), 5)).toBe(false)
    expect(blameRunStart([], 1)).toBe(false)
  })
})
