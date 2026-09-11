/**
 * The two diff panes' leaf cells: what one row's boxes are called and what
 * goes inside them — the side-by-side pane's four, and the unified pane's
 * one painted code span.
 *
 * Split out of `DiffViews.tsx` because that file holds two whole views and a
 * module the reviewer cannot hold in their head is the thing the size guard in
 * `tests/panel-modules.test.ts` exists to prevent. Nothing here decides
 * anything — every function takes a row and returns a class or a fragment —
 * which is exactly the part of the view that reads better away from the state
 * it is rendered from.
 *
 * @module @young1lin/dsh-ui-gitworkbench/client/diff-cells
 */

import type { MouseEventHandler, ReactNode } from 'react'

import css from './GitWorkbenchPanel.module.css'
import { CR, CR_GLYPH, splitOnCr } from './cr-mark.ts'
import { blockEdge, type SideCell, type SideRow } from './side-rows.ts'
import { overlayRanges, type Row, type RowWithRanges } from './diff-model.ts'
import { overlayHits, type HitTok } from './diff-find.ts'
import type { HighlightRun } from './highlight.ts'

/** Classes that paint only a block's OUTER perimeter. Internal rows carry the
 * vertical edges but no top/bottom line, avoiding the blue ladder a large
 * addition block used to draw. Absent side-cells return no class at all. */
export function blockHotClass(rows: readonly SideRow[], index: number, side: 'left' | 'right', hot: boolean): string {
  if (!hot) return ''
  const edge = blockEdge(rows, index, side)
  if (edge === null) return ''
  const first = edge === 'first' || edge === 'single' ? ` ${css.sideBlockHotFirst}` : ''
  const last = edge === 'last' || edge === 'single' ? ` ${css.sideBlockHotLast}` : ''
  return ` ${css.sideBlockHot}${first}${last}`
}

/** Line-number cell class: a PRESENT cell of a changed row carries its side's
 *  tint into the gutter; an absent one stays blank, the way a split diff shows
 *  a one-sided change with an empty opposite pane rather than a tinted void. */
export function sideNumClass(row: SideRow, side: 'left' | 'right'): string {
  const cell = side === 'left' ? row.left : row.right
  if (cell === null || row.kind === 'same') return css.sideNum
  return `${css.sideNum} ${side === 'left' ? css.sideNumDel : css.sideNumAdd}`
}

/** Code cell class: deletions tint left, additions right, context stays quiet. */
export function sideCodeClass(row: SideRow, side: 'left' | 'right'): string {
  const cell = side === 'left' ? row.left : row.right
  if (cell === null || row.kind === 'same') return css.sideCodeSame
  return `${side === 'left' ? css.sideCodeDel : css.sideCodeAdd} ${css.sideCellBlock}`
}

/** One text with every carriage return drawn as the CR glyph. No CR means
 * the text comes back untouched — the common line, on both sides, costs one
 * `includes`. The glyph spans are aria-hidden and unselectable, so copying a
 * line copies code, not markers. */
export function renderWithCrMarks(text: string): ReactNode {
  const parts = splitOnCr(text)
  if (parts.length === 1) return text
  const out: ReactNode[] = [parts[0]!]
  for (let i = 1; i < parts.length; i += 1) {
    out.push(<span key={`cr${i}`} className={css.crMark} aria-hidden="true">{CR_GLYPH}</span>)
    out.push(parts[i]!)
  }
  return out
}

/** One cell's Shiki runs, or its plain text when no tokens exist; either way
 * each carriage return in the cell is drawn, so a line whose only change is
 * its ending shows the difference instead of two identical-looking cells. */
export function renderSideCode(cell: SideCell | null, tokens: readonly HighlightRun[] | undefined): ReactNode {
  if (cell === null) return ''
  if (tokens === undefined || tokens.length === 0) return renderWithCrMarks(cell.text)
  if (tokens.length === 1 && tokens[0]!.color === undefined && !tokens[0]!.italic) return renderWithCrMarks(cell.text)
  return tokens.map((tok, i) => (
    <span
      key={i}
      style={tok.color === undefined && !tok.italic ? undefined : { color: tok.color, fontStyle: tok.italic ? 'italic' : undefined }}
    >{renderWithCrMarks(tok.text)}</span>
  ))
}



/**
 * The spacer standing in for the rows above or below the window.
 *
 * It spans every column of the grid, so a blame gutter does not change it.
 * @param height - px of rows it stands in for; nothing is rendered for 0.
 */
export function RowSpacer({ height }: { height: number }): ReactNode {
  if (height <= 0) return null
  return <span className={css.sideSpacer} style={{ height: `${height}px` }} aria-hidden="true" />
}

