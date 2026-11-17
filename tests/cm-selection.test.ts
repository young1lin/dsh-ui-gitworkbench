import { Text } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { selectionWindow } from '../src/client/cm-selection.ts'
import { bufferDiff } from '../src/client/cm-diff.ts'

describe('persistent code selection window', () => {
  const doc = Text.of(['first', '代码\r', 'third', 'fourth'])
  it('ignores CRLF display differences while retaining changed source line numbers', () => {
    expect(bufferDiff('one\nold\nthree\n', 'one\r\nnew\r\nthree\r\n', true).changed).toEqual([2])
    expect(bufferDiff('one\n', 'one\r\n', true).changed).toEqual([])
    expect(bufferDiff('one\n', 'one\r\n').changed.length).toBeGreaterThan(0)
  })
  it('keeps the actual character range and excludes the next unselected line', () => {
    expect(selectionWindow(doc, [{ from: doc.line(2).from, to: doc.line(3).from }], [{ from: 0, to: doc.length }]))
      .toEqual({ lines: [2], spans: [{ from: 6, to: 10 }] })
  })
  it('paints only the viewport when the entire document is selected', () => {
    const long = Text.of(Array.from({ length: 20_000 }, (_, i) => `source ${i}`))
    const visible = [{ from: long.line(100).from, to: long.line(104).to }, { from: long.line(200).from, to: long.line(201).to }]
    expect(selectionWindow(long, [{ from: 0, to: long.length }], visible).lines).toEqual([100, 101, 102, 103, 104, 200, 201])
  })
  it('retains multiple ranges, deduplicates their lines and ignores a caret', () => {
    expect(selectionWindow(doc, [{ from: 0, to: 2 }, { from: 3, to: 5 }, { from: 7, to: 7 }], [{ from: 0, to: 5 }]))
      .toEqual({ lines: [1], spans: [{ from: 0, to: 2 }, { from: 3, to: 5 }] })
  })
})
