/**
 * The find panel's match count.
 *
 * Two properties matter and neither is visible in review. The index must be
 * BOUNDED — an uncapped one is a walk over the whole document and an array of
 * every hit in it, on a pane that will happily load 20,000 lines. And the
 * ordinal must come out of the kept offsets rather than a second walk, or
 * every Enter pays the count again.
 *
 * The real cursor is exercised at the bottom against a real document, because
 * a rule that only ever sees hand-written offsets has never met the object it
 * was written for.
 */
import { Text } from '@codemirror/state'
import { SearchQuery } from '@codemirror/search'
import { describe, expect, it } from 'vitest'
import { EMPTY_INDEX, MATCH_CAP, formatCount, indexMatches, ordinalAt } from '../src/client/search-count.ts'

/** `n` matches, one every ten characters. */
function spread(n: number): Array<{ from: number }> {
  return Array.from({ length: n }, (_, i) => ({ from: i * 10 }))
}

describe('the index is bounded, and says when it stopped', () => {
  it('keeps every match while there are few', () => {
    const index = indexMatches(spread(12))
    expect(index.offsets).toHaveLength(12)
    expect(index.capped).toBe(false)
  })

  it('stops at the cap rather than walking the rest of the document', () => {
    const index = indexMatches(spread(MATCH_CAP + 250))
    expect(index.offsets).toHaveLength(MATCH_CAP)
    expect(index.capped).toBe(true)
  })

  it('stops CONSUMING at the cap, not just storing', () => {
    // The point of the cap is the walk, not the array: a generator that is
    // still being pulled is still costing the document.
    let pulled = 0
    function* endless(): Generator<{ from: number }> {
      for (let at = 0; ; at += 4) {
        pulled++
        yield { from: at }
      }
    }
    const index = indexMatches(endless(), 40)
    expect(index.offsets).toHaveLength(40)
    expect(pulled, 'the walk should stop within one step of the cap')
      .toBeLessThanOrEqual(41)
  })

  it('reports an exact total when it did not stop, and an open one when it did', () => {
    expect(formatCount(indexMatches(spread(128)), 3)).toBe('3/128')
    expect(formatCount(indexMatches(spread(MATCH_CAP + 1)), 3)).toBe(`3/${MATCH_CAP}+`)
    expect(formatCount(EMPTY_INDEX, 0)).toBe('0/0')
  })
})

describe('the ordinal comes out of the offsets, not a second walk', () => {
  const index = indexMatches(spread(5))  // 0, 10, 20, 30, 40

  it('reads the match the caret sits exactly on', () => {
    expect(ordinalAt(index, 0)).toBe(1)
    expect(ordinalAt(index, 20)).toBe(3)
    expect(ordinalAt(index, 40)).toBe(5)
  })

  it('reads the match the panel is about to land on', () => {
    // Straight after typing the caret has not moved, and the count must
    // already say `1/5` rather than `0/5`.
    expect(ordinalAt(index, 1)).toBe(2)
    expect(ordinalAt(index, 25)).toBe(4)
  })

  it('wraps past the last match, because the panel wraps', () => {
    expect(ordinalAt(index, 41)).toBe(1)
    expect(ordinalAt(index, 10_000)).toBe(1)
  })

  it('has nothing to report when nothing matched', () => {
    expect(ordinalAt(EMPTY_INDEX, 0)).toBe(0)
    expect(formatCount(EMPTY_INDEX, ordinalAt(EMPTY_INDEX, 0))).toBe('0/0')
  })

  it('finds every position by halving, not by scanning', () => {
    // A linear fallback passes every case above and costs the navigation path
    // the whole array on each Enter — so the question asked here is how many
    // slots it touched, which is the only thing that tells the two apart.
    const big = indexMatches(spread(4096))
    let reads = 0
    const watched = new Proxy(big.offsets as number[], {
      get(target, key, receiver) {
        if (typeof key === 'string' && /^\d+$/.test(key)) reads++
        return Reflect.get(target, key, receiver) as unknown
      },
    })
    expect(ordinalAt({ offsets: watched, capped: false }, 40_950)).toBe(4096)
    // Twelve halvings cover 4,096; a scan would touch thousands of slots.
    expect(reads, 'slots read for one lookup').toBeLessThanOrEqual(20)
  })
})

/** Structural alias so the getter above satisfies the parameter type. */
interface MatchIndex_ {
  readonly offsets: readonly number[]
  readonly capped: boolean
}

describe('it counts what CodeMirror actually finds', () => {
  const doc = Text.of(['const a = 1', 'const b = 2', 'let c = 3', 'const d = 4'])

  const indexOf = (spec: ConstructorParameters<typeof SearchQuery>[0]): MatchIndex_ =>
    indexMatches(new SearchQuery(spec).getCursor(doc))

  it('walks a literal search', () => {
    const index = indexOf({ search: 'const' })
    expect(index.offsets).toHaveLength(3)
    expect(formatCount(index, ordinalAt(index, 0))).toBe('1/3')
  })

  it('walks a regexp search', () => {
    const index = indexOf({ search: '\\b[a-d] =', regexp: true })
    expect(index.offsets).toHaveLength(4)
  })

  it('follows the case option rather than guessing', () => {
    expect(indexOf({ search: 'CONST' }).offsets).toHaveLength(3)
    expect(indexOf({ search: 'CONST', caseSensitive: true }).offsets).toHaveLength(0)
  })

  it('survives the cursor reusing one object for every match', () => {
    // `SearchCursor` mutates and re-yields a single `value`, so anything that
    // kept the object rather than the number would report the last match N
    // times over.
    const index = indexOf({ search: 'const' })
    expect([...index.offsets]).toEqual([...index.offsets].sort((a, b) => a - b))
    expect(new Set(index.offsets).size).toBe(index.offsets.length)
  })
})
