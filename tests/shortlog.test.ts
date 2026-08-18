import { describe, expect, it } from 'vitest'
import { parseShortlog } from '../src/shortlog.ts'

describe('parseShortlog', () => {
  it('reads count, name and email however git pads the columns', () => {
    const out = parseShortlog('   12  Liam Wright <liam@example.com>\n345  young1lin <y@example.com>\n', 500)
    expect(out).toEqual({
      authors: [
        { name: 'young1lin', email: 'y@example.com', count: 345 },
        { name: 'Liam Wright', email: 'liam@example.com', count: 12 },
      ],
      truncated: false,
    })
  })

  it('keeps the busiest CAP and reports the truncation instead of hiding it', () => {
    const lines = Array.from({ length: 8 }, (_, i) => `${i + 1}  person${i} <p${i}@x.com>`)
    const out = parseShortlog(lines.join('\n'), 5)
    expect(out.authors).toHaveLength(5)
    // Busiest first, so what survives the cap is the most useful part.
    expect(out.authors[0]!.name).toBe('person7')
    expect(out.truncated).toBe(true)
  })

  it('skips blank and unparsable lines rather than failing the whole list', () => {
    const out = parseShortlog('\n12  ok <ok@x.com>\nnot a shortlog line\n', 500)
    expect(out.authors).toEqual([{ name: 'ok', email: 'ok@x.com', count: 12 }])
  })

  it('returns an empty list for empty input — an empty repo has no authors', () => {
    expect(parseShortlog('', 500)).toEqual({ authors: [], truncated: false })
  })
})
