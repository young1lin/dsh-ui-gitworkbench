/**
 * Which rows a long diff actually has to put in the DOM.
 *
 * The side-by-side pane renders the WHOLE file in two columns, so its cost is
 * linear in the file's length rather than in the size of the change. Measured
 * on two files with one changed line each: 22 lines cost 349ms of main thread
 * and 44 cells; 4,000 lines cost 3,868ms, 8,000 cells and 112,000 token spans,
 * with a single 3.6-second frame during which nothing on the page moved. The
 * guard lets a file through at 20,000 lines, which is five times that again.
 *
 * Windowing is exact here rather than approximate, because the pane's rows are
 * a fixed height by construction: `.sideCode` is `white-space: pre` so no line
 * ever wraps, and `.sideColGrid` sets `line-height` and `align-content: start`,
 * which puts row `i` at `i * rowH` with no measuring at all.
 *
 * Pure: no React, no DOM. `tests/row-window.test.ts` loads it directly.
 *
 * @module @young1lin/dsh-ui-gitworkbench/client/row-window
 */

/** The pane's row height, matching `.sideColGrid`'s `line-height`. */
export const DIFF_ROW_H = 20

/**
 * The grid's own top padding, from `.sideColGrid`.
 *
 * Only the change walk uses it, and only to place a block within the scrolled
 * content. Being a few pixels out there is invisible — the walk deliberately
 * leaves three rows of context above whatever it lands on, so this is well
 * inside the margin it already keeps — which is why it is stated once here
 * rather than published into the stylesheet as a custom property.
 */
export const DIFF_GRID_PAD_TOP = 8

/**
 * Files at or below this many rows are rendered whole.
 *
 * Windowing has its own costs — a scroll listener, two spacers, and rows that
 * enter and leave the DOM — and none of them buys anything on a file that was
 * never slow. Below the threshold the pane produces exactly the DOM it
 * produced before, so the ordinary case is untouched by this change.
 */
export const WINDOW_WHOLE_BELOW = 400

/**
 * Rows kept beyond each edge of the viewport.
 *
 * Enough that a flick of the wheel lands on rows that are already there:
 * dropping this to zero makes a fast scroll show blank bands, and raising it
 * far just renders the file again.
 */
export const WINDOW_OVERSCAN = 40

/**
 * A viewport height to assume before the scroller has been measured.
 *
 * The first paint happens before any layout effect runs. Rendering nothing
 * until the height is known would flash an empty pane; a screenful is both
 * safe and close.
 */
const ASSUMED_VIEWPORT_PX = 1200

/** The rows to render, and the empty space standing in for the rest. */
export interface RowWindow {
  /** First row to render. */
  readonly start: number
  /** One past the last row to render. */
  readonly end: number
  /** Height of the spacer above, in px. */
  readonly padTop: number
  /** Height of the spacer below, in px. */
  readonly padBottom: number
}

/**
 * @param value - a number from the DOM, which can be NaN or negative.
 * @param fallback - used when it is neither finite nor usable.
 * @returns a finite, non-negative number.
 */
function sane(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

/**
 * The window of rows to render for a given scroll position.
 *
 * @param scrollTop - the scroller's current offset in px.
 * @param viewportH - the scroller's visible height in px; 0 before it is measured.
 * @param rowCount - how many rows the file has.
 * @param rowH - row height in px.
 * @param overscan - rows to keep beyond each edge.
 * @returns the rows to render and the spacer heights standing in for the rest.
 */
export function rowWindow(
  scrollTop: number,
  viewportH: number,
  rowCount: number,
  rowH: number = DIFF_ROW_H,
  overscan: number = WINDOW_OVERSCAN,
): RowWindow {
  const rows = Math.max(0, Math.trunc(rowCount))
  const height = sane(rowH, DIFF_ROW_H)
  if (rows <= WINDOW_WHOLE_BELOW) return { start: 0, end: rows, padTop: 0, padBottom: 0 }

  const top = Number.isFinite(scrollTop) && scrollTop > 0 ? scrollTop : 0
  const view = sane(viewportH, ASSUMED_VIEWPORT_PX)
  const pad = Math.max(0, Math.trunc(overscan))

  const first = Math.max(0, Math.floor(top / height) - pad)
  const last = Math.min(rows, Math.ceil((top + view) / height) + pad)
  // Scrolled past the end (a file that shrank under a live poll), `last` can
  // land below `first`; an empty window is still a valid answer, and the
  // spacers must add up to the full height either way.
  const start = Math.min(first, rows)
  const end = Math.max(start, last)
  return { start, end, padTop: start * height, padBottom: (rows - end) * height }
}

/**
 * Where a row sits inside the scroller, without touching the DOM.
 *
 * The change walk used to measure this off `getBoundingClientRect`, which
 * stops working the moment a row it wants is outside the window — and a
 * windowed pane's next change is very often exactly that.
 *
 * @param index - the row's index.
 * @param rowH - row height in px.
 * @returns the row's offset from the top of the scrolled content.
 */
export function rowTop(index: number, rowH: number = DIFF_ROW_H): number {
  return Math.max(0, Math.trunc(index)) * sane(rowH, DIFF_ROW_H)
}
