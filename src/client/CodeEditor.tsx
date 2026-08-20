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
 * shiki, through {@link PaintFn}: the diff columns beside this editor are
 * painted by shiki, and a second grammar engine would cost another megabyte of
 * bundle to render the same file in slightly different colours. The pane hands
 * over a function rather than a file of tokens, and this view calls it for the
 * lines it is about to show - see {@link PaintLayer}.
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
import { Compartment, EditorState, Facet, StateEffect, StateField, type Extension } from '@codemirror/state'
import { EditorView, ViewPlugin, keymap, lineNumbers, highlightActiveLine, Decoration, type DecorationSet, type PluginValue, type ViewUpdate } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { indentUnit } from '@codemirror/language'
import { search, searchKeymap } from '@codemirror/search'

import css from './GitWorkbenchPanel.module.css'
import { blameCompartment, blameField, blameGutter, setBlame } from './blame-gutter.ts'
import { bufferDiff } from './cm-diff.ts'
import { lineTokenRanges } from './cm-tokens.ts'
import type { HighlightRun } from './highlight.ts'
import type { BlameLine } from './GitWorkbenchPanel.tsx'

/**
 * Tokens for the lines in a range of the buffer.
 *
 * The editor asks for what it is about to show, never for the file. Painting a
 * whole buffer cost 1,637ms on 1,837 lines of real TypeScript — a freeze on
 * every click, and the reason files past 2,000 lines used to be shown with no
 * colour at all rather than made to wait for it.
 *
 * @param lines - the buffer's lines, complete and in order.
 * @param from - first line wanted, 0-based.
 * @param to - one past the last line wanted.
 * @returns runs indexed by line, filled inside the range; undefined for "no
 *          grammar", which renders as plain text.
 */
export type PaintFn = (
  lines: readonly string[],
  from: number,
  to: number,
) => readonly (readonly HighlightRun[] | undefined)[] | undefined

/** Where the view reads its painter from. Reconfigured — through
 *  {@link paintCompartment} — when the file, the language or the theme moves. */
const paintFacet = Facet.define<PaintFn | null, PaintFn | null>({
  combine: values => values.length > 0 ? values[0]! : null,
})
const paintCompartment = new Compartment()

/**
 * How long after the last keystroke the editor recomputes what it paints.
 *
 * Both layers below are proportional to what they are asked for, and typing
 * asks again on every character. The decorations map through the change in the
 * meantime, so the colours and the tint ride along with the text and only the
 * recomputation waits.
 */
const REPAINT_IDLE_MS = 180

/** One span's inline style, from the shiki run that produced it. */
function styleFor(color: string | undefined, italic: boolean | undefined): string {
  const paint = color === undefined ? '' : 'color:' + color + ';'
  return italic === true ? paint + 'font-style:italic;' : paint
}

/**
 * A decoration layer that is recomputed when the view moves and DEFERRED when
 * the reader types.
 *
 * The two layers below — syntax colour and the live diff tint — differ only in
 * what they build. Both must be bounded by the viewport, both must survive a
 * keystroke without being rebuilt, and both must not leave a timer behind when
 * the view goes away.
 */
abstract class IdleLayer implements PluginValue {
  decorations: DecorationSet = Decoration.none
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(protected readonly view: EditorView) {
    this.decorations = this.build(view)
  }

  update(update: ViewUpdate): void {
    // Carry what is already painted across the edit, whatever happens next:
    // without the map, every token after the caret would smear until the
    // rebuild landed.
    if (update.docChanged) this.decorations = this.decorations.map(update.changes)
    const why = this.reason(update)
    if (why === 'now') this.decorations = this.build(update.view)
    else if (why === 'later') this.defer()
  }

  /** Clears the pending rebuild. A view is destroyed on every file switch, and
   *  a timer that outlives its view is a leak that also paints a dead editor. */
  destroy(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }

  private defer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.decorations = this.build(this.view)
      // An empty transaction is how a plugin that computed something outside
      // an update cycle asks the view to read it.
      this.view.dispatch({})
    }, REPAINT_IDLE_MS)
  }

  /**
   * Whether this update calls for a rebuild, and how soon.
   *
   * `now` is for a change the reader would see as missing paint — scrolling
   * into lines nothing has coloured yet. `later` is for anything that will
   * settle: a keystroke, or a file switch, which reaches the view as two
   * transactions and is INCONSISTENT between them. Rebuilding on the first of
   * that pair is what made opening a second file cost nine seconds.
   */
  protected abstract reason(update: ViewUpdate): 'now' | 'later' | 'no'

  protected abstract build(view: EditorView): DecorationSet
}

/** The lines the view is about to show, 0-based and half-open. */
function viewportLines(view: EditorView): { from: number; to: number } {
  const doc = view.state.doc
  return {
    from: doc.lineAt(view.viewport.from).number - 1,
    to: doc.lineAt(view.viewport.to).number,
  }
}

