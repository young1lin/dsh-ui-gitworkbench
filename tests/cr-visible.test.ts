/**
 * The carriage return must actually reach the painted cells.
 *
 * `splitOnCr` is unit-tested in `cr-mark.test.ts`; what this file guards is
 * the WIRING — that every path which paints a diff cell routes its text
 * through the marker, that the unified view's marker stays at line end
 * (word ranges are char offsets a mid-line glyph would shift), and that the
 * refusal notices still recommend normalising to LF. No DOM here, so the
 * sources are read as text, comments stripped first (a guard in this repo
 * has twice been satisfied by the prose explaining the thing).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { panelCssSource } from './helpers/panel-css.ts'

const tsx = readFileSync(fileURLToPath(new URL('../src/client/DiffViews.tsx', import.meta.url)), 'utf8')
// The side-by-side cells moved out of the view when the module hit the size
// guard; the wiring they carry is the same, so this reads them where they live.
const cells = readFileSync(fileURLToPath(new URL('../src/client/diff-cells.tsx', import.meta.url)), 'utf8')
const css = panelCssSource()
const locales = readFileSync(fileURLToPath(new URL('../src/client/locales.ts', import.meta.url)), 'utf8')

function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('the CR marker wiring', () => {
  it('routes every renderSideCode path through the marker', () => {
    const body = code(cells)
    // Both early-outs (no tokens, single plain token) and the token map must
    // draw the CR — dropping any one of the three leaves cells that show
    // byte-identical text for an ending-only change.
    const plainPaths = body.match(/return renderWithCrMarks\(cell\.text\)/g) ?? []
    expect(plainPaths.length, 'both plain-text paths should mark CRs').toBe(2)
    expect(body, 'the token path should mark CRs inside each token span')
      .toMatch(/\{renderWithCrMarks\(tok\.text\)\}/)
  })

  it('keeps the unified view marker behind the painted content', () => {
    const body = code(cells)
    // Trailing only: `endsWith` is the guard that keeps the glyph out of the
    // text; and the marker rides right after the mapped spans close — never
    // between them, which would shift the word ranges past it.
    expect(body).toMatch(/row\.text\.endsWith\(CR\)/)
    expect(body, 'crTail must close the row after painted.map, not sit inside it')
      .toMatch(/\)\)}\s*\{crTail\}/)
  })

  it('paints the marker dim and unselectable', () => {
    const body = code(css)
    expect(body).toMatch(/\.crMark\s*\{[^}]*--gs-fg-faint[^}]*user-select:\s*none[^}]*\}/)
  })

  it('recommends normalising to LF from both refusal notices and the phantom notice, both languages', () => {
    const body = code(locales)
    const zh = (body.match(/建议把行尾统一成 LF/g) ?? []).length
    const en = (body.match(/normalising the endings to LF is recommended/g) ?? []).length
    expect(zh, 'zh: crlfNotice, fileReadOnlyCrlf and phantomNotice should each advise LF').toBe(3)
    expect(en, 'en: crlfNotice, fileReadOnlyCrlf and phantomNotice should each advise LF').toBe(3)
  })
})
