/**
 * The CR marker split: what a diff cell renders around each carriage
 * return. The CR itself is built with fromCharCode everywhere — a literal
 * escape in this file would be rewritten by text-mode tooling on Windows,
 * which is the very pitfall the module exists to draw.
 */
import { describe, expect, it } from 'vitest'

import { CR, CR_GLYPH, splitOnCr } from '../src/client/cr-mark.ts'

const LF = String.fromCharCode(10)

describe('splitOnCr', () => {
  it('returns CR-free text as one part', () => {
    expect(splitOnCr('one')).toEqual(['one'])
    expect(splitOnCr('')).toEqual([''])
  })

  it('splits a CRLF line into text and an empty tail', () => {
    // The diff model carries the CR at the end of the line's text: the
    // renderer draws the glyph between the two parts, i.e. after the text.
    expect(splitOnCr('one' + CR)).toEqual(['one', ''])
  })

  it('splits at a mid-line CR, the CR-only-file case', () => {
    expect(splitOnCr('a' + CR + 'b')).toEqual(['a', 'b'])
    expect(splitOnCr(CR + CR)).toEqual(['', '', ''])
  })

  it('yields one more part than there are CRs', () => {
    const text = ['x', 'y', 'z'].join(CR)
    expect(splitOnCr(text)).toHaveLength(3)
    expect(splitOnCr(text).join('|')).toBe('x|y|z')
  })

  it('never confuses CR with LF', () => {
    // An LF-only line (the ordinary case) must stay one part: the marker is
    // for carriage returns, and painting it on every ordinary line would
    // make the glyph noise instead of signal.
    expect(splitOnCr('one' + LF + 'two')).toEqual(['one' + LF + 'two'])
  })
})

describe('CR_GLYPH', () => {
  it('is the picture of the carriage-return control character', () => {
    expect(CR_GLYPH).toBe(String.fromCharCode(0x240d))
    expect(CR_GLYPH).not.toContain(CR)
  })
})
