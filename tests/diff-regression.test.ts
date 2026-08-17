/**
 * Global regression for the gitworkbench drawer: the diff model, the compact
 * full-width diff rows, and the stacking that lets Theme / Branch menus paint
 * above the panes. These used to live only in GitWorkbenchPanel.tsx, so a test that
 * imported the panel pulled CSS modules + React and blew up. The model is a
 * plain module; the stylesheet is read as text.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { attachWordRanges, gutterSides, overlayRanges, parseRows, type Row, type RowWithRanges } from '../src/client/diff-model.ts'
import { highlightFile, highlightForRows, shikiLangOf, shikiThemeOf } from '../src/client/highlight.ts'

const css = readFileSync(fileURLToPath(new URL('../src/client/GitWorkbenchPanel.module.css', import.meta.url)), 'utf8')
  // Comments stripped: prose inside a rule's block reads as a declaration to a
  // raw-text scan, which has fooled guards in this repo before (AGENTS.md).
  .replace(/\/\*[\s\S]*?\*\//g, '')

/** One rule's body. A missing selector fails the test: returning an empty
 *  string would turn every negative assertion on that rule into a vacuous
 *  pass when the class gets renamed. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*]/g, '\\$&')
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))
  expect(match, `selector not found: ${selector}`).not.toBeNull()
  return match?.[1] ?? ''
}

describe('parseRows', () => {
  it('walks old/new line numbers through a unified hunk', () => {
    const rows = parseRows([
      'diff --git a/x.ts b/x.ts',
      '--- a/x.ts',
      '+++ b/x.ts',
      '@@ -10,2 +10,3 @@',
      ' context',
      '-old',
      '+new',
      '+also',
    ].join('\n'))
    expect(rows.map(row => [row.kind, row.oldL, row.newL, row.text])).toEqual([
      ['hunk', 0, 0, '@@ -10,2 +10,3 @@'],
      ['context', 10, 10, 'context'],
      ['del', 11, 0, 'old'],
      ['add', 0, 11, 'new'],
      ['add', 0, 12, 'also'],
    ])
    expect(gutterSides(rows)).toEqual({ old: true, new: true })
  })

  it('skips the no-newline marker without shifting the walk', () => {
    // `\ No newline at end of file` is a note about the PREVIOUS line, not a
    // row of its own; the gutter walk must step over it (TESTS.md A8).
    const rows = parseRows([
      'diff --git a/x.txt b/x.txt',
      '--- a/x.txt',
      '+++ b/x.txt',
      '@@ -1,2 +1,2 @@',
      '-old',
      '\\ No newline at end of file',
      '+new',
      '\\ No newline at end of file',
    ].join('\n'))
    expect(rows.map(row => [row.kind, row.oldL, row.newL, row.text])).toEqual([
      ['hunk', 0, 0, '@@ -1,2 +1,2 @@'],
      ['del', 1, 0, 'old'],
      ['add', 0, 1, 'new'],
    ])
  })

  it('drops the empty side on a new file (and a pure deletion)', () => {
    const added = parseRows([
      'diff --git a/n.ts b/n.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/n.ts',
      '@@ -0,0 +1,2 @@',
      '+a',
      '+b',
    ].join('\n'))
    expect(gutterSides(added)).toEqual({ old: false, new: true })
    const deleted = parseRows([
      'diff --git a/g.ts b/g.ts',
      'deleted file mode 100644',
      '--- a/g.ts',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-a',
      '-b',
    ].join('\n'))
    expect(gutterSides(deleted)).toEqual({ old: true, new: false })
  })
})

describe('attachWordRanges (word-level diff)', () => {
  /** What a row's ranges actually cover, as text — offsets alone don't review. */
  const marked = (row: RowWithRanges): string =>
    (row.ranges ?? []).map(([start, end]) => row.text.slice(start, end)).join('')

  /** Rows of a diff: just the +/- lines. A hunk header would sit at index 0
   *  and silently absorb every `[del, add] = ...` destructure below — the
   *  first draft of these tests failed exactly that way. */
  const rowsOf = (...lines: string[]): Row[] => parseRows(lines.join('\n'))

  it('marks the one word that changed on each side of a pair', () => {
    const [del, add] = attachWordRanges(rowsOf('-const n = 1', '+const n = 2'))
    expect(marked(del!)).toBe('1')
    expect(marked(add!)).toBe('2')
  })

  it('pairs a del/add run index-wise and leaves the surplus row unmarked', () => {
    // Two deletions against one addition: min(2, 1) pairs. The second deletion
    // has no partner to be diffed against, so marking it would be a guess.
    const out = attachWordRanges(rowsOf('-x = 1', '-y = 2', '+x = 3'))
    expect(marked(out[0]!)).toBe('1')
    expect(out[1]!.ranges ?? []).toEqual([])
    expect(marked(out[2]!)).toBe('3')
  })

  it('marks every pair of an equal-length run', () => {
    const out = attachWordRanges(rowsOf('-x = 1', '-y = 2', '+x = 3', '+y = 4'))
    expect(out.map(marked)).toEqual(['1', '2', '3', '4'])
  })

  it('draws no ranges when a pair is identical', () => {
    // The whole point of word-diff is that a reflowed but unchanged line does
    // not light up. Identical texts answer [] before the LCS even runs.
    const out = attachWordRanges(rowsOf('-same (text)', '+same (text)'))
    expect(out[0]!.ranges ?? []).toEqual([])
    expect(out[1]!.ranges ?? []).toEqual([])
  })

  it('does not mutate the rows it was given', () => {
    const input = rowsOf('-a b', '+a c')
    attachWordRanges(input)
    expect(input[0]!.ranges).toBeUndefined()
  })

  it('falls back to the whole line when the token product is too large', () => {
    // 600 × 600 tokens = 360k cells over the 200k LCS budget: the useful answer
    // is a full-line emphasis, not a matrix walk that dwarfs the render.
    const old = Array.from({ length: 600 }, (_, i) => `old${i}`).join(' ')
    const neu = Array.from({ length: 600 }, (_, i) => `new${i}`).join(' ')
    const [del, add] = attachWordRanges(rowsOf(`-${old}`, `+${neu}`))
    expect(del!.ranges).toEqual([[0, old.length]])
    expect(add!.ranges).toEqual([[0, neu.length]])
  })

  it('marks a wholly-new line when the old side is empty', () => {
    // An empty old text tokenises to nothing, which the LCS cannot walk — the
    // guard turns it into the whole-line answer directly.
    const [del, add] = attachWordRanges(rowsOf('-', '+x'))
    expect(del!.ranges ?? []).toEqual([])
    expect(add!.ranges).toEqual([[0, 1]])
  })
})