/**
 * One side of one aligned row: its line-number cell and its code cell.
 *
 * Written once and used by all three columns the pane draws — the left side of
 * a diff, the right side, and the dense index column beside the editor —
 * because the three differ only in which cell they read, what hangs the block
 * bar and whether a click arms the editor. Everything else about them, from
 * the block outline to the CR markers, is the same in all three and was
 * previously the same three times.
 */
export function SideCells({ row, side, index, rows, current, tokens, mark, minHeight, bar, armable, onArm }: {
  row: SideRow
  side: 'left' | 'right'
  /** Index into `rows`, which is what the block outline keys on. */
  index: number
  rows: readonly SideRow[]
  /** Whether this row belongs to the block the change walk is standing on. */
  current: boolean
  tokens: readonly HighlightRun[] | undefined
  /**
   * What marks this cell for measurement ({@link rowMark}), or undefined for
   * "do not measure".
   *
   * The measured element is INSIDE the cell rather than the cell itself,
   * because the cell carries the imposed `minHeight` below: measuring it would
   * read back what was imposed, and a row that grew for a narrow pane could
   * never shrink again when the pane was widened.
   */
  mark?: Record<string, string>
  /** Imposed so both sides of a wrapped row stand the same height. */
  minHeight?: number
  bar?: ReactNode
  /** The working-tree column, whose cells arm the editor when clicked. */
  armable?: boolean
  onArm?: MouseEventHandler<HTMLElement>
}): ReactNode {
  const hot = blockHotClass(rows, index, side, current)
  const cell = side === 'left' ? row.left : row.right
  const code = renderSideCode(cell, tokens)
  const box = minHeight !== undefined && minHeight > 0 ? { minHeight: `${minHeight}px` } : undefined
  return (
    <>
      <span className={`${sideNumClass(row, side)}${hot}`} style={box}>{cell === null ? '' : cell.line}</span>
      <span
        className={`${css.sideCode} ${sideCodeClass(row, side)}${hot}${armable === true ? ` ${css.sideArmable}` : ''}`}
        style={box}
        data-block={cell !== null && row.block >= 0 ? row.block : undefined}
        onClick={onArm}
      >
        {mark === undefined ? code : <span className={css.sideFlow} {...mark}>{code}</span>}
        {bar}
      </span>
    </>
  )
}

/* ---------- the unified pane's rows (history and compare) ---------- */

/** No find hits on a row — one shared empty list, so a row with none keeps a
 *  stable prop identity. */
export const NO_RANGES: readonly (readonly [number, number])[] = []

export function unifiedRowClass(kind: Row['kind']): string {
  switch (kind) {
    case 'add': return css.lineAdd
    case 'del': return css.lineDel
    case 'hunk': return css.lineHunk
    default: return css.lineContext
  }
}

export function renderUnifiedCode(
  row: RowWithRanges,
  tokens: readonly HighlightRun[],
  hits: readonly (readonly [number, number])[],
  currentCol: number | null,
): ReactNode {
  // A hunk header is searchable too — it names the function the hunk is in —
  // so it takes the hit overlay even though it takes no syntax.
  const base = row.kind === 'hunk'
    ? overlayRanges([{ text: row.text }], [])
    : overlayRanges(tokens.length > 0 ? tokens : [{ text: row.text }], row.ranges ?? [])
  const painted = overlayHits(base, hits, currentCol)
  // The trailing-CR marker rides AFTER everything painted: word ranges are
  // char offsets into the row text, so a mid-line glyph would shift them.
  // Mid-line CRs (a CR-only file) stay invisible here; the side pane draws those.
  const crTail = row.kind !== 'hunk' && row.text.endsWith(CR)
    ? <span className={css.crMark} aria-hidden="true">{CR_GLYPH}</span>
    : null
  if (painted.length === 1 && painted[0]!.color === undefined && !painted[0]!.mark && painted[0]!.hit === 0) {
    return crTail === null ? row.text : <>{row.text}{crTail}</>
  }
  return (<>
    {painted.map((tok, i) => (
      <span
        key={i}
        className={tokClass(row.kind, tok)}
        style={tok.color === undefined && !tok.italic ? undefined : { color: tok.color, fontStyle: tok.italic ? 'italic' : undefined }}
      >{tok.text}</span>
    ))}
    {crTail}
  </>)
}

/** A token's classes: the word-change tint, the find hit, both, or neither. */
function tokClass(kind: Row['kind'], tok: HitTok): string | undefined {
  const word = tok.mark ? (kind === 'add' ? css.wordAdd : css.wordDel) : undefined
  const hit = tok.hit === 2 ? css.findHitCurrent : tok.hit === 1 ? css.findHit : undefined
  return word === undefined ? hit : hit === undefined ? word : `${word} ${hit}`
}