/** Syntax colour for the viewport, from whatever painter the pane configured. */
class PaintLayer extends IdleLayer {
  protected build(view: EditorView): DecorationSet {
    const paint = view.state.facet(paintFacet)
    if (paint === null) return Decoration.none
    const doc = view.state.doc
    const lines = doc.toString().split('\n')
    const { from, to } = viewportLines(view)
    const runs = paint(lines, from, to)
    if (runs === undefined) return Decoration.none
    const marks: Array<ReturnType<typeof Decoration.mark>> = []
    const at: number[] = []
    for (let line = from; line < to && line < lines.length; line += 1) {
      // `doc.line` is 1-based, and its `from` is the absolute offset the
      // decorations need.
      const start = doc.line(line + 1).from
      for (const range of lineTokenRanges(lines[line] ?? '', start, runs[line])) {
        marks.push(Decoration.mark({ attributes: { style: styleFor(range.color, range.italic) } }))
        at.push(range.from, range.to)
      }
    }
    return Decoration.set(marks.map((mark, i) => mark.range(at[i * 2]!, at[i * 2 + 1]!)), true)
  }

  protected reason(update: ViewUpdate): 'now' | 'later' | 'no' {
    // Scrolling must paint at once: the lines are already on screen.
    if (update.viewportChanged) return 'now'
    // A new painter — another file, another theme, a grammar that finished
    // loading. The buffer it describes may not have arrived yet, so it waits.
    if (update.state.facet(paintFacet) !== update.startState.facet(paintFacet)) return 'later'
    return update.docChanged ? 'later' : 'no'
  }
}

const painter = ViewPlugin.fromClass(PaintLayer, { decorations: layer => layer.decorations })

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
 * The add/delete tint, recomputed once the typing stops.
 *
 * Arming the editor used to take the diff colours away, because the pane's
 * tints come from git's diff and git has not seen a keystroke. Watching the
 * change take shape is the reason to edit inside a diff view at all, so the
 * tint is recomputed here from the text on both sides instead.
 *
 * It is a whole-document diff, and it used to run on every transaction: 55ms
 * per keystroke at 800 lines, 709ms at 4,000. So it inherits {@link IdleLayer}
 * — the tint maps through the edit and catches up when the reader pauses.
 *
 * This diff is a READING AID. No git operation uses it: the block actions
 * still send line indices against the host's own `diffSha`-stamped patch.
 */
class TintLayer extends IdleLayer {
  protected build(view: EditorView): DecorationSet {
    return diffDecorations(view.state)
  }

  protected reason(update: ViewUpdate): 'now' | 'later' | 'no' {
    // The tint is line decorations over the whole document, so scrolling needs
    // nothing from it. What it must never do is run between the two
    // transactions a file switch arrives in.
    const sideMoved = update.transactions.some(tr => tr.effects.some(effect => effect.is(setOriginal)))
    return update.docChanged || sideMoved ? 'later' : 'no'
  }
}

const tinter = ViewPlugin.fromClass(TintLayer, { decorations: layer => layer.decorations })

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

export function CodeEditor({ value, original, onChange, paint, indent, ariaLabel, onSave, blame, notCommitted, readOnly, onBlameClick }: {
  /** The pane's buffer. The view is written to only when this really differs. */
  value: string
  /** The other side's whole text — the index side, for the unstaged layer this
   *  editor lives on. What the live tint is computed against. */
  original: string
  onChange: (next: string) => void
  /** Tokens for a range of the buffer; see {@link PaintFn}. Null paints
   *  nothing, which is what a file with no grammar gets. */
  paint: PaintFn | null
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
}): ReactNode {
  /**
   * Editable, and SAID to be editable, from one boolean.
   *
   * Nothing about rendered code looks like a field. In the Files tab this
   * editor is live the moment a file opens — no button in between — so
   * without a mark the reader learns they may type by typing, and learns
   * they may NOT by typing into a pane that swallows it. The stylesheet
   * draws a rule down the leading edge for this attribute and lights it
   * while the caret is inside.
   *
   * Derived here rather than taken as a second prop so the mark and
   * `EditorState.readOnly` below cannot disagree: a pane that shows the
   * rule and then refuses the keystroke is worse than one with no rule.
   */
  const editable = readOnly !== true
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  // Read inside CodeMirror's own callbacks, which close over the render that
  // created the view — several states old by the time a key is pressed.
  const latest = useRef({ onChange, onSave, onBlameClick })
  latest.current = { onChange, onSave, onBlameClick }
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
      paintCompartment.of(paintFacet.of(paint)),
      painter,
      blameField,
      blameCompartment.of([]),
      EditorState.readOnly.of(!editable),
      originalText.init(() => original),
      tinter,
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

  // A new painter — another file, another theme, a grammar that finished
  // loading. The plugin repaints itself from the viewport; all this has to do
  // is put the new function where it reads it from.
  useEffect(() => {
    const current = view.current
    if (current === null) return
    current.dispatch({ effects: paintCompartment.reconfigure(paintFacet.of(paint)) })
  }, [paint])

  return <div ref={host} className={css.cmHost} data-editable={editable ? '' : undefined} />
}