describe('overlayRanges (painting ranges onto tokens)', () => {
  it('returns nothing for no tokens, unmarked tokens for no ranges', () => {
    expect(overlayRanges([], [[0, 1]])).toEqual([])
    expect(overlayRanges([{ text: 'a' }, { text: 'b' }], [])).toEqual([
      { text: 'a', mark: false },
      { text: 'b', mark: false },
    ])
  })

  it('marks the token a range covers and splits one at a range edge', () => {
    expect(overlayRanges([{ text: 'const' }, { text: ' ' }, { text: 'n' }], [[6, 7]]))
      .toEqual([{ text: 'const', mark: false }, { text: ' ', mark: false }, { text: 'n', mark: true }])
    // A range ending mid-token must cut the token, not swallow it whole —
    // syntax colour rides on tokens, and swallowing would recolour the tail.
    expect(overlayRanges([{ text: 'ab' }], [[0, 1]]))
      .toEqual([{ text: 'a', mark: true }, { text: 'b', mark: false }])
  })

  it('carries colour and italic through the split', () => {
    const out = overlayRanges([{ text: 'ab', color: '#fff', italic: true }], [[0, 1]])
    expect(out).toEqual([
      { text: 'a', color: '#fff', italic: true, mark: true },
      { text: 'b', color: '#fff', italic: true, mark: false },
    ])
  })
})

