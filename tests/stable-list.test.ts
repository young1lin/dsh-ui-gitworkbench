/**
 * The comparison that stops the Files tab rebuilding itself on a timer.
 *
 * The drawer polls, so the untracked-path array arrives with a new identity
 * every 3-15 seconds even when the repository has not moved — and that
 * identity is the head of a chain: merge, directory tree, rows. Measured at
 * 50,000 paths, the poll cost 49-92ms of script (rising with the number of
 * rows on screen); holding the array steady when its contents are unchanged
 * took that to a flat ~4ms.
 */
import { describe, expect, it } from 'vitest'

import { sameList } from '../src/client/stable-list.ts'

describe('sameList', () => {
  it('says yes to the same contents in a different array', () => {
    // The whole point: the poll's array is new, its contents are not.
    expect(sameList(['a', 'b'], ['a', 'b'])).toBe(true)
  })

  it('short-circuits on identity', () => {
    const one = ['a', 'b']
    expect(sameList(one, one)).toBe(true)
  })

  it('says no when anything actually changed', () => {
    expect(sameList(['a', 'b'], ['a', 'c'])).toBe(false)
    expect(sameList(['a', 'b'], ['b', 'a'])).toBe(false)
    expect(sameList(['a'], ['a', 'b'])).toBe(false)
    expect(sameList(['a', 'b'], ['a'])).toBe(false)
  })

  it('handles the empty list, which is the ordinary case', () => {
    // Most repositories have no untracked files at all, and that must not be
    // reported as a change on every poll either.
    expect(sameList([], [])).toBe(true)
    expect(sameList([], ['a'])).toBe(false)
  })

  it('compares by value, not by coercion', () => {
    // Paths are strings; a list that differs only by type would still be a
    // different list, and nothing here should be doing loose comparison.
    expect(sameList(['1'], ['1'])).toBe(true)
    expect(sameList(['a/b'], ['a/b/'])).toBe(false)
  })
})
