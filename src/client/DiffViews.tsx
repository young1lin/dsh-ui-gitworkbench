import {
  Fragment, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode,
} from 'react'

import { attachWordRanges, gutterSides, overlayRanges, parseRows, type Row, type RowWithRanges } from './diff-model.ts'
import { CR, CR_GLYPH, splitOnCr } from './cr-mark.ts'
import { parsePatch } from '../patch-model.ts'
import { alignRows, allBlockLines, allBlockTally, blockActionsDisabled, blockCount, blockEdge, blockIsWholeFile, blockLines, blockTally, currentActionBlock, needsFirstBlockClearance, sideBodyState, type SideCell, type SideRow } from './side-rows.ts'
import { anchorFor, blockNearestTo, blockTopsFromRows, blockTopsFromSideRows, countBlocks, scrollTopFor, stepBlockIndex, unifiedBlocks } from './diff-nav.ts'
import { DIFF_GRID_PAD_TOP, DIFF_ROW_H } from './row-window.ts'
import { useChangeNav } from './use-change-nav.ts'
import {
  applySaveOk, applySides, armEdit, armRefusal, DISARMED, editableSides, isDirty, markConflict, reloadSides, resetSides,
  type EditState, type WriteResult,
} from './side-edit.ts'
import { PaneDivider } from './PaneDivider.tsx'
import { SideRails } from './SideRails.tsx'
import { CodeEditor, type PaintFn } from './CodeEditor.tsx'
import { detectIndent } from './indent.ts'
import { grammarLoadCount, highlightForRowsWindow, highlightRange, highlightWindow, shikiLangOf, shikiThemeOf, subscribeGrammarLoaded, type HighlightRun } from './highlight.ts'
import { useRowWindow } from './use-row-window.ts'
import { rowMark, useVariableRowWindow } from './use-variable-row-window.ts'
import { RowSpacer, SideCells } from './diff-cells.tsx'
import type { BlockAsk, BlockMode, FileSides, GitOpResult, SideLayer, Translate } from './git-workbench-types.ts'
import css from './GitWorkbenchPanel.module.css'

const SPLIT_MIN = 0.15
const SPLIT_MAX = 0.85
const BLOCK_BAR_CLEARANCE = 21

/**
 * Change-to-change navigation, as two chevrons.
 *
 * Bootstrap Icons again, at the same 16 viewBox — a pair of arrows is what
 * every editor spells this with, and the words would be longer than the
 * controls beside them.
 */
const NAV_GLYPH = {
  prev: 'M7.646 4.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1-.708.708L8 5.707l-5.646 5.647a.5.5 0 0 1-.708-.708l6-6z',
  next: 'M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708z',
} as const

function NavGlyph({ of }: { of: keyof typeof NAV_GLYPH }): ReactNode {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d={NAV_GLYPH[of]} />
    </svg>
  )
}

/* ---------- diff rendering: rows, word-level ranges, syntax pass ---------- */

/**
 * Render one file's unified-diff segment with word-level highlights and Shiki.
 *
 * This is what History and Compare show, and — unlike the side-by-side pane —
 * it has no row model carrying block ids, because nothing here acts on a block:
 * a commit's contents were decided long ago, so there is no staging and no
 * roll-back. The walk still needs them, so the runs are read off the row kinds
 * by `unifiedBlocks` and marked on the rows that scroll.
 *
 * The scroller is this component's own rather than the pane's. A bar that
 * scrolls away is not a control, and the pane scrolls in BOTH directions —
 * `sticky` fixes the vertical half and nothing fixes the horizontal one, since
 * a block child of a scroller is only ever as wide as the scrollport. A header
 * outside the scrolled box has neither problem.
 */
export function DiffView({ segment, path, palette, t, wrap }: {
  segment: string
  path: string
  palette: string
  t: Translate
  /** Soft wrap. Changes the pane's height model, not just its white-space:
   *  the window below is exact arithmetic while every row is one line tall,
   *  and measured once they are not. */
  wrap: boolean
}): ReactNode {
  const lang = shikiLangOf(path)
  const shikiTheme = shikiThemeOf(palette)
  const grammarGen = useSyncExternalStore(subscribeGrammarLoaded, grammarLoadCount)
  const rowsWithWords = useMemo(() => attachWordRanges(parseRows(segment)), [segment])
  const sides = useMemo(() => gutterSides(rowsWithWords), [rowsWithWords])
  const scrollRef = useRef<HTMLDivElement>(null)
  const preRef = useRef<HTMLPreElement>(null)
  // Windowed for the same reason the side-by-side pane is: a unified diff of a
  // long file put every row in the DOM and re-lexed every one of them, so
  // opening one froze the pane in exactly the same way. Two models, one live
  // at a time: exact `i * 20px` while nothing wraps, measured once it does.
  const fixed = useRowWindow(scrollRef, rowsWithWords.length, path, !wrap)
  const texts = useMemo(() => rowsWithWords.map(row => row.text), [rowsWithWords])
  const flow = useVariableRowWindow({ scrollRef, rowsRef: preRef, texts, mountKey: path, scope: 'u', enabled: wrap })
  const win = wrap ? flow.win : fixed
  const syntax = useMemo(
    () => highlightForRowsWindow(rowsWithWords, lang, shikiTheme, win.start, win.end),
    [rowsWithWords, lang, shikiTheme, win.start, win.end, grammarGen],
  )
  const blocks = useMemo(() => unifiedBlocks(rowsWithWords.map(row => row.kind)), [rowsWithWords])
  const changes = useMemo(() => countBlocks(blocks), [blocks])
  // Derived rather than measured, because a windowed pane has no element for
  // the block being walked to.
  const blocksForNav = useRef<readonly number[]>(blocks)
  blocksForNav.current = blocks
  // Same reason the blocks are held in a ref: the walk is built once, and by
  // the time it runs the pane may have been wrapped, unwrapped or re-measured.
  const placeRow = useRef<((index: number) => number) | undefined>(undefined)
  placeRow.current = wrap ? flow.rowTop : undefined
  const { goToChange } = useChangeNav(
    scrollRef,
    useCallback(
      () => blockTopsFromRows(blocksForNav.current, DIFF_ROW_H, DIFF_GRID_PAD_TOP, placeRow.current),
      [],
    ),
  )
  // Read by the key listener below, which is attached once. `goToChange` only
  // ever touches refs, but pinning it here says so rather than relying on it.
  const walk = useRef(goToChange)
  walk.current = goToChange

  // F7 / Shift+F7, the spelling IDEA's diff viewer taught, on the same element
  // that scrolls — so the key and the buttons cannot disagree about which pane
  // they move. `tabIndex` is what makes it able to receive the key at all:
  // diff text is not focusable, and a click on it would otherwise leave focus
  // on the document body.
  useEffect(() => {
    const scroller = scrollRef.current
    if (scroller === null) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'F7') return
      event.preventDefault()
      walk.current(event.shiftKey ? -1 : 1)
    }
    scroller.addEventListener('keydown', onKey)
    return () => { scroller.removeEventListener('keydown', onKey) }
  }, [])

  return (
    <div className={css.diffWrap}>
      {changes > 0 ? (
        <div className={css.diffNav}>
          <button
            type="button"
            className={css.blockBtn}
            title={t('prevChangeHint')}
            aria-label={t('prevChange')}
            onClick={() => { goToChange(-1) }}
          ><NavGlyph of="prev" /></button>
          <button
            type="button"
            className={css.blockBtn}
            title={t('nextChangeHint')}
            aria-label={t('nextChange')}
            onClick={() => { goToChange(1) }}
          ><NavGlyph of="next" /></button>
          <span className={css.sideNavCount}>{t('changeCount', { n: changes })}</span>
        </div>
      ) : null}
      <div ref={scrollRef} className={css.diffScroll} tabIndex={-1}>
    <pre ref={preRef} className={wrap ? `${css.diffPre} ${css.diffPreWrap}` : css.diffPre}>
      {win.padTop > 0 ? <div className={css.diffSpacer} style={{ height: `${win.padTop}px` }} aria-hidden="true" /> : null}
      {rowsWithWords.slice(win.start, win.end).map((row, k) => {
        const i = win.start + k
        return (
        <div key={i} className={`${css.line} ${rowClass(row.kind)}`} data-block={blocks[i]! >= 0 ? blocks[i] : undefined} {...rowMark('u', i)}>
          {sides.old ? <span className={css.lnOld}>{row.kind === 'add' || row.kind === 'hunk' ? '' : row.oldL}</span> : null}
          {sides.new ? <span className={css.lnNew}>{row.kind === 'del' || row.kind === 'hunk' ? '' : row.newL}</span> : null}
          <span className={`${css.gutter} ${row.kind === 'add' ? css.signAdd : row.kind === 'del' ? css.signDel : ''}`}>
            {row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ''}
          </span>
          <span className={css.code}>{renderCode(row, syntax[i] ?? [])}</span>
        </div>
        )
      })}
      {win.padBottom > 0 ? <div className={css.diffSpacer} style={{ height: `${win.padBottom}px` }} aria-hidden="true" /> : null}
    </pre>
      </div>
    </div>
  )
}

