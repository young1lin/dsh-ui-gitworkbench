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

import { blameCompartment, blameField, blameGutter, setBlame } from './blame-gutter.ts'
import { bufferDiff } from './cm-diff.ts'
import { tokenRanges } from './cm-tokens.ts'
import type { HighlightRun } from './highlight.ts'
import type { BlameLine } from './GitWorkbenchPanel.tsx'

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

/** The other side's text, kept in state so the diff layer can recompute from
 *  a transaction alone rather than from a closure over some past render. */
const setOriginal = StateEffect.define<string>()
const originalText = StateField.define<string>({
  create: () => '',
  update(held, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setOriginal)) return effect.value
    }
    return held
  },
})

/**
 * The add/delete tint, recomputed on every keystroke.
 *
 * Arming the editor used to take the diff colours away, because the pane's
 * tints come from git's diff and git has not seen a keystroke. Watching the
 * change take shape is the reason to edit inside a diff view at all, so the
 * tint is recomputed here from the text on both sides instead.
 *
 * This diff is a READING AID. No git operation uses it: the block actions
 * still send line indices against the host's own `diffSha`-stamped patch.
 */
const diffField = StateField.define<DecorationSet>({
  create: state => diffDecorations(state),
  update(deco, tr) {
    const reset = tr.effects.some(effect => effect.is(setOriginal))
    return tr.docChanged || reset ? diffDecorations(tr.state) : deco
  },
  provide: field => EditorView.decorations.from(field),
})

function diffDecorations(state: EditorState): DecorationSet {
  const original = state.field(originalText, false) ?? ''
  const doc = state.doc.toString()
  const { changed, deletedBefore } = bufferDiff(original, doc)
  const marks: { at: number; deco: Decoration }[] = []
  const lineCount = state.doc.lines
  for (const line of changed) {
    if (line <= lineCount) marks.push({ at: state.doc.line(line).from, deco: CHANGED_LINE })
  }
  for (const line of deletedBefore) {
    if (line <= lineCount) marks.push({ at: state.doc.line(line).from, deco: DELETED_AT })
  }
  marks.sort((a, b) => a.at - b.at)
  return Decoration.set(marks.map(mark => mark.deco.range(mark.at)), true)
}

const CHANGED_LINE = Decoration.line({ class: 'cm-gwChanged' })
const DELETED_AT = Decoration.line({ class: 'cm-gwDeleted' })

/** Where a jump was asked from, in the editor's own coordinates. */
export interface JumpRequest {
  /** One-based line, as `doc.line()` counts. */
  readonly line: number
  /** Zero-based UTF-16 offset within the line. */
  readonly column: number
}

/** A line to put the caret on, with a token so the same line can be asked for
 *  twice. The pane hands over a NEW object per request; nothing else would
 *  distinguish "jump here again" from a re-render. */
export interface Reveal {
  readonly line: number
  readonly token: number
}

/**
 * Ctrl/Cmd+click, F12 and Ctrl/Cmd+B ask the pane where a symbol is defined;
 * Alt+Left walks back.
 *
 * Three spellings because three editors taught three different reflexes, and
 * the one a reader has is not knowable from here. Ctrl+click is also the only
 * one that is discoverable by accident.
 *
 * Bound BEFORE the pane's other keymap in the extension list: CodeMirror
 * resolves keys in facet order, and `defaultKeymap` sitting first would take
 * the binding it happens to share.
 */
function jumpKeys(
  ask: (request: JumpRequest) => void,
  back: () => void,
): Extension {
  const fromOffset = (view: EditorView, offset: number): boolean => {
    const line = view.state.doc.lineAt(offset)
    ask({ line: line.number, column: offset - line.from })
    return true
  }
  const atCaret = (view: EditorView): boolean => fromOffset(view, view.state.selection.main.head)
  return [
    EditorView.domEventHandlers({
      mousedown(event, view) {
        if (event.button !== 0 || !(event.ctrlKey || event.metaKey)) return false
        const offset = view.posAtCoords({ x: event.clientX, y: event.clientY })
        if (offset === null) return false
        // Taken over from CodeMirror, whose own Ctrl/Cmd+click starts a second
        // selection range. Leaving that to also happen would drop an invisible
        // extra cursor into the buffer on every jump, and the next keystroke
        // would type in two places.
        event.preventDefault()
        return fromOffset(view, offset)
      },
    }),
    keymap.of([
      { key: 'F12', preventDefault: true, run: atCaret },
      { key: 'Mod-b', preventDefault: true, run: atCaret },
      { key: 'Alt-ArrowLeft', preventDefault: true, run: () => { back(); return true } },
    ]),
  ]
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
  // Same tints the diff columns use, so a line the reader just typed reads as
  // the same kind of thing as a line git already knows about.
  '.cm-gwChanged': { backgroundColor: 'var(--gs-add-line)' },
  '.cm-gwDeleted': { boxShadow: 'inset 0 2px 0 0 var(--gs-del-line)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--gs-fg-dim)' },
  '.cm-cursor': { borderLeftColor: 'var(--gs-accent)' },
  // The blame gutter. Dim and monospaced-narrow: it sits beside code the
  // reader came to read, so it must be legible without competing.
  '.cm-gwBlameGutter': {
    color: 'var(--gs-fg-faint)',
    fontSize: 'var(--gs-t-meta)',
    paddingRight: '10px',
    borderRight: '1px solid var(--gs-border)',
    marginRight: '6px',
  },
  '.cm-gwBlameCell': {
    display: 'block',
    maxWidth: '12ch',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    cursor: 'pointer',
  },
})

