import { readFileSync } from 'node:fs'
import { Text } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { visibleLineRanges } from '../src/client/cm-visible-lines.ts'

describe('visible line ranges', () => {
  it('excludes folded source lines even when the viewport encloses the whole document', () => {
    const doc = Text.of(readFileSync(new URL('../src/client/CodeEditor.tsx', import.meta.url), 'utf8').split('\n'))
    const ranges = visibleLineRanges(doc, [
      { from: 0, to: doc.line(5).to },
      { from: doc.line(doc.lines - 4).from, to: doc.length },
    ])
    expect(doc.lines).toBeGreaterThan(500)
    expect(ranges).toEqual([{ from: 0, to: 5 }, { from: doc.lines - 5, to: doc.lines }])
    expect(ranges.reduce((sum, range) => sum + range.to - range.from, 0)).toBe(10)
  })
  it('merges separate visible character ranges on the same physical line', () => {
    const doc = Text.of(['abcdef', 'ghij', 'klmn'])
    expect(visibleLineRanges(doc, [{ from: 0, to: 1 }, { from: 3, to: 5 }, { from: 7, to: 8 }]))
      .toEqual([{ from: 0, to: 2 }])
  })
  it('supports an empty document and no visible ranges', () => {
    const doc = Text.of([''])
    expect(visibleLineRanges(doc, [])).toEqual([])
    expect(visibleLineRanges(doc, [{ from: 0, to: 0 }])).toEqual([{ from: 0, to: 1 }])
  })
})