function rowClass(kind: Row['kind']): string {
  switch (kind) {
    case 'add': return css.lineAdd
    case 'del': return css.lineDel
    case 'hunk': return css.lineHunk
    default: return css.lineContext
  }
}

function renderCode(row: RowWithRanges, tokens: readonly HighlightRun[]): ReactNode {
  if (row.kind === 'hunk') return row.text
  const painted = overlayRanges(tokens.length > 0 ? tokens : [{ text: row.text }], row.ranges ?? [])
  // The trailing-CR marker rides AFTER everything painted: word ranges are
  // char offsets into the row text, so a mid-line glyph would shift them.
  // Mid-line CRs (a CR-only file) stay invisible here; the side pane draws those.
  const crTail = row.text.endsWith(CR)
    ? <span className={css.crMark} aria-hidden="true">{CR_GLYPH}</span>
    : null
  if (painted.length === 1 && painted[0]!.color === undefined && !painted[0]!.mark) {
    return crTail === null ? row.text : <>{row.text}{crTail}</>
  }
  return (<>
    {painted.map((tok, i) => (
      <span
        key={i}
        className={tok.mark ? (row.kind === 'add' ? css.wordAdd : css.wordDel) : undefined}
        style={tok.color === undefined && !tok.italic ? undefined : { color: tok.color, fontStyle: tok.italic ? 'italic' : undefined }}
      >{tok.text}</span>
    ))}
    {crTail}
  </>)
}

/* ---------- side-by-side diff rendering (working tree only) ---------- */

/**
 * The working tree's per-file diff as IDEA shows it: one tab per layer of the
 * index, two columns with the whole file, aligned row by row.
 *
 * The rows come from `side-rows.ts` over the layer's full-context diff, so the
 * alignment is read off the diff rather than computed. A change block — a
 * maximal run of changed rows — carries its own actions: hovering any of its
 * cells outlines the whole block and floats its buttons (stage + roll back on
 * the unstaged tab, unstage on the staged one). The click carries the block's
 * hunk-line indices and the rendered diff's sha, so the host can prove the
 * file has not changed since the pane drew it.
 *
 * The unstaged tab's right column is also EDITABLE (the staged one is not, by
 * design: editing the index would mean writing a blob with no file behind it).
 * Editing arms explicitly — never per keystroke — and the buffer's whole life
 * against the file and the poll is `side-edit.ts`'s to decide: a refresh over
 * a dirty buffer keeps the buffer, a file that moved underneath raises the
 * reload-or-overwrite banner, and the one save path carries the sha the buffer
 * is based on so the host can refuse a stale write. While editing, the layout
 * trades the diff's hole-aligned grid for a dense editor column (same
 * metrics, same gutter rhythm): one grid cannot stay diff-aligned AND hold a
 * dense buffer whenever deletions outrun additions, and re-diffing per
 * keystroke is exactly the editor-library work the first cut declines.
 *
 * `tooLarge` and `binary` fall back to the unified view the pane already had
 * (history and compare keep it unconditionally), with a notice — a silently
 * different view reads as a broken one, not a guarded one.
 */
