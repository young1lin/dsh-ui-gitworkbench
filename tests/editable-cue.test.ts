/**
 * The editable pane's mark must mean what it says.
 *
 * A rule down the editor's leading edge is the only thing telling a reader
 * that this pane takes keystrokes — the Files tab arms its editor the moment
 * a file opens, with no button in between. A mark that appears on a pane
 * CodeMirror will refuse (a CRLF or non-UTF-8 file, where `readOnly` is set so
 * a save cannot rewrite bytes nobody touched) is worse than no mark at all:
 * the reader types a paragraph and watches it go nowhere.
 *
 * So the invariant is not "the cue exists" — it is that the cue and
 * `EditorState.readOnly` are driven by ONE boolean, and that the stylesheet
 * paints the rule only for the attribute that boolean sets. Neither half can
 * be exercised at runtime here: there is no DOM in this environment, and the
 * component pulls a CSS module and React. So the sources are read as text.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const tsx = readFileSync(fileURLToPath(new URL('../src/client/CodeEditor.tsx', import.meta.url)), 'utf8')
const css = readFileSync(fileURLToPath(new URL('../src/client/GitWorkbenchPanel.module.css', import.meta.url)), 'utf8')

/**
 * Comments stripped before anything is matched.
 *
 * Twice now a source-scanning guard in this repo has been satisfied by prose:
 * the thing it was looking for was sitting in the comment that explained the
 * thing, and the code could be changed without the test noticing.
 */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('the editable cue', () => {
  it('comes from the same boolean that configures readOnly', () => {
    const body = code(tsx)
    expect(body, 'CodeEditor should derive one `editable` from the readOnly prop')
      .toMatch(/const editable = readOnly !== true/)
    // The mirror that must not drift: configured from anything but `editable`
    // and the mark can appear on a pane that refuses the keystroke.
    expect(body, 'EditorState.readOnly must be configured from `editable`')
      .toMatch(/EditorState\.readOnly\.of\(!editable\)/)
  })

  it('marks the host only when that boolean says so', () => {
    const body = code(tsx)
    // A hard-coded `data-editable=""` has no braces, so it does not match here
    // at all and the count assertion is what catches it.
    const marks = body.match(/data-editable=\{[^}]*\}/g) ?? []
    expect(marks.length, 'the host should carry exactly one computed data-editable').toBe(1)
    expect(marks[0], 'data-editable must be gated on `editable`').toMatch(/editable/)
  })

  it('is painted for the attribute rather than for every editor', () => {
    const sheet = code(css)
    expect(sheet, 'no rule paints the mark').toMatch(/\.cmHost\[data-editable\]/)
    // Matches `.cmHost::before` and `.cmHost:focus-within::before`, and not
    // the attribute-gated form. An unconditional rule would put the mark on a
    // read-only pane, which is the failure this whole file exists to prevent.
    expect(sheet, '.cmHost must not paint the mark unconditionally')
      .not.toMatch(/\.cmHost(:[a-z-]+)?::before/)
  })

  it('lights up while the caret is inside it', () => {
    // The second half of the cue: dim says "you may type here", lit says "you
    // are typing here". Without the focus rule the mark is decoration.
    expect(code(css)).toMatch(/\.cmHost\[data-editable\]:focus-within::before/)
  })
})
