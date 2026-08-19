import { describe, expect, it } from 'vitest'

import { tokenRanges } from '../src/client/cm-tokens.ts'
import type { HighlightRun } from '../src/client/highlight.ts'

const run = (text: string, color?: string, italic?: boolean): HighlightRun =>
  italic === undefined ? { text, color } : { text, color, italic }

describe('tokenRanges', () => {
  it('offsets the second line past the first line and its newline', () => {
    const lines = ['const a', 'let b']
    const runs = [[run('const', '#f00'), run(' a')], [run('let', '#0f0'), run(' b')]]
    expect(tokenRanges(lines, runs)).toEqual([
      { from: 0, to: 5, color: '#f00', italic: undefined },
      { from: 8, to: 11, color: '#0f0', italic: undefined },
    ])
  })

  it('drops runs that paint nothing, which is most of a file', () => {
    // A decoration that changes no colour still costs a DOM element per token.
    expect(tokenRanges(['plain text here'], [[run('plain text here')]])).toEqual([])
  })

  it('keeps an italic run even with no colour', () => {
    expect(tokenRanges(['x'], [[run('x', undefined, true)]])).toEqual([
      { from: 0, to: 1, color: undefined, italic: true },
    ])
  })

  it('yields nothing while the grammar is still loading', () => {
    expect(tokenRanges(['const a'], undefined)).toEqual([])
  })

  it('yields nothing for a line the runs do not cover', () => {
    expect(tokenRanges(['a', 'b'], [[run('a', '#f00')]])).toEqual([{ from: 0, to: 1, color: '#f00', italic: undefined }])
  })

  it('clips a run that claims more text than its line has', () => {
    // Disagreeing inputs must not produce a range crossing a line boundary:
    // CodeMirror throws on those, and less paint beats a crash in the editor.
    expect(tokenRanges(['ab', 'cd'], [[run('abXYZ', '#f00')]])).toEqual([
      { from: 0, to: 2, color: '#f00', italic: undefined },
    ])
  })

  it('handles empty lines without shifting what follows', () => {
    const lines = ['a', '', 'b']
    const runs = [[run('a', '#f00')], [], [run('b', '#00f')]]
    expect(tokenRanges(lines, runs)).toEqual([
      { from: 0, to: 1, color: '#f00', italic: undefined },
      { from: 3, to: 4, color: '#00f', italic: undefined },
    ])
  })

  it('returns ranges in document order, as a range set needs them', () => {
    const lines = ['ab', 'cd', 'ef']
    const runs = [[run('ab', '#1')], [run('cd', '#2')], [run('ef', '#3')]]
    const out = tokenRanges(lines, runs)
    expect(out.map(r => r.from)).toEqual([0, 3, 6])
  })
})