export function SideBySideView({ t, path, palette, wrap, statsPath, fetchSides, writeChecked, scopeKey, gen, fallbackSegment, fallbackLoading, phantomListed, onBlockAction, onSaved, onDirtyChange }: {
  t: Translate
  path: string
  palette: string
  /** Soft wrap. Passed through to the editor and the unified fallback; the two
   *  aligned columns are the case it costs the most, since a row's height is
   *  whichever side wrapped further. */
  wrap: boolean
  statsPath: string | undefined
  fetchSides: (worktreePath: string | undefined, path: string, layer: SideLayer, signal: AbortSignal) => Promise<FileSides | null>
  /** Save the editor buffer; the host refuses a stale sha and nothing is written. */
  writeChecked: (worktreePath: string | undefined, path: string, text: string, expectedSha: string, signal: AbortSignal) => Promise<WriteResult | null>
  /** Names the view the fetch belongs to, as `viewKey` does for the diff cache. */
  scopeKey: string
  /** Refresh generation: a new one means the tree was re-read, so refetch. */
  gen: number
  /** The drawer's polled view of this file's HEAD-diff; a CHANGE in it means
   *  the drawer noticed the file move, so the pane refetches even between
   *  refresh generations — this is how the poll reaches a dirty buffer. */
  fallbackSegment: string
  fallbackLoading: boolean
  /** The open file is listed modified while its whole-file diff is empty —
   *  the line-ending phantom. The empty states then explain themselves
   *  instead of showing the generic "no text changes" a broken pane shows. */
  phantomListed: boolean
  /** Run one block action; a discard routes to the drawer's confirmation. */
  onBlockAction: (mode: BlockMode, ask: BlockAsk) => Promise<GitOpResult>
  /** After a successful save: refresh the tree and the pane together. */
  onSaved: () => void
  /** Reports the buffer's dirty flag outward: the drawer guards every
   *  gesture that would drop the buffer (file selection, close, main tab)
   *  on it, so it must live where those gestures are handled. */
  onDirtyChange: (dirty: boolean) => void
}): ReactNode {
  const [layer, setLayer] = useState<SideLayer>('unstaged')
  // How much of the pane the left column gets. Lives here rather than in the
  // drawer so it is one setting for the pane, and survives a file switch —
  // the reader sized the columns for how they read, not for one file.
  const [split, setSplit] = useState(0.5)
  const colsRef = useRef<HTMLDivElement>(null)
  /** The pane's one vertical scroller — what "next change" moves. */
  const scrollRef = useRef<HTMLDivElement>(null)
  /** The block currently addressed by the fixed editor toolbar. Navigation and
   *  a direct click both update it; a refreshed diff is normalized by
   *  currentActionBlock before any Git action may use it. */
  const [blockSelection, setBlockSelection] = useState({ key: '', block: 0 })
  /** Side-pane navigation follows an explicit current hunk: the fixed action
   *  buttons and the counter must target the same block even after wheel
   *  scrolling. Read mode uses aligned-row geometry; Edit uses dense right-side
   *  line geometry. Both are memoized below and read only on a navigation key. */
  const goToChange = (direction: 1 | -1): void => {
    const current = blockSelection.key === rowWindowKey ? blockSelection.block : 0
    const block = stepBlockIndex(totalBlocks, current, direction)
    if (block === null) return
    const tops = layer === 'unstaged' && edit.armed ? editorBlockTops : alignedBlockTops
    const target = tops[block]
    if (target !== undefined && scrollRef.current !== null) scrollRef.current.scrollTop = scrollTopFor(target.top)
    setBlockSelection({ key: rowWindowKey, block })
  }

  const [sides, setSides] = useState<FileSides | null>(null)
  // Set when the RPC itself failed — most plausibly a host half older than
  // this client (the two halves reload on different cycles). The unified view
  // still renders, so an old host costs the new pane, not the diff.
  const [failed, setFailed] = useState(false)
  // The block under the pointer, or null over context rows and gutters. Hover
  // names the BLOCK, not the cell: the outline and the buttons belong to a
  // whole run of rows, and a per-cell affordance would scatter them.
  const [hotBlock, setHotBlock] = useState<number | null>(null)
  // The block whose stage/unstage call is in flight, disabling its buttons.
  const [pendingBlock, setPendingBlock] = useState<number | null>(null)
  // The editable right column's state and its one save path. `saving` disables
  // the controls for the call's duration; `saveFailed` carries a non-stale
  // failure's sentence (the stale case is `edit.conflict`'s banner instead).
  const [edit, setEdit] = useState<EditState>(DISARMED)
  const [saving, setSaving] = useState(false)
  const [saveFailed, setSaveFailed] = useState<{ title: string; detail: string } | null>(null)
  // The layer a dirty-buffer tab switch is waiting on the reader to confirm.
  const [pendingLayer, setPendingLayer] = useState<SideLayer | null>(null)
  // Internal fetch generation: a stale save or the banner's reload refetch
  // without waiting for the drawer's next refresh.
  const [refetch, setRefetch] = useState(0)
  // Which edit session the fetched payload belongs to, and what a landing
  // payload may do with the buffer. The ref is read inside the fetch callback
  // (which closes over a render that may be several states old by the time the
  // answer arrives), and the adopt mode is consumed once by the next run.
  const idRef = useRef('')
  const adoptRef = useRef<'auto' | 'reload'>('auto')
  const editRef = useRef(edit)
  editRef.current = edit

  // Switching tabs refetches: the two layers are different diffs of the same
  // file, and neither is a transform of the other client-side. A change in the
  // drawer's polled segment for this file refetches too — the poll's way of
  // saying the file moved — which is what lets a change under a DIRTY buffer
  // raise the banner within one poll interval instead of at the next refresh.
  //
  // Only a NEW file/layer/scope may blank the pane and disarm the editor; a
  // refetch of the same identity keeps the current payload on screen until the
  // answer lands, because blanking it would unmount the editor mid-keystroke.
  useEffect(() => {
    const id = `${scopeKey}\x1f${path}\x1f${layer}`
    const identityChanged = idRef.current !== id
    if (identityChanged) idRef.current = id
    const adopt = identityChanged ? 'reset' : adoptRef.current
    adoptRef.current = 'auto'
    const ctrl = new AbortController()
    let alive = true
    if (identityChanged) {
      setSides(null)
      setSaveFailed(null)
      setPendingLayer(null)
    }
    if (identityChanged || !editRef.current.armed) setFailed(false)
    fetchSides(statsPath, path, layer, ctrl.signal)
      .then(value => {
        if (!alive) return
        // While armed, a failed background refetch keeps the pane as it is:
        // dropping the editor over a transient RPC failure would cost the
        // buffer's DOM (focus, IME composition) for no reader benefit.
        if (value === null) {
          if (!editRef.current.armed) setFailed(true)
          return
        }
        setSides(value)
        setEdit(prev => adopt === 'reset' ? resetSides(prev, value)
          : adopt === 'reload' ? reloadSides(prev, value)
          : applySides(prev, value))
      })
      .catch(() => { if (alive && !editRef.current.armed) setFailed(true) })
    return () => { alive = false; ctrl.abort() }
  }, [fetchSides, statsPath, path, layer, scopeKey, gen, fallbackSegment, refetch])

  const lang = shikiLangOf(path)
  const shikiTheme = shikiThemeOf(palette)
  const grammarGen = useSyncExternalStore(subscribeGrammarLoaded, grammarLoadCount)
  const rows = useMemo(() => {
    if (sides === null || sides.diff.length === 0) return []
    const file = parsePatch(sides.diff)
    // A diff with no hunk (mode-only change, or text patch-model cannot parse)
    // has no rows to align; the no-change treatment below is the honest view.
    return file === null ? [] : alignRows(file)
  }, [sides])
  /**
   * How many separate places this file changed — the count the nav walks.
   * Rows change when a diff is fetched, not when the editor buffer changes, so
   * caching here keeps the document-wide scan off the keystroke path.
   */
  const totalBlocks = useMemo(() => blockCount(rows), [rows])
  // A toolbar rises above its block's first row. Horizontally scrolling columns
  // clip overflow on both axes, so a file whose first row changed must reserve
  // that space INSIDE each column. This depends on row shape, not hover, so the
  // pointer cannot trigger a layout jump.
  const blockBarClearance = needsFirstBlockClearance(rows) ? BLOCK_BAR_CLEARANCE : 0
  const navOffset = DIFF_GRID_PAD_TOP + blockBarClearance
  const alignedBlockTops = useMemo(
    () => blockTopsFromRows(rows.map(row => row.block), DIFF_ROW_H, navOffset),
    [rows, navOffset],
  )
  const editorBlockTops = useMemo(
    () => blockTopsFromSideRows(rows, 'right', DIFF_ROW_H, navOffset),
    [rows, navOffset],
  )
  // Highlight each column as one file — a row is not a program, and lexing
  // fragments is what made the unified view paint keywords as plain text.
  //
  // These are UNDEFINED until a lazy grammar loads, and stay undefined for a
  // file whose extension has no grammar at all (`go.mod`, `Dockerfile`), so
  // every read below is optional-chained. `renderSideCode` already takes
  // `undefined` and renders the plain text for it; what crashes is indexing
  // the array itself, and `strict` is off in tsconfig, so the compiler will
  // not say so.
  // Only the rows the reader can see reach the DOM, and only they are re-lexed
  // line by line. Declared here because both the render and the highlighting
  // below are bounded by it.
  const rowWindowKey = `${scopeKey}\x1f${path}\x1f${layer}\x1f${sides?.diffSha ?? ''}`
  const alignedGridRef = useRef<HTMLDivElement>(null)
  const denseGridRef = useRef<HTMLDivElement>(null)
  // The two columns themselves, for the rails that scroll them — see
  // SideRails.tsx: each column's own scrollbar is drawn at the bottom of the
  // FILE, which is not a place a scrollbar can be used from.
  const leftColRef = useRef<HTMLDivElement>(null)
  const rightColRef = useRef<HTMLDivElement>(null)
  const fixedWin = useRowWindow(scrollRef, rows.length, rowWindowKey, !wrap)
  // The taller of a row's two sides is what the row is worth, so the estimate
  // is fed the longer of the two texts.
  const rowTexts = useMemo(
    () => rows.map(row => {
      const left = row.left?.text ?? ''
      const right = row.right?.text ?? ''
      return left.length >= right.length ? left : right
    }),
    [rows],
  )
  // Both columns, because a row is as tall as its taller side; the width is
  // read from one column, because that is what a line wraps inside.
  const flow = useVariableRowWindow({
    scrollRef, rowsRef: colsRef, widthRef: alignedGridRef,
    texts: rowTexts, mountKey: rowWindowKey, scope: 'a', enabled: wrap,
  })
  const win = wrap ? flow.win : fixedWin
  //
  // Two passes with two lifetimes. The whole-file pass runs once per file and
  // is what knows about block comments and template literals; the per-line
  // re-lex — one Shiki call each, and the reason a 4,000-line file froze the
  // pane for 2.8 seconds — runs only over the rows in the window, and so again
  // whenever the reader scrolls.
  const leftLines = useMemo(() => rows.map(row => row.left === null ? '' : row.left.text), [rows])
  const rightLines = useMemo(() => rows.map(row => row.right === null ? '' : row.right.text), [rows])
  const leftSyntax = useMemo(
    () => highlightWindow(leftLines, lang, shikiTheme, win.start, win.end),
    [leftLines, lang, shikiTheme, win.start, win.end, grammarGen],
  )
  const rightSyntax = useMemo(
    () => highlightWindow(rightLines, lang, shikiTheme, win.start, win.end),
    [rightLines, lang, shikiTheme, win.start, win.end, grammarGen],
  )

  /** The editor half of the pane, present only on the unstaged layer. */
  const editable = layer === 'unstaged' && edit.armed
  const dirty = isDirty(edit)
  // Whether this payload may enter the editor at all: text carrying \r would
  // be normalised to \n by the textarea the moment it landed, and the next
  // save would rewrite every line ending in the file. The gate lives in
  // `side-edit.ts` with the rest of the buffer's rules.
  const armable = sides !== null && editableSides(sides)
  // Which sentence the withheld editor gets: CRLF and a non-UTF-8 encoding are
  // different problems, and one message for both leaves the reader guessing
  // whether converting line endings would help.
  const refusal = sides === null ? null : armRefusal(sides)


  // The drawer guards every gesture that would drop the buffer — selecting
  // another file, closing, switching the main tab — so it needs the flag as
  // it changes, not at click time from a stale render. Reported on the FLAG
  // (not the buffer) so it fires on the transitions that matter; the cleanup
  // clears it when this pane unmounts, so no orphaned flag prompts later.
  useEffect(() => {
    onDirtyChange(dirty)
    return () => { onDirtyChange(false) }
  }, [dirty, onDirtyChange])
  // The buffer's lines and their highlight, for the editor's underlay: the
  // visible text under the transparent textarea, which is what keeps syntax
  // coloring and the caret on the same grid while typing.
  const bufferLines = useMemo(() => edit.buffer.split('\n'), [edit.buffer])
  // What Tab inserts, learned from the file rather than configured. Keyed on
  // the BASE text, not the buffer: re-detecting mid-edit would let a couple of
  // freshly typed lines redefine the unit under the reader's hands.
  const indentOfBuffer = useMemo(() => detectIndent(edit.baseText), [edit.baseText])
  // The index side as one text, which is what the editor tints against while
  // the reader types. It is the diff's own left column joined back up — every
  // row of a full-context diff carries a left cell unless the line is an
  // addition, which by definition is not on that side.
  const indexText = useMemo(() => {
    const left = rows.filter(row => row.left !== null).map(row => row.left!.text)
    return left.length === 0 ? '' : left.join('\n') + '\n'
  }, [rows])
  // The editor's buffer is a whole file, so it takes the file pass rather than
  // the diff's per-line re-lex — but only over the lines it is showing. The
  // editor asks for a range as it scrolls, and `token-cache.ts` remembers what
  // came back; a pass over the whole buffer was 1,637ms at 1,837 lines, paid
  // again every time the reader stopped typing.
  const editPaint = useMemo<PaintFn | null>(() => {
    if (lang === undefined) return null
    const key = 'buffer:' + statsPath + ':' + path
    return (lines, from, to) => highlightRange(key, lines, lang, shikiTheme, from, to)
    // `grammarGen` changes nothing computed here; the new identity is what
    // makes the editor repaint once a lazy grammar has landed.
  }, [lang, shikiTheme, statsPath, path, grammarGen])
  // The left column while editing renders dense — one row per INDEX line, no
  // holes — because the right column is now the dense buffer; a hole-aligned
  // left beside a dense right is the alignment the diff view owes, not the
  // editor. Each entry keeps its index into `rows` for its syntax tokens.
  const leftRows = useMemo(() => rows.map((row, i) => ({ row, i })).filter(entry => entry.row.left !== null), [rows])

  // Only the rows the reader can see reach the DOM. Two windows because the
  // two columns render two different row lists while the editor is armed: the
  // right side is a buffer, and the left side is then the index side DENSE,
  // one row per index line rather than one per aligned row.
  const fixedLeftWin = useRowWindow(scrollRef, leftRows.length, rowWindowKey, !wrap)
  const leftTexts = useMemo(() => leftRows.map(entry => entry.row.left?.text ?? ''), [leftRows])
  // Its own height model: the dense column's rows are the INDEX side's lines,
  // a different list from the aligned rows, so it cannot share theirs. Nothing
  // has to line up with it — the other column is a CodeMirror buffer that wraps
  // on its own — but its spacers still have to add up to what it renders.
  const leftFlow = useVariableRowWindow({
    scrollRef, rowsRef: denseGridRef,
    texts: leftTexts, mountKey: rowWindowKey, scope: 'd', enabled: wrap,
  })
  const leftWin = wrap ? leftFlow.win : fixedLeftWin

  // Arming drops the caret straight into the buffer: the click that armed the
  // editor said "I want to type here", and a second click to focus is a tax.

  /** Arm the editor from the payload on screen; the unstaged tab, and only
   *  for a payload `editableSides` accepts — armEdit itself refuses the rest,
   *  so even a stray call cannot put CRLF text into the buffer. */
  const arm = (block?: number): void => {
    if (sides === null || layer !== 'unstaged' || !editableSides(sides)) return
    const viewport = scrollRef.current === null ? 0 : anchorFor(scrollRef.current.scrollTop)
    setBlockSelection({ key: rowWindowKey, block: block ?? blockNearestTo(alignedBlockTops, viewport)?.block ?? 0 })
    setEdit(prev => armEdit(prev, sides))
  }

  /**
   * The one save path, shared by the Save button, Ctrl/Cmd+S and the banner's
   * overwrite action — they differ only in WHICH sha the host is asked to
   * check: the buffer's basis for a save, the file as it stands NOW for an
   * explicit overwrite of a concurrent writer's version.
   *
   * On success the basis moves to the sha the host read back and the drawer
   * refreshes (tree and pane together). On `stale` the banner goes up and the
   * pane refetches WITHOUT touching the buffer, so the banner's reload and
   * overwrite actions read the file's true current state. Everything else is
   * a failed save with a sentence.
   */
  const runSave = async (expectedSha: string): Promise<void> => {
    if (sides === null || !dirty || saving) return
    const savedText = edit.buffer
    // The edit session this save belongs to. A slow RPC can outlive a file or
    // layer switch, and applying THIS save's outcome to the NEXT file's edit
    // state would re-base that buffer onto text it never held — so every
    // pane-local effect below is gated on the session still being current.
    // The tree refresh on success is not: the file on disk did move.
    const session = idRef.current
    setSaving(true)
    try {
      const result = await writeChecked(statsPath, path, savedText, expectedSha, new AbortController().signal)
      const stillHere = idRef.current === session
      if (result === null) {
        if (stillHere) setSaveFailed({ title: t('saveUnavailable'), detail: '' })
      } else if (result.ok) {
        if (stillHere) {
          setSaveFailed(null)
          setEdit(prev => applySaveOk(prev, savedText, result.sha ?? ''))
        }
        onSaved()
      } else if (result.failure === 'stale') {
        if (stillHere) {
          setEdit(prev => markConflict(prev))
          setRefetch(n => n + 1)
        }
      } else {
        if (stillHere) setSaveFailed({ title: t('saveFailed'), detail: (result.error ?? '').trim() })
      }
    } finally {
      setSaving(false)
    }
  }

  /**
   * The banner's two answers to a file that moved underneath. Overwrite may
   * only run once the post-refusal refetch has landed (the fresh targetSha is
   * what the host checks the overwrite against); until then the button waits,
   * because re-sending the refused sha would just refuse again.
   */
  const canOverwrite = dirty && edit.conflict && sides !== null && sides.targetSha !== edit.baseSha
  const overwrite = (): Promise<void> => sides === null ? Promise.resolve() : runSave(sides.targetSha)
  /** Reload: the reader chose the file over the buffer; drop the edits. */
  const reload = (): void => {
    setSaveFailed(null)
    adoptRef.current = 'reload'
    setRefetch(n => n + 1)
  }
  /** Revert the buffer to its basis, in place; the conflict flag stands. */
  const revert = (): void => {
    setSaveFailed(null)
    setEdit(prev => ({ ...prev, buffer: prev.baseText }))
  }

  /**
   * A layer tab is one click away from dropping the buffer: with unsaved
   * edits the click asks first, and only the dialog's answer switches.
   */
  const switchLayer = (next: SideLayer): void => {
    if (next === layer) return
    if (dirty) {
      setPendingLayer(next)
      return
    }
    setLayer(next)
  }
  const confirmLeave = (): void => {
    const next = pendingLayer
    setPendingLayer(null)
    if (next !== null) setLayer(next)
  }

  /** Ctrl/Cmd+S inside the pane: the editor's other save affordance. */
  const onPaneKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      if (dirty && !saving) void runSave(edit.baseSha)
    }
    // F7 and Shift+F7, the spelling IDEA's diff viewer taught. Chosen over
    // Alt+Arrow because CodeMirror's default keymap binds those to moving a
    // line, and the armed editor lives inside this same pane.
    if (event.key === 'F7') {
      event.preventDefault()
      goToChange(event.shiftKey ? -1 : 1)
    }
  }

  /**
   * One bubbling hover listener turns the cell under the pointer into its
   * block id: every changed row's code cells carry `data-block`, so `closest`
   * reads the block off whatever the pointer is over — no handler per cell,
   * and a pointer over context or a gutter simply clears the hot block.
   */
  /**
   * The divider: a ratio, not a pixel width, so the columns keep their
   * proportion when the drawer itself is resized.
   *
   * Clamped well short of either edge — a column dragged to nothing looks
   * like a broken pane, and there is no affordance to drag it back out of.
   */
  const onSplitDrag = (clientX: number): void => {
    const box = colsRef.current?.getBoundingClientRect()
    if (box === undefined || box.width === 0) return
    const ratio = (clientX - box.left) / box.width
    setSplit(Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, ratio)))
  }

  const onBodyHover = (event: ReactMouseEvent<HTMLDivElement>): void => {
    const hit = (event.target as Element).closest('[data-block]')
    const id = hit === null ? null : Number(hit.getAttribute('data-block'))
    setHotBlock(prev => (prev === id ? prev : id))
  }

  const onBodySelect = (event: ReactMouseEvent<HTMLDivElement>): void => {
    const hit = (event.target as Element).closest('[data-block]')
    if (hit === null) return
    const block = Number(hit.getAttribute('data-block'))
    if (Number.isInteger(block) && block >= 0) setBlockSelection({ key: rowWindowKey, block })
  }

  /**
   * Run one block action with the coordinates of the diff on screen.
   *
   * Discard never acts from the click — the drawer opens the confirmation,
   * and the confirmed call carries this same snapshot, so a file that moved
   * underneath the dialog is refused host-side rather than re-derived from
   * whatever the poll has fetched since. Stage and unstage run now; the
   * clicked block's buttons stay disabled until the answer lands, and the
   * drawer's op lock refuses any other block click meanwhile.
   */
  const runBlock = async (mode: BlockMode, block: number): Promise<void> => {
    if (sides === null) return
    const ask: BlockAsk = {
      path, layer, diffSha: sides.diffSha,
      lines: blockLines(rows, block),
      ...blockTally(rows, block),
      wholeFile: blockIsWholeFile(rows, block),
    }
    if (mode === 'discard') {
      void onBlockAction(mode, ask)
      return
    }
    setPendingBlock(block)
    try {
      await onBlockAction(mode, ask)
    } finally {
      setPendingBlock(null)
    }
  }

  /** Unstage the complete staged layer with the same stale-sha checked patch
   * path as a hunk action. The scan happens only on this explicit click. */
  const runAllBlocks = async (mode: 'unstage'): Promise<void> => {
    if (sides === null) return
    const ask: BlockAsk = {
      path, layer, diffSha: sides.diffSha,
      lines: allBlockLines(rows),
      ...allBlockTally(rows),
      wholeFile: false,
    }
    setPendingBlock(-1)
    try {
      await onBlockAction(mode, ask)
    } finally {
      setPendingBlock(null)
    }
  }

  /** The pane the drawer had before this view existed, notice included. */
  const unifiedFallback = (): ReactNode => fallbackSegment.length > 0
    ? <DiffView segment={fallbackSegment} path={path} palette={palette} t={t} wrap={wrap} />
    : <div className={css.empty}>{fallbackLoading ? t('loadingDiff') : phantomListed ? t('phantomNotice') : t('noTextDiff')}</div>

  if (failed) return unifiedFallback()
  if (sides === null) return <div className={css.empty}>{t('loadingDiff')}</div>
  if (sides.binary) return <div className={css.empty}>{t('binaryFile')}</div>
  if (sides.tooLarge) {
    return (
      <>
        <div className={css.sideNotice}>{t('diffTooLarge')}</div>
        {unifiedFallback()}
      </>
    )
  }
  // The tabs are the pane's, not one layer's: an empty diff here (a fully
  // staged file's unstaged side, a file with nothing staged) is one click from
  // the other layer, and the Edit button still arms — the working tree is the
  // edit target even when every change in it is already staged. So the
  // no-change treatment below is a state of the BODY (`sideBodyState`), never
  // an early return for the pane: returning here is what used to blank the
  // tabs for exactly these files.
  const bodyState = sideBodyState(rows, editable)
  // The fixed toolbar exists for both layers: unstaged offers Stage/Revert,
  // staged offers Unstage. Edit changes geometry and disabled state, not the
  // existence of the escape route.
  const changes = bodyState.kind === 'empty' ? 0 : totalBlocks
  const selectedBlock = blockSelection.key === rowWindowKey ? blockSelection.block : 0
  const currentBlock = currentActionBlock(totalBlocks, bodyState.kind !== 'empty', selectedBlock)
  // The hovered block's first row hosts the action bar; a del-only block has
  // no right cell, so its bar rides the left one instead. In the editor
  // layout the left column is dense, so the bar rides its first left row.
  const hotFirst = hotBlock === null ? -1 : rows.findIndex(row => row.block === hotBlock)
  const hotFirstLeft = hotBlock === null ? -1 : leftRows.findIndex(entry => entry.row.block === hotBlock)
  // Dirty buffer, disabled block actions: a patch computed from the loaded
  // diff would land on top of edits the patch knows nothing about.
  const barDisabled = blockActionsDisabled(dirty, pendingBlock)
  const blockButtons = (block: number): ReactNode => layer === 'staged' ? (
    <button
      type="button"
      className={css.blockBtn}
      disabled={barDisabled}
      title={dirty ? t('blockActionsDirty') : undefined}
      onClick={() => { void runBlock('unstage', block) }}
    >{t('blockUnstage')}</button>
  ) : (
    <>
      <button
        type="button"
        className={css.blockBtn}
        disabled={barDisabled}
        title={dirty ? t('blockActionsDirty') : undefined}
        onClick={() => { void runBlock('stage', block) }}
      >{t('blockStage')}</button>
      <button
        type="button"
        className={`${css.blockBtn} ${css.blockBtnDanger}`}
        disabled={barDisabled}
        title={dirty ? t('blockActionsDirty') : undefined}
        onClick={() => { void runBlock('discard', block) }}
      >{t('blockDiscard')}</button>
    </>
  )
  const blockBar = (block: number): ReactNode => (
    <span className={css.blockBar} style={{ top: -BLOCK_BAR_CLEARANCE }}>
      {blockButtons(block)}
    </span>
  )
  /** Clicking the working-tree column is the arm gesture readers will try
   *  first — unless the click was really a text selection, or landed on a
   *  block button, in which case it keeps its own meaning. */
  const armFromCell = (event: ReactMouseEvent<HTMLSpanElement>): void => {
    if (edit.armed) return
    if ((event.target as Element).closest('button') !== null) return
    const selection = window.getSelection()
    if (selection !== null && !selection.isCollapsed) return
    const block = Number(event.currentTarget.dataset.block)
    arm(Number.isInteger(block) && block >= 0 ? block : undefined)
  }
  return (
    /* `tabIndex={-1}` is what makes F7 reachable. The handler below is on
       this element, so it only sees keys whose target is inside it — and
       clicking diff text, which is not focusable, otherwise leaves focus on
       the document body and the key never arrives. A negative index keeps the
       pane out of the tab order while letting a click land focus here. */
    <div className={css.sidePane} tabIndex={-1} onKeyDown={onPaneKeyDown}>
      <div className={css.sideTabs}>
        <button
          type="button"
          aria-pressed={layer === 'unstaged'}
          className={layer === 'unstaged' ? `${css.sideTab} ${css.sideTabActive}` : css.sideTab}
          onClick={() => switchLayer('unstaged')}
        >{t('tabUnstaged')}</button>
        <button
          type="button"
          aria-pressed={layer === 'staged'}
          className={layer === 'staged' ? `${css.sideTab} ${css.sideTabActive}` : css.sideTab}
          onClick={() => switchLayer('staged')}
        >{t('tabStaged')}</button>
        {/* A file whose whole delta is one line is unfindable by scrolling:
            the tint only shows once you are already looking at it. The row
            model knows where every change is, so these two say so. The count
            is the other half of the answer — "there is one place to look" is
            what stops the hunt. */}
        {changes > 0 ? (
          <span className={css.sideNav}>
            <button
              type="button"
              className={css.blockBtn}
              title={t('prevChangeHint')}
              aria-label={t('prevChange')}
              onClick={() => { goToChange(-1) }}
            ><NavGlyph of="prev" /></button>
            <button
              type="button"
              className={css.blockBtn}
              title={t('nextChangeHint')}
              aria-label={t('nextChange')}
              onClick={() => { goToChange(1) }}
            ><NavGlyph of="next" /></button>
            <span className={css.sideNavCount}>{currentBlock === null
              ? t('changeCount', { n: changes })
              : t('changePosition', { current: currentBlock + 1, total: changes })}</span>
          </span>
        ) : null}
        {currentBlock !== null ? (
          <span className={css.sideCurrentBlockActions}>
            {layer !== 'staged' || totalBlocks > 1 ? blockButtons(currentBlock) : null}
            {layer === 'staged' ? (
              <button
                type="button"
                className={css.blockBtn}
                disabled={barDisabled}
                onClick={() => { void runAllBlocks('unstage') }}
              >{t('fileUnstage')}</button>
            ) : null}
          </span>
        ) : null}
        {/* Editing arms explicitly and saves explicitly — the two halves of
            "never per keystroke". Save enables only while dirty; Revert drops
            the buffer back onto its basis without touching the file. A
            payload the CRLF gate refuses offers no Edit button at all — the
            notice below says why rather than leaving a button that does
            nothing. */}
        {layer === 'unstaged' ? (
          <span className={`${css.sideActions}${currentBlock !== null ? ` ${css.sideActionsAdjacent}` : ''}`}>
            {edit.armed ? (
              <>
                <button
                  type="button"
                  className={`${css.blockBtn}${dirty ? ` ${css.sideSaveReady}` : ''}`}
                  disabled={!dirty || saving}
                  onClick={() => { void runSave(edit.baseSha) }}
                >{t('fileSave')}</button>
                <button
                  type="button"
                  className={css.blockBtn}
                  disabled={!dirty || saving}
                  onClick={revert}
                >{t('fileRevert')}</button>
              </>
            ) : armable ? (
              <button type="button" className={css.blockBtn} onClick={() => arm()}>{t('editFile')}</button>
            ) : null}
          </span>
        ) : null}
      </div>
      {dirty ? <div className={css.sideNotice}>{t('editingNotice')}</div> : null}
      {layer === 'unstaged' && refusal !== null && !edit.armed ? <div className={css.sideNotice}>{t(refusal === 'encoding' ? 'encodingNotice' : 'crlfNotice')}</div> : null}
      {/* §4's row: the file moved underneath a dirty buffer — by the poll's
          notice or by a refused save — and the reader chooses which version
          survives. Overwrite waits for the refetch the refusal triggered, so
          it is checked against the file as it truly stands. */}
      {dirty && edit.conflict ? (
        <div className={css.sideBanner} role="alert">
          <span className={css.sideBannerTitle}>{t('staleTitle')}</span>
          <span>{t('staleBody')}</span>
          <span className={css.sideBannerActs}>
            <button type="button" className={`${css.blockBtn} ${css.blockBtnDanger}`} disabled={saving} onClick={reload}>{t('staleReload')}</button>
            <button type="button" className={css.blockBtn} disabled={!canOverwrite || saving} onClick={() => { void overwrite() }}>{t('staleOverwrite')}</button>
          </span>
        </div>
      ) : null}
      {saveFailed !== null ? (
        <div className={css.sideBanner} role="alert">
          <span className={css.sideBannerTitle}>{saveFailed.title}</span>
          {saveFailed.detail.length > 0 ? <span>{saveFailed.detail}</span> : null}
          <span className={css.sideBannerActs}>
            <button type="button" className={css.blockBtn} disabled={!dirty || saving} onClick={() => { void runSave(edit.baseSha) }}>{t('saveRetry')}</button>
          </span>
        </div>
      ) : null}
      {/* Two columns that scroll sideways independently, with a divider the
          reader can drag. One grid spanning both sides could not do this: its
          tracks are sized by the widest line in the file, so a drag moved
          nothing on exactly the wide files where the space matters. Vertical
          alignment survives the split because both columns render one row per
          aligned row at the same line height — the diff decides the rows, the
          layout only decides how much width each side gets. */}
      <div ref={scrollRef} className={css.sideScroll}>
      {bodyState.kind === 'empty' ? (
        <div className={css.empty}>{phantomListed ? t('phantomNotice') : t('noTextDiff')}</div>
      ) : (
      <>
      <div
        ref={colsRef}
        className={css.sideCols}
        onMouseOver={onBodyHover}
        onMouseDown={onBodySelect}
        onMouseLeave={() => { setHotBlock(null) }}
      >
        <div ref={leftColRef} className={wrap ? `${css.sideCol} ${css.sideColWrap}` : css.sideCol} style={{ flexBasis: `${split * 100}%`, paddingTop: blockBarClearance }}>
          <div
            ref={bodyState.kind === 'editor' ? denseGridRef : alignedGridRef}
            className={wrap ? `${css.sideColGrid} ${css.sideColGridWrap}` : css.sideColGrid}
          >
            {bodyState.kind === 'editor' ? (
              /* While armed the left column renders the index side DENSE —
                 one row per index line, no diff holes — because the right
                 column is a buffer whose line count diverges from the diff
                 the moment a keystroke lands. */
              <>
              <RowSpacer height={leftWin.padTop} />
              {leftRows.slice(leftWin.start, leftWin.end).map((entry, kk) => {
                const k = leftWin.start + kk
                const { row, i } = entry
                const hot = hotBlock !== null && row.block === hotBlock
                return (
                  <SideCells
                    key={`l${i}`}
                    row={row} side="left" index={i} rows={rows}
                    current={row.block >= 0 && row.block === currentBlock}
                    tokens={leftSyntax?.[i]}
                    // Marked by its DENSE index: this column's rows are the
                    // index side's lines, not the aligned ones. Nothing to
                    // impose a height for — the buffer beside it wraps itself.
                    mark={wrap ? rowMark('d', k) : undefined}
                    bar={hot && k === hotFirstLeft ? blockBar(row.block) : null}
                  />
                )
              })}
              <RowSpacer height={leftWin.padBottom} />
              </>
            ) : (
              <>
              <RowSpacer height={win.padTop} />
              {rows.slice(win.start, win.end).map((row, k) => {
                const i = win.start + k
                const hot = hotBlock !== null && row.block === hotBlock
                return (
                  <SideCells
                    key={i}
                    row={row} side="left" index={i} rows={rows}
                    current={row.block >= 0 && row.block === currentBlock}
                    tokens={leftSyntax?.[i]}
                    mark={wrap ? rowMark('a', i) : undefined}
                    minHeight={wrap ? flow.rowHeight(i) : undefined}
                    // The block's action bar rides in this column only for a
                    // row with no right-hand side — a pure deletion, where the
                    // right column has no cell to hang it on.
                    bar={hot && i === hotFirst && row.right === null ? blockBar(row.block) : null}
                  />
                )
              })}
              <RowSpacer height={win.padBottom} />
              </>
            )}
          </div>
        </div>
        <PaneDivider label={t('resizeSides')} onDrag={onSplitDrag} />
        <div
          ref={rightColRef}
          className={wrap ? `${css.sideCol} ${css.sideColRight} ${css.sideColWrap}` : `${css.sideCol} ${css.sideColRight}`}
          style={{ paddingTop: blockBarClearance }}
        >
          {bodyState.kind === 'editor' ? (
            <CodeEditor
              value={edit.buffer}
              original={indexText}
              onChange={next => { setEdit(prev => ({ ...prev, buffer: next })) }}
              paint={editPaint}
              indent={indentOfBuffer}
              ariaLabel={path}
              onSave={() => { if (dirty && !saving) void runSave(edit.baseSha) }}
              wrap={wrap}
            />
          ) : (
            <div className={wrap ? `${css.sideColGrid} ${css.sideColGridWrap}` : css.sideColGrid}>
              <RowSpacer height={win.padTop} />
              {rows.slice(win.start, win.end).map((row, k) => {
                const i = win.start + k
                const hot = hotBlock !== null && row.block === hotBlock
                return (
                  <SideCells
                    key={i}
                    row={row} side="right" index={i} rows={rows}
                    current={row.block >= 0 && row.block === currentBlock}
                    tokens={rightSyntax?.[i]}
                    mark={wrap ? rowMark('a', i) : undefined}
                    minHeight={wrap ? flow.rowHeight(i) : undefined}
                    bar={hot && i === hotFirst && row.right !== null ? blockBar(row.block) : null}
                    armable={layer === 'unstaged' && armable}
                    onArm={layer === 'unstaged' && armable ? armFromCell : undefined}
                  />
                )
              })}
              <RowSpacer height={win.padBottom} />
            </div>
          )}
        </div>
      </div>
      <SideRails leftRef={leftColRef} rightRef={rightColRef} split={split} />
      </>
      )}
      </div>
      {pendingLayer !== null ? (
        <LeaveEditsConfirm t={t} path={path} onCancel={() => { setPendingLayer(null) }} onConfirm={confirmLeave} />
      ) : null}
    </div>
  )
}