export function CodeEditor({ value, original, onChange, syntax, indent, ariaLabel, onSave, blame, notCommitted, readOnly, onBlameClick, onCaret, onJump, onJumpBack, reveal }: {
  /** The pane's buffer. The view is written to only when this really differs. */
  value: string
  /** The other side's whole text — the index side, for the unstaged layer this
   *  editor lives on. What the live tint is computed against. */
  original: string
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
  /** Per-line provenance for the blame gutter, or null for "not showing".
   *  The gutter is added and removed with it, because an installed gutter with
   *  no markers still reserves its column. */
  blame?: readonly BlameLine[] | null
  /** The drawer's own wording for a line no commit covers yet. */
  notCommitted?: string
  /** A file the editor may show but must not change — a CRLF or non-UTF-8
   *  file, where any save would rewrite bytes nobody touched. */
  readOnly?: boolean
  /** A click in the blame gutter, with the 1-based line number. */
  onBlameClick?: (line: number) => void
  /** "Where is this defined?", from Ctrl/Cmd+click, F12 or Ctrl/Cmd+B.
   *  Omitted where the buffer is not the file on disk — the pane decides, and
   *  the keys then do nothing rather than asking about the wrong text. */
  onJump?: (request: JumpRequest) => void
  /** Alt+Left. Bound here as well as on the pane because CodeMirror sees the
   *  key first while the caret is in the buffer, which is exactly when someone
   *  wants to walk back. */
  onJumpBack?: () => void
  /** The caret moved. Reported so the pane's own "go to definition" button
   *  can act on the same position the keys do; the pane is expected to keep
   *  this in a ref, since it fires on every arrow key. */
  onCaret?: (request: JumpRequest) => void
  /** Put the caret on this line and scroll it into view, once per token. */
  reveal?: Reveal | null
}): ReactNode {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  // Read inside CodeMirror's own callbacks, which close over the render that
  // created the view — several states old by the time a key is pressed.
  const latest = useRef({ onChange, onSave, onBlameClick, onCaret, onJump, onJumpBack })
  latest.current = { onChange, onSave, onBlameClick, onCaret, onJump, onJumpBack }
  // Stable across renders so reconfiguring the gutter does not depend on a
  // callback identity that changes every time the pane re-renders.
  const pick = useRef((line: number) => { latest.current.onBlameClick?.(line) }).current

  useEffect(() => {
    const parent = host.current
    if (parent === null) return
    const extensions: Extension[] = [
      lineNumbers(),
      history(),
      search({ top: true }),
      highlightActiveLine(),
      paintField,
      blameField,
      blameCompartment.of([]),
      EditorState.readOnly.of(readOnly === true),
      originalText.init(() => original),
      diffField,
      paneTheme,
      // Ahead of the keymap below, and reading the callbacks through `latest`
      // so a pane that starts or stops offering jumps does not rebuild the
      // view — a rebuild would drop the caret, the undo stack and the
      // selection.
      jumpKeys(
        request => { latest.current.onJump?.(request) },
        () => { latest.current.onJumpBack?.() },
      ),
      keymap.of([
        { key: 'Mod-s', preventDefault: true, run: () => { latest.current.onSave(); return true } },
        ...searchKeymap,
        ...historyKeymap,
        indentWithTab,
        ...defaultKeymap,
      ]),
      EditorView.updateListener.of(update => {
        if (update.docChanged) latest.current.onChange(update.state.doc.toString())
        if (update.selectionSet || update.docChanged) {
          const head = update.state.selection.main.head
          const line = update.state.doc.lineAt(head)
          latest.current.onCaret?.({ line: line.number, column: head - line.from })
        }
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

  // Blame arriving, changing, or being switched off. The gutter itself goes
  // in and out through the compartment; the field carries the lines.
  useEffect(() => {
    const current = view.current
    if (current === null) return
    const lines = blame ?? null
    current.dispatch({
      effects: [
        blameCompartment.reconfigure(lines === null ? [] : blameGutter(notCommitted ?? '', pick)),
        setBlame.of(lines),
      ],
    })
  }, [blame, notCommitted])

  // The other side, when a refresh brings a new one in.
  useEffect(() => {
    const current = view.current
    if (current === null) return
    if (current.state.field(originalText, false) === original) return
    current.dispatch({ effects: setOriginal.of(original) })
  }, [original])

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

  // Landing a jump. Keyed on the request ALONE, never on `value`: the pane's
  // buffer changes on every keystroke, and a reveal that re-ran with it would
  // yank the caret back to the jump target while somebody was typing. The doc
  // is already right when this runs — the pane withholds the editor until the
  // file's sides have loaded, so a jump into another file mounts a fresh view
  // whose initial document is that file.
  useEffect(() => {
    const current = view.current
    if (current === null || reveal === null || reveal === undefined) return
    // A server can name a line past the end of what this pane holds — the file
    // changed on disk since it was indexed. The last line is the closest true
    // thing to show, and it beats throwing.
    const wanted = Math.min(Math.max(1, Math.trunc(reveal.line)), current.state.doc.lines)
    const line = current.state.doc.line(wanted)
    current.dispatch({
      selection: { anchor: line.from },
      effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
    })
    current.focus()
  }, [reveal])

  // Repaint. Depends on `value` as well as `syntax` so it runs after the write
  // above, against the text the view now actually holds.
  useEffect(() => {
    const current = view.current
    if (current === null) return
    current.dispatch({ effects: setPaint.of(paintFor(current.state.doc.toString(), syntax)) })
  }, [syntax, value])

  return <div ref={host} />
}
