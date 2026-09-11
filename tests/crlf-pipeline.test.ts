/**
 * CRLF through the real diff pipeline: parseRows and both highlight passes
 * keep every line self-aligned when line text carries carriage returns.
 *
 * Pinned while investigating "CRLF content sometimes will not display": the
 * pipeline was exonerated (the blank panes were the line-ending phantom and
 * the compare direction, not rendering) — these tests keep it that way. If
 * shiki ever changes how it groups tokens per line, this fails first.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { highlightWindow, highlightForRowsWindow, warmHighlighter } from '../src/client/highlight.ts'
import { parseRows } from '../src/client/diff-model.ts'

const CR = String.fromCharCode(13)

// The engine is a wasm module that loads asynchronously; until it has, every
// tokenizer answers plain text. The drawer warms it as it opens — here the
// suite does.
beforeAll(() => warmHighlighter())

describe('probe: CRLF through the real pipeline', () => {
  it('highlightWindow keeps each line self-aligned when lines end in CR', () => {
    const lines = ['const a = 1' + CR, 'let b = 2' + CR, 'return a + b' + CR]
    const out = highlightWindow(lines, 'typescript', 'github-dark-default', 0, lines.length)
    expect(out).toBeDefined()
    for (let i = 0; i < lines.length; i += 1) {
      const joined = (out![i] ?? []).map(run => run.text).join('')
      expect(joined).toBe(lines[i])
    }
  })

  it('highlightWindow survives a CR-only file (mid-line CRs)', () => {
    const lines = ['a' + CR + 'b', CR + CR, 'end' + CR]
    const out = highlightWindow(lines, 'typescript', 'github-dark-default', 0, lines.length)
    expect(out).toBeDefined()
    for (let i = 0; i < lines.length; i += 1) {
      const joined = (out![i] ?? []).map(run => run.text).join('')
      expect(joined).toBe(lines[i])
    }
  })

  it('rows from a CRLF unified diff highlight as their own text', () => {
    const segment = [
      ' const a = 1' + CR,
      '-let b = 2' + CR,
      '+let b = 3' + CR,
      ' return a + b' + CR,
    ].join('\n')
    const rows = parseRows(segment)
    const runs = highlightForRowsWindow(rows, 'typescript', 'github-dark-default', 0, rows.length)
    for (let i = 0; i < rows.length; i += 1) {
      const joined = (runs[i] ?? []).map(run => run.text).join('')
      expect(joined).toBe(rows[i]!.text)
    }
  })
})