/**
 * The unsaved-edits guard, rendered at both sites that defer a gesture on the
 * buffer's answer: the pane's layer-tab switch, and the drawer level (file
 * selection, main tab, source switch, close) for every gesture that would
 * drop the buffer. Same reason as the roll-back confirmation — the click it
 * answers to is one gesture away from losing work. Cancel holds the initial
 * focus and Escape closes, because the default answer to losing edits is no.
 */
export function LeaveEditsConfirm({ t, path, onCancel, onConfirm }: {
  t: Translate
  path: string
  onCancel: () => void
  onConfirm: () => void
}): ReactNode {
  const stayRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { stayRef.current?.focus() }, [])
  useEffect(() => {
    // Capture phase, like the roll-back dialog: while a question about edits
    // is open, Escape answers it and nothing else — consumed here, before it
    // can reach the page's other Escape handlers (an open picker's dismiss,
    // the commit box's undo).
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onCancel()
    }
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('keydown', onKey, true) }
  }, [onCancel])
  return (
    <div className={css.confirmScrim} onClick={onCancel}>
      <div
        className={css.confirmBox}
        role="alertdialog"
        aria-modal="true"
        aria-label={t('unsavedTitle')}
        onClick={event => event.stopPropagation()}
      >
        <div className={css.confirmTitle}>{t('unsavedTitle')}</div>
        <div className={css.confirmBody}>{t('unsavedBody', { path })}</div>
        <div className={css.confirmActions}>
          <button ref={stayRef} type="button" className={css.btn} onClick={onCancel}>{t('unsavedStay')}</button>
          <button type="button" className={`${css.btn} ${css.btnDanger}`} onClick={onConfirm}>{t('unsavedLeave')}</button>
        </div>
      </div>
    </div>
  )
}