describe('drawer CSS invariants', () => {
  // `.drawer > * { z-index: 1 }` exists so pane surfaces sit above the blurred
  // background. Later siblings then paint ON TOP of earlier ones, which buried
  // the Theme and Branch popovers under `.body`. Chrome that hosts a menu has
  // to sit in a higher stacking context than the panes.
  it('stacks the bars so a popover out-ranks every bar below it', () => {
    // Three regressions live in here. Bars at z-index 1 were buried under
    // `.body` (the sync bar's pull menu: visible, hoverable, inert). Once every
    // bar shared z-index 20, a popover dropping from an UPPER bar was absorbed
    // by the next one down — the worktree picker's rows died behind the sync
    // bar. And when the header and the tabs merely TIED at 23, the tab bar, a
    // later sibling, swallowed the top of the worktree menu; equal ranks are
    // decided by source order, so a tie is a loss for whatever is above.
    //
    // Popovers only ever drop downward, so the rule is not a list of numbers
    // but an ordering: every bar strictly out-ranks the one after it, in DOM
    // order. Asserting the ordering rather than the values is what makes this
    // survive the next bar being inserted.
    const BARS = ['header', 'tabs', 'compareBar', 'syncBar'] as const
    const ranks = BARS.map(bar => {
      const match = new RegExp(`\\.drawer > \\.${bar}\\s*\\{[^}]*z-index:\\s*(\\d+)`).exec(css)
      expect(match, `no z-index for .${bar}`).not.toBeNull()
      return [bar, Number(match![1])] as const
    })
    for (let i = 1; i < ranks.length; i += 1) {
      const [above, zAbove] = ranks[i - 1]!
      const [below, zBelow] = ranks[i]!
      expect(zAbove, `.${above} must out-rank .${below}, not tie or trail it`).toBeGreaterThan(zBelow)
    }
    expect(ranks[ranks.length - 1]![1], 'the lowest bar still beats .body').toBeGreaterThan(1)
    expect(rule('.body')).toMatch(/z-index:\s*1/)
  })

  // Settings used to be a companion card portalled into the overlay beside the
  // drawer. It is a popover under its own gear now — the same idiom as every
  // other menu in here — so the rail must be gone rather than merely unused:
  // an empty 280px flex item left in the overlay would keep reserving a column.
  it('hangs settings off its gear rather than beside the drawer', () => {
    expect(css, 'the overlay rail is gone').not.toMatch(/\.themeSlot\b/)
    // It reuses the ref picker's popover, so it must beat that rule's own
    // `left: 0` — same specificity would leave it decided by source order.
    const pop = /\.refPop\.settingsPop\s*\{([^}]+)\}/.exec(css)?.[1] ?? ''
    expect(pop, 'settingsPop must out-specify .refPop').not.toBe('')
    expect(pop, 'right-aligned: it is the last control in the row').toMatch(/right:\s*0/)
    expect(pop, 'and must release .refPop left edge').toMatch(/left:\s*auto/)
    expect(pop, 'capped, because the panel is taller than most viewports').toMatch(/max-height:/)
    // The body inside it is what scrolls; the popover itself clips.
    expect(rule('.themeRail')).toMatch(/overflow-y:\s*auto/)
    expect(rule('.refPop')).toMatch(/position:\s*absolute/)
  })

  // Icon-only chrome must stay inside the button vocabulary: the row is four
  // squares because only the box changed, not because four new buttons were
  // drawn at whatever size looked right.
  it('squares the icon buttons without redefining them', () => {
    const icon = rule('.btnIcon')
    expect(icon).toMatch(/width:\s*var\(--gs-h-control\)/)
    expect(icon).not.toMatch(/height:/)
    expect(icon).not.toMatch(/border-radius:/)
  })

  it('lets a diff line grow with its longest content so tints survive horizontal scroll', () => {
    expect(rule('.line')).toMatch(/min-width:\s*100%/)
    expect(rule('.line')).toMatch(/width:\s*max-content/)
    expect(rule('.diffPre')).toMatch(/width:\s*max-content/)
    expect(rule('.diffPre')).toMatch(/min-width:\s*100%/)
    expect(rule('.code')).not.toMatch(/min-width:\s*0/)
  })

  it('uses GitHub diff leading without a baseline strut', () => {
    expect(rule('.diffPre')).toMatch(/line-height:\s*20px/)
    expect(rule('.line')).toMatch(/align-items:\s*stretch/)
    expect(rule('.line')).toMatch(/line-height:\s*20px/)
    expect(rule('.diffPre')).toMatch(/font-variant-ligatures:\s*none/)
  })

  it('truncates commit subjects in the list; the full message lives in the hover card', () => {
    expect(rule('.commitSubject')).toMatch(/text-overflow:\s*ellipsis/)
    expect(rule('.commitSubject')).toMatch(/white-space:\s*nowrap/)
    expect(css).not.toMatch(/\.commitBanner\b/)
    expect(rule('.commitPop')).toMatch(/position:\s*fixed/)
    expect(rule('.commitPopBody')).toMatch(/white-space:\s*pre-wrap/)
  })

  // The resizer is absolute over the drawer's left edge, so the pane's first
  // gutter is the only thing standing between it and a row control. A tick
  // pulled past that gutter with a negative margin had its left half under the
  // resizer: clicking it dragged the drawer instead of staging the file.
  it('pulls no control past the pane gutter, where the drawer resizer paints over it', () => {
    expect(css).not.toMatch(/margin-left:\s*calc\(var\(--gs-gutter-pane\)\s*\*\s*-1\)/)
  })
})

