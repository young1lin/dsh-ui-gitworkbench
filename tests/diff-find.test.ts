import { describe, expect, it } from 'vitest'

import { currentColIn, findInSides, findInTexts, formatHits, nearestHit, overlayHits, rowHitRanges, stepHit } from '../src/client/diff-find.ts'
import { MATCH_CAP } from '../src/client/search-count.ts'

describe('findInTexts', () => {
  it('finds every literal, case-insensitive, non-overlapping match with its row and column', () => {
    const texts = ['const test = 1', 'no hits here', '  Test(); TEST', 'tttest']
    expect(findInTexts(texts, 'test')).toEqual({
      hits: [
        { row: 0, col: 6 },
        { row: 2, col: 2 },
        { row: 2, col: 10 },
        { row: 3, col: 2 },
      ],
      capped: false,
    })
  })

  it('is literal: regex metacharacters match themselves', () => {
    expect(findInTexts(['a.b', 'axb', 'f(x)'], '.')).toEqual({ hits: [{ row: 0, col: 1 }], capped: false })
    expect(findInTexts(['a.b', 'axb', 'f(x)'], '(x)')).toEqual({ hits: [{ row: 2, col: 1 }], capped: false })
  })

  it('does not overlap: "aa" in "aaaa" is two hits, not three', () => {
    expect(findInTexts(['aaaa'], 'aa').hits).toEqual([{ row: 0, col: 0 }, { row: 0, col: 2 }])
  })

  it('an empty query finds nothing rather than everything', () => {
    expect(findInTexts(['abc'], '')).toEqual({ hits: [], capped: false })
    expect(findInTexts(['abc'], '   ')).toEqual({ hits: [], capped: false })
  })

  it('stops at the cap and says so — the work is bounded, the feature is not', () => {
    const texts = Array.from({ length: 3000 }, () => 'x x x')
    const found = findInTexts(texts, 'x')
    expect(found.hits.length).toBe(MATCH_CAP)
    expect(found.capped).toBe(true)
    // Exactly at the cap is not "more".
    const exact = findInTexts(Array.from({ length: MATCH_CAP }, () => 'x'), 'x')
    expect(exact.hits.length).toBe(MATCH_CAP)
    expect(exact.capped).toBe(false)
  })

  it('honours a smaller cap', () => {
    expect(findInTexts(['a a a a'], 'a', 2)).toEqual({ hits: [{ row: 0, col: 0 }, { row: 0, col: 2 }], capped: true })
  })
})

describe('findInSides', () => {
  it('walks each row left cell then right cell, in reading order', () => {
    const left = ['const a = test', 'same', null, 'test test']
    const right = ['const a = TEST', 'same', 'test', null]
    expect(findInSides(left, right, 'test')).toEqual({
      hits: [
        { row: 0, side: 'left', col: 10 },
        { row: 0, side: 'right', col: 10 },
        { row: 2, side: 'right', col: 0 },
        { row: 3, side: 'left', col: 0 },
        { row: 3, side: 'left', col: 5 },
      ],
      capped: false,
    })
  })

  it('skips the empty side of a one-sided row rather than matching in it', () => {
    // A deleted line has no right cell; a blank query on '' would be a
    // zero-width match and the walk would never advance.
    expect(findInSides(['x'], [null], 'x')).toEqual({ hits: [{ row: 0, side: 'left', col: 0 }], capped: false })
    expect(findInSides([null], ['x'], 'x')).toEqual({ hits: [{ row: 0, side: 'right', col: 0 }], capped: false })
  })

  it('an empty query finds nothing', () => {
    expect(findInSides(['abc'], ['abc'], ' ')).toEqual({ hits: [], capped: false })
  })

  it('stops at the cap across both sides and says so', () => {
    const left = Array.from({ length: 3000 }, () => 'x x')
    const right = Array.from({ length: 3000 }, () => 'x')
    const found = findInSides(left, right, 'x')
    expect(found.hits.length).toBe(MATCH_CAP)
    expect(found.capped).toBe(true)
    expect(findInSides(['x x'], ['x'], 'x', 3)).toEqual({
      hits: [{ row: 0, side: 'left', col: 0 }, { row: 0, side: 'left', col: 2 }, { row: 0, side: 'right', col: 0 }],
      capped: false,
    })
    expect(findInSides(['x x'], ['x'], 'x', 2).capped).toBe(true)
  })

  it('keeps hits ordered by row, so nearestHit still binary-searches them', () => {
    const found = findInSides(['a', null, 'a'], ['a', 'a', null], 'a')
    expect(found.hits.map(hit => hit.row)).toEqual([0, 0, 1, 2])
    expect(nearestHit(found.hits, 1)).toBe(2)
    expect(found.hits[nearestHit(found.hits, 1)]).toEqual({ row: 1, side: 'right', col: 0 })
  })
})

