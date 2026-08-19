import { describe, expect, it } from 'vitest'

import { parseBlame } from '../src/blame.js'

const SHA_A = 'a'.repeat(40)
const SHA_B = 'b'.repeat(40)
const ZERO = '0'.repeat(40)

/** One porcelain entry, the way git repeats it for every line. */
function entry(sha: string, orig: number, final: number, fields: {
  author?: string
  time?: number
  summary?: string
  first?: boolean
}, content: string): string {
  const head = fields.first === true ? `${sha} ${orig} ${final} 1` : `${sha} ${orig} ${final}`
  const body = [
    `author ${fields.author ?? 'young1lin'}`,
    'author-mail <someone@example.invalid>',
    `author-time ${fields.time ?? 1780441400}`,
    'author-tz +0000',
    'committer young1lin',
    `summary ${fields.summary ?? 'a commit'}`,
    'filename f.ts',
    `\t${content}`,
  ]
  return [head, ...body].join('\n')
}

describe('parseBlame', () => {
  it('returns one record per line, in file order', () => {
    const text = [
      entry(SHA_A, 1, 1, { first: true, summary: 'first commit' }, 'const a = 1'),
      entry(SHA_B, 2, 2, { author: 'someone else', summary: 'second commit' }, 'const b = 2'),
    ].join('\n')
    const out = parseBlame(text)
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ hash: SHA_A, author: 'young1lin', summary: 'first commit', uncommitted: false })
    expect(out[1]).toMatchObject({ hash: SHA_B, author: 'someone else', summary: 'second commit' })
  })

  it('flags a line nobody has committed yet', () => {
    // git names it in English whatever the reader's language is, so the flag
    // travels separately and the drawer says it in its own words.
    const out = parseBlame(entry(ZERO, 3, 3, { author: 'Not Committed Yet' }, 'fresh line'))
    expect(out[2]).toMatchObject({ hash: ZERO, uncommitted: true })
  })

  it('reads the author time as a number', () => {
    const out = parseBlame(entry(SHA_A, 1, 1, { time: 1600000000 }, 'x'))
    expect(out[0]!.time).toBe(1600000000)
  })

  it('does not carry one line\'s fields over to the next', () => {
    // Each entry restates its own; a missing field must not inherit the
    // previous line's author, which would attribute code to the wrong person.
    const text = [
      entry(SHA_A, 1, 1, { author: 'first author' }, 'a'),
      [`${SHA_B} 2 2`, 'filename f.ts', '\tb'].join('\n'),
    ].join('\n')
    const out = parseBlame(text)
    expect(out[0]!.author).toBe('first author')
    expect(out[1]!.author).toBe('')
  })

  it('places a line by its FINAL line number, not its original one', () => {
    // A line moved by an earlier edit blames at where it is now.
    const out = parseBlame(entry(SHA_A, 12, 3, {}, 'moved line'))
    expect(out).toHaveLength(3)
    expect(out[2]!.hash).toBe(SHA_A)
  })

  it('fills a gap rather than shifting everything after it', () => {
    const out = parseBlame([
      entry(SHA_A, 1, 1, {}, 'a'),
      entry(SHA_B, 3, 3, {}, 'c'),
    ].join('\n'))
    expect(out).toHaveLength(3)
    expect(out[1]).toMatchObject({ hash: '', author: '' })
    expect(out[2]!.hash).toBe(SHA_B)
  })

  it('returns nothing for empty output', () => {
    expect(parseBlame('')).toEqual([])
  })

  it('keeps a tab inside the line content from closing the entry twice', () => {
    // The content line starts with a tab; a tab INSIDE it is just text, and
    // the entry has already been closed by then.
    const out = parseBlame(entry(SHA_A, 1, 1, {}, 'if (x) {\tdo()'))
    expect(out).toHaveLength(1)
    expect(out[0]!.hash).toBe(SHA_A)
  })

  it('survives a truncated stream by returning what it read', () => {
    const text = entry(SHA_A, 1, 1, {}, 'a') + '\n' + `${SHA_B} 2 2\nauthor cut off here`
    const out = parseBlame(text)
    expect(out).toHaveLength(1)
    expect(out[0]!.hash).toBe(SHA_A)
  })
})
