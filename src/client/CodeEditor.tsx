/**
 * The side pane's editor: a real CodeMirror 6 view, wired to the pane's
 * existing buffer state.
 *
 * What this replaces was a transparent textarea laid over its own rendered
 * lines. That kept the caret on the glyphs, but a textarea is a textarea: Tab
 * left the field, there was no undo stack of its own, no multiple selections,
 * no find-in-file. Those are not polish — they are what "editing" means to
 * anyone who has used an editor, and the pane was asking people to edit.
 *
 * CodeMirror is here for the EDITING only. Highlighting still comes from
 * shiki, through {@link tokenRanges}: the diff columns beside this editor are
 * painted by shiki, and a second grammar engine would cost another megabyte of
 * bundle to render the same file in slightly different colours. So the tokens
 * the pane already computed are handed over as decorations.
 *
 * The document is CONTROLLED by the pane, not owned here: `value` is the
 * pane's buffer, and every change is reported back through `onChange`. The
 * effect below writes an incoming `value` into the view only when it actually
 * differs from what the view holds, so a save's round trip does not fight the
 * caret.
 *
 * @module @young1lin/dsh-ui-gitworkbench/client/CodeEditor
 */

import { useEffect, useRef, type ReactNode } from 'react'
import { EditorState, StateEffect, StateField, type Extension } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine, Decoration, type DecorationSet } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { indentUnit } from '@codemirror/language'
import { search, searchKeymap } from '@codemirror/search'

import { tokenRanges } from './cm-tokens.ts'
import type { HighlightRun } from './highlight.ts'

/** Carries a fresh set of shiki-derived decorations into the view. */
const setPaint = StateEffect.define<DecorationSet>()

/**
 * The decoration layer. It maps through document changes so the colours stay
 * on their text between repaints — without that, a keystroke would smear every
 * token after the caret until the next highlight pass landed.
 */
const paintField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(paint, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setPaint)) return effect.value
    }
    return tr.docChanged ? paint.map(tr.changes) : paint
  },
  provide: field => EditorView.decorations.from(field),
})

/** One span's inline style, from the shiki run that produced it. */
function styleFor(color: string | undefined, italic: boolean | undefined): string {
  const paint = color === undefined ? '' : 'color:' + color + ';'
  return italic === true ? paint + 'font-style:italic;' : paint
}

/** Build the decoration set for one buffer's worth of shiki runs. */
function paintFor(text: string, syntax: readonly (readonly HighlightRun[])[] | undefined): DecorationSet {
  const ranges = tokenRanges(text.split('\n'), syntax)
  return Decoration.set(
    ranges.map(range => Decoration
      .mark({ attributes: { style: styleFor(range.color, range.italic) } })
      .range(range.from, range.to)),
    true,
  )
}

/**
 * Metrics restated to match the diff columns beside this editor exactly: same
 * family, same size, same 20px rhythm, ligatures off. The pane's own CSS
 * variables carry the colours, so the editor follows the drawer's palette
 * without a CodeMirror theme per palette.
 */
const paneTheme = EditorView.theme({
  '&': { backgroundColor: 'transparent', color: 'var(--gs-fg)', height: 'auto' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    overflow: 'visible',
    fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
    fontSize: 'var(--gs-t-dense)',
    lineHeight: '20px',
    fontVariantLigatures: 'none',
  },
  '.cm-content': { padding: '0', caretColor: 'var(--gs-accent)' },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'var(--gs-fg-faint)',
    border: 'none',
    paddingRight: '8px',
  },
  '.cm-activeLine': { backgroundColor: 'var(--gs-hover)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--gs-fg-dim)' },
  '.cm-cursor': { borderLeftColor: 'var(--gs-accent)' },
})

export function CodeEditor({ value, onChange, syntax, indent, ariaLabel, onSave }: {
  /** The pane's buffer. The view is written to only when this really differs. */
  value: string
  onChange: (next: string) => void
  /** `highlightFile`'s runs for this buffer; undefined while a grammar loads. */
  syntax: readonly (readonly HighlightRun[])[] | undefined
  /** One indent level, from `detectIndent` — what Tab inserts. */
  indent: string
  ariaLabel: string
  /** Ctrl/Cmd+S. Bound inside the view too: CodeMirror sees the key first, and
   *  a save shortcut that works everywhere except inside the editor is worse
   *  than none at all. */
  onSave: () => void
}): ReactNode {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  // Read inside CodeMirror's own callbacks, which close over the render that
  // created the view — several states old by the time a key is pressed.
  const latest = useRef({ onChange, onSave })
  latest.current = { onChange, onSave }

  useEffect(() => {
    const parent = host.current
    if (parent === null) return
    const extensions: Extension[] = [
      lineNumbers(),
      history(),
      search({ top: true }),
      highlightActiveLine(),
      paintField,
      paneTheme,
      keymap.of([
        { key: 'Mod-s', preventDefault: true, run: () => { latest.current.onSave(); return true } },
        ...searchKeymap,
        ...historyKeymap,
        indentWithTab,
        ...defaultKeymap,
      ]),
      EditorView.updateListener.of(update => {
        if (update.docChanged) latest.current.onChange(update.state.doc.toString())
      }),
      EditorState.allowMultipleSelections.of(true),
      EditorView.contentAttributes.of({ 'aria-label': ariaLabel }),
    ]
    const created = new EditorView({ state: EditorState.create({ doc: value, extensions }), parent })
    view.current = created
    // Arming dropped the caret into the buffer for the textarea too: the click
    // that armed the editor said "I want to type here".
    created.focus()
    return () => { created.destroy(); view.current = null }
    // Built once per armed session. `value` and `syntax` flow in through the
    // effects below; rebuilding the view on either would drop the caret, the
    // undo stack and the selection on every keystroke.
  }, [])

  // The indent unit can change when the pane moves to another file.
  useEffect(() => {
    const current = view.current
    if (current === null) return
    current.dispatch({ effects: StateEffect.appendConfig.of(indentUnit.of(indent)) })
  }, [indent])

  // The pane's buffer, written in only when it really differs — a save's round
  // trip hands back the same text, and rewriting it would move the caret.
  useEffect(() => {
    const current = view.current
    if (current === null) return
    const held = current.state.doc.toString()
    if (held === value) return
    current.dispatch({ changes: { from: 0, to: held.length, insert: value } })
  }, [value])

  // Repaint. Depends on `value` as well as `syntax` so it runs after the write
  // above, against the text the view now actually holds.
  useEffect(() => {
    const current = view.current
    if (current === null) return
    current.dispatch({ effects: setPaint.of(paintFor(current.state.doc.toString(), syntax)) })
  }, [syntax, value])

  return <div ref={host} />
}