describe('currentColIn', () => {
  it('is the hit’s column only for the cell the hit is in', () => {
    const hit = { row: 4, side: 'right', col: 7 } as const
    expect(currentColIn(hit, 4, 'right')).toBe(7)
    expect(currentColIn(hit, 4, 'left')).toBeNull()
    expect(currentColIn(hit, 5, 'right')).toBeNull()
    expect(currentColIn(null, 4, 'right')).toBeNull()
  })

  it('a unified hit has no side, and belongs to whichever cell asks', () => {
    expect(currentColIn({ row: 1, col: 2 }, 1, 'left')).toBe(2)
    expect(currentColIn({ row: 1, col: 2 }, 1, 'right')).toBe(2)
  })
})

describe('rowHitRanges', () => {
  it('gives the character ranges of one row’s matches, for painting', () => {
    expect(rowHitRanges('Test and test', 'test')).toEqual([[0, 4], [9, 13]])
    expect(rowHitRanges('nothing', 'test')).toEqual([])
    expect(rowHitRanges('anything', '')).toEqual([])
  })
})

describe('overlayHits', () => {
  const painted = [
    { text: 'const ', color: '#a', mark: false },
    { text: 'test', color: '#b', mark: true },
    { text: ' = 1', mark: false },
  ]

  it('leaves tokens untouched when there are no ranges', () => {
    expect(overlayHits(painted, [], null)).toEqual(painted.map(tok => ({ ...tok, hit: 0 })))
  })

  it('splits tokens at hit boundaries and keeps their colour and word mark', () => {
    // "st = " spans two tokens: the tail of the marked word and the head of
    // the plain one. Both halves keep what they had and gain the hit.
    expect(overlayHits(painted, [[8, 13]], null)).toEqual([
      { text: 'const ', color: '#a', mark: false, hit: 0 },
      { text: 'te', color: '#b', mark: true, hit: 0 },
      { text: 'st', color: '#b', mark: true, hit: 1 },
      { text: ' = ', mark: false, hit: 1 },
      { text: '1', mark: false, hit: 0 },
    ])
  })

  it('marks the current hit apart from the others', () => {
    expect(overlayHits([{ text: 'a b a', mark: false }], [[0, 1], [4, 5]], 4)).toEqual([
      { text: 'a', mark: false, hit: 1 },
      { text: ' b ', mark: false, hit: 0 },
      { text: 'a', mark: false, hit: 2 },
    ])
  })
})

describe('stepHit', () => {
  it('walks forward and back, wrapping at both ends', () => {
    expect(stepHit(3, 0, 1)).toBe(1)
    expect(stepHit(3, 2, 1)).toBe(0)
    expect(stepHit(3, 0, -1)).toBe(2)
  })

  it('from nowhere, forward lands on the first and back on the last', () => {
    expect(stepHit(3, -1, 1)).toBe(0)
    expect(stepHit(3, -1, -1)).toBe(2)
  })

  it('with no hits there is nowhere to go', () => {
    expect(stepHit(0, -1, 1)).toBe(-1)
    expect(stepHit(0, 0, 1)).toBe(-1)
  })
})

describe('nearestHit', () => {
  const hits = [{ row: 2, col: 0 }, { row: 5, col: 0 }, { row: 5, col: 3 }, { row: 9, col: 0 }]

  it('is the first hit at or below the row the reader is looking at', () => {
    expect(nearestHit(hits, 0)).toBe(0)
    expect(nearestHit(hits, 5)).toBe(1)
    expect(nearestHit(hits, 6)).toBe(3)
  })

  it('wraps to the first when every hit is above', () => {
    expect(nearestHit(hits, 10)).toBe(0)
  })

  it('is -1 with no hits', () => {
    expect(nearestHit([], 0)).toBe(-1)
  })
})

describe('formatHits', () => {
  it('reads like the editor panel’s count', () => {
    expect(formatHits({ hits: [], capped: false }, -1)).toBe('0/0')
    expect(formatHits({ hits: [{ row: 0, col: 0 }, { row: 1, col: 0 }], capped: false }, 1)).toBe('2/2')
    expect(formatHits({ hits: [{ row: 0, col: 0 }], capped: true }, -1)).toBe('0/1+')
  })
})
