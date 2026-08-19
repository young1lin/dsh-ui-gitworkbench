import { describe, expect, it } from 'vitest'

import { bufferDiff } from '../src/client/cm-diff.ts'

/** Build a document from lines, the way an editor holds one. */
const doc = (...lines: string[]): string => lines.join('\n')

describe('bufferDiff', () => {
  it('reports nothing when the two sides are identical', () => {
    const text = doc('one', 'two', 'three')
    expect(bufferDiff(text, text)).toEqual({ changed: [], deletedBefore: [] })
  })

  it('marks a rewritten line and nothing around it', () => {
    const out = bufferDiff(doc('one', 'two', 'three'), doc('one', 'TWO', 'three'))
    expect(out.changed).toEqual([2])
    expect(out.deletedBefore).toEqual([])
  })

  it('marks an inserted line', () => {
    const out = bufferDiff(doc('one', 'three'), doc('one', 'two', 'three'))
    expect(out.changed).toContain(2)
    expect(out.changed).not.toContain(1)
  })

  it('marks several inserted lines as a run', () => {
    const out = bufferDiff(doc('a', 'd'), doc('a', 'b', 'c', 'd'))
    expect(out.changed).toEqual([2, 3])
  })

  it('marks a deletion at the line that closed over the gap', () => {
    // Nothing of the removed text survives in the buffer, so there is no line
    // to tint — the marker goes where the reader looks for what went missing.
    const out = bufferDiff(doc('one', 'two', 'three'), doc('one', 'three'))
    expect(out.changed).toEqual([])
    expect(out.deletedBefore).toEqual([2])
  })

  it('never reports a line as both changed and deleted-before', () => {
    // A replacement is one or the other; reporting both would paint the line
    // twice and make the two lists disagree about what happened.
    const out = bufferDiff(doc('a', 'b', 'c', 'd'), doc('a', 'B', 'd'))
    for (const line of out.deletedBefore) expect(out.changed).not.toContain(line)
  })

  it('does not bleed into the line after a change that ends at a line start', () => {
    // `toB` is exclusive: a change ending on a newline stopped at the previous
    // line and must not tint the untouched line that follows it.
    const out = bufferDiff(doc('a', 'b', 'c'), doc('A', 'b', 'c'))
    expect(out.changed).toEqual([1])
  })

  it('handles an empty original — every line is new', () => {
    const out = bufferDiff('', doc('a', 'b'))
    expect(out.changed).toEqual([1, 2])
  })

  it('handles an emptied buffer', () => {
    const out = bufferDiff(doc('a', 'b'), '')
    expect(out.changed).toEqual([])
    expect(out.deletedBefore).toEqual([1])
  })

  it('returns ascending, duplicate-free lists', () => {
    const out = bufferDiff(doc('a', 'b', 'c', 'd', 'e'), doc('A', 'b', 'C', 'd', 'E'))
    expect(out.changed).toEqual([...out.changed].sort((x, y) => x - y))
    expect(new Set(out.changed).size).toBe(out.changed.length)
  })
})
