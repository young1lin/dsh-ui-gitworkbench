/**
 * Find in the Changes side-by-side pane: the armed editor's panel must stay
 * on screen and sit over the column it searches; the un-armed pane must
 * carry a find of its own over both columns.
 *
 * CodeMirror mounts `.cm-panels` as the first child of `.cm-editor` with
 * `position: sticky; top: 0`. Sticky resolves against the NEAREST scroll
 * container, and in the side-by-side pane that is `.sideCol` — `overflow-x:
 * auto` makes it one — not `.sideScroll`, which is the box that actually
 * moves. The column is as tall as the file, so its scrollport never scrolls
 * vertically and the panel simply rides away with line 1: Enter finds the
 * next match and the field that found it is gone. The Files tab never sees
 * this because `.fbBody` is both the editor's parent and the scroller.
 *
 * The fix is the library's own answer for exactly this: `panels({
 * topContainer })` mounts the strip in an element the caller chooses, and
 * `SideFindSeat` gives it one above the scroller, over the WORKING-TREE
 * column alone — the panel searches the buffer, so a strip across both
 * columns would claim more than it does. Before the editor is armed the
 * pane has no CodeMirror at all, so it takes the unified pane's bar and
 * walks both columns. None of this can be exercised here (no layout in this
 * environment, and the files pull React and a CSS Module), so the wiring is
 * read back from the sources with comments stripped.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { panelCssSource } from './helpers/panel-css.ts'

const read = (file: string): string =>
  readFileSync(fileURLToPath(new URL(`../src/client/${file}`, import.meta.url)), 'utf8')

/** Comments stripped first: a guard that can be satisfied by the prose
 *  explaining the thing is no guard. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const editor = code(read('CodeEditor.tsx'))
const views = code(read('DiffViews.tsx'))
const bar = code(read('DiffFindBar.tsx'))
const css = code(panelCssSource())

describe("the armed editor's find panel", () => {
  it('is handed to CodeMirror as the panel container', () => {
    expect(editor, 'CodeEditor should configure panels({ topContainer }) from its panelHost prop')
      .toMatch(/panels\(\{\s*topContainer:[^}]*panelHost/)
  })

  it('is where the match count looks for the panel', () => {
    // The count is appended INTO the library's panel, found by a query. A
    // query rooted at `view.dom` alone finds nothing once the panel lives
    // outside the editor, and the count silently vanishes.
    const lookups = editor.match(/querySelector\('\.cm-panel\.cm-search'\)/g) ?? []
    expect(lookups.length, 'exactly one lookup for the search panel').toBe(1)
    expect(editor, 'the lookup must fall back from the host to view.dom, not read view.dom alone')
      .toMatch(/\?\?\s*view\.dom\)\.querySelector\('\.cm-panel\.cm-search'\)/)
  })

  it('is seated above the scroller, outside both columns, only while armed', () => {
    const seat = views.indexOf('<SideFindSeat')
    const scroll = views.indexOf('css.sideScroll')
    expect(seat, 'the side pane should render the seat').toBeGreaterThan(-1)
    expect(seat, 'the seat must come BEFORE the scroller in the pane, not inside it').toBeLessThan(scroll)
    expect(views, 'the seat is the armed editor’s, and only its')
      .toMatch(/bodyState\.kind === 'editor' \? <SideFindSeat[^>]*hostRef=\{findHostRef\}/)
    expect(views, 'the side pane editor must be given the same host')
      .toMatch(/<CodeEditor[\s\S]*?panelHost=\{findHostRef\}[\s\S]*?\/>/)
  })

  it('sits over the working-tree column: spacer for the left, a divider-wide gap, then the host', () => {
    // Order is what aligns it with `.sideCols`; the seat gives back the
    // scroller's own scrollbar on the right, which the columns never had.
    expect(bar).toMatch(/className=\{css\.sideFindRow\} style=\{\{ paddingRight: gutter \}\}/)
    const spacer = bar.indexOf('css.sideFindSpacer')
    const gap = bar.indexOf('css.sideFindGap')
    const host = bar.indexOf('css.sideFindHost')
    expect(spacer).toBeGreaterThan(-1)
    expect(gap).toBeGreaterThan(spacer)
    expect(host).toBeGreaterThan(gap)
    expect(bar, 'the spacer is as wide as the left column')
      .toMatch(/css\.sideFindSpacer\} style=\{\{ flexBasis: `\$\{split \* 100\}%` \}\}/)
    expect(css, 'a pinned row').toMatch(/\.sideFindRow\s*\{[^}]*flex:\s*none/)
    expect(css, 'the host fills what is left').toMatch(/\.sideFindHost\s*\{[^}]*flex:\s*1 1 0/)
  })
})

describe("the un-armed pane's find", () => {
  it('walks both columns through the shared bar, and only while no editor is armed', () => {
    expect(views, 'the side pane binds the bar to findInSides over its two column texts')
      .toMatch(/useDiffFind\(useCallback\(\(query: string\) => findInSides\(leftLines, rightLines, query\)/)
    expect(views, 'the bar renders for rows, never beside the editor’s own panel')
      .toMatch(/find\.open && bodyState\.kind === 'rows' \? <DiffFindBar/)
  })

  it('takes Ctrl/Cmd+F only while the editor does not', () => {
    // Armed, CodeMirror handles the key and does not stop it bubbling; an
    // unguarded handoff would open both finds at once.
    expect(views).toMatch(/if \(!editable\) find\.onPaneKeyDown\(event\)/)
  })

  it('closes when the editor arms', () => {
    expect(views).toMatch(/setEdit\(prev => armEdit\(prev, sides\)\)\s*\n\s*find\.close\(\)/)
  })

  it('paints hits in both aligned columns, per visible cell', () => {
    const hits = views.match(/hits=\{finding && row\.(left|right) !== null \? rowHitRanges\(row\.\1\.text, find\.query\) : NO_RANGES\}/g) ?? []
    expect(hits.map(m => /row\.(left|right) !==/.exec(m)![1]).sort()).toEqual(['left', 'right'])
    const current = views.match(/currentCol=\{currentColIn\(find\.currentHit, i, '(left|right)'\)\}/g) ?? []
    expect(current.length).toBe(2)
  })

  it('can hand focus back to the scroller on Escape', () => {
    expect(views).toMatch(/className=\{css\.sideScroll\} tabIndex=\{-1\}/)
    expect(css, 'a focused scroller draws no ring').toMatch(/\.sideScroll\s*\{[^}]*outline:\s*none/)
  })
})