describe('shiki highlight', () => {
  it('maps extensions to grammars', () => {
    expect(shikiLangOf('a.tsx')).toBe('typescript')
    expect(shikiLangOf('a.py')).toBe('python')
    expect(shikiLangOf('README.md')).toBe('markdown')
    expect(shikiLangOf('schema.sql')).toBe('sql')
    expect(shikiLangOf('pom.xml')).toBe('xml')
    expect(shikiLangOf('icon.svg')).toBe('xml')
    expect(shikiLangOf('app.properties')).toBe('ini')
    expect(shikiLangOf('changes.patch')).toBe('diff')
    expect(shikiLangOf('a.bin')).toBeUndefined()
  })

  it('assigns more than one token colour on a TypeScript line', () => {
    expect(shikiThemeOf('github-dark')).toBe('github-dark-default')
    expect(shikiThemeOf('vscode-dark')).toBe('dark-plus')
    const lines = highlightFile(["const n = parseInt('2')"], 'typescript', 'github-dark-default')
    expect(lines).toBeTruthy()
    const colors = new Set(
      (lines![0] ?? [])
        .map(tok => tok.color)
        .filter((color): color is string => typeof color === 'string' && color.length > 0),
    )
    expect(colors.size).toBeGreaterThan(2)
  })

  it('still colours keywords on an added line that follows export default {', () => {
    const rows = parseRows([
      '@@ -1,2 +1,3 @@',
      ' export default {',
      '-interface UntrackedSynthesis {',
      '+async function mapPooled() {',
      '+  const n = 1',
    ].join('\n'))
    const syn = highlightForRows(rows, 'typescript', 'github-dark-default')
    const asyncRow = syn[rows.findIndex(row => row.text.includes('async function'))]!
    const constRow = syn[rows.findIndex(row => row.text.includes('const n'))]!
    const colorOf = (row: typeof asyncRow, needle: string) =>
      row.find(tok => tok.text === needle)?.color
    // Punctuation alone can make a "more than one colour" check pass while
    // `async`/`function`/`const` still share the identifier colour.
    expect(colorOf(asyncRow, 'function')).toBeTruthy()
    expect(colorOf(asyncRow, 'mapPooled')).toBeTruthy()
    expect(colorOf(asyncRow, 'function')).not.toBe(colorOf(asyncRow, 'mapPooled'))
    expect(colorOf(constRow, 'const')).toBeTruthy()
    expect(colorOf(constRow, 'n')).toBeTruthy()
    expect(colorOf(constRow, 'const')).not.toBe(colorOf(constRow, 'n'))
  })

  it('keeps a JSDoc interior line comment-coloured, keywords in the prose included', () => {
    // Every other line is re-lexed alone so keywords survive a partial hunk, but
    // a ` * ` line lexed alone is not a comment at all — `as` and `never` would
    // come back as keywords mid-sentence. Comment lines keep the file-level pass.
    const lines = ['/**', ' * Highlight as never a keyword here', ' */', 'export const x = 1']
    const painted = highlightFile(lines, 'typescript', 'github-dark-default')!
    const doc = painted[1]!
    const colours = new Set(doc.map(tok => tok.color))
    expect(doc.map(tok => tok.text).join('')).toContain('never')
    expect(colours.size, [...colours].join(' ')).toBe(1)
    expect([...colours][0]).not.toBe(painted[3]!.find(tok => tok.text === 'export')?.color)
  })
})
