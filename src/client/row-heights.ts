/**
 * Row offsets when the rows are NOT all the same height — what soft wrap makes
 * of a diff pane.
 *
 * `row-window.ts` places row `i` at `i * 20px` with no measuring at all, and
 * says so: the panes guarantee it by writing `white-space: pre`, so nothing
 * ever wraps. Turn wrapping on and that guarantee is gone — one row can be
 * five lines tall — and every number the window computes from it (which rows
 * are visible, how tall the spacers are, where a change sits) is wrong.
 *
 * The replacement keeps the same shape and the same rule: work proportional to
 * the VIEWPORT. Heights are MEASURED, but only for rows that are actually in
 * the DOM, which is the window plus its overscan; every other row carries an
 * estimate computed from its text. So a 20,000-row file costs one array and
 * some arithmetic, not 20,000 measurements.
 *
 * The prefix sums are a Fenwick tree rather than a running array, because both
 * things this is asked for happen on the scroll path and must not be linear:
 * "where does row i start" is a prefix query, "which row is at y" is a search
 * for a prefix, and a measurement that lands changes one row's height. All
 * three are O(log n) here; as a plain array of running totals, the third would
 * rewrite every entry after the row that moved.
 *
 * Pure: no React, no DOM. `tests/row-heights.test.ts` loads it directly.
 *
 * @module @young1lin/dsh-ui-gitworkbench/client/row-heights
 */

import { WINDOW_OVERSCAN, WINDOW_WHOLE_BELOW, type RowWindow } from './row-window.ts'

/** A viewport height to assume before the scroller has been measured, matching
 *  `row-window.ts`: rendering nothing until the height is known flashes an
 *  empty pane, and a screenful is both safe and close. */
const ASSUMED_VIEWPORT_PX = 1200

/**
 * How many display columns a line occupies.
 *
 * Only for the ESTIMATE of rows nobody has measured, so it does not have to
 * agree with the browser to the character — it has to be close enough that
 * the scrollbar is the right length and a jump to the middle of the file lands
 * near where it should. Tabs advance to the next stop (`tab-size: 4` in the
 * panes' grid) and full-width characters take two columns, which are the two
 * ways a naive `text.length` is badly wrong rather than slightly wrong.
 *
 * @param text - one row's text.
 * @param tabSize - columns a tab advances to the next multiple of.
 */
export function displayColumns(text: string, tabSize = 4): number {
  let columns = 0
  for (const char of text) {
    if (char === '\t') {
      columns += tabSize - (columns % tabSize)
      continue
    }
    columns += isWide(char) ? 2 : 1
  }
  return columns
}

/**
 * Whether a character takes two columns in a monospace font: CJK, Hangul,
 * kana, the full-width forms, and the emoji blocks. The ranges rather than a
 * table because this runs over a file's worth of text and the answer only
 * feeds an estimate.
 */
function isWide(char: string): boolean {
  const code = char.codePointAt(0) ?? 0
  return (code >= 0x1100 && code <= 0x115f)
    || (code >= 0x2e80 && code <= 0xa4cf)
    || (code >= 0xac00 && code <= 0xd7a3)
    || (code >= 0xf900 && code <= 0xfaff)
    || (code >= 0xfe30 && code <= 0xfe6f)
    || (code >= 0xff00 && code <= 0xff60)
    || (code >= 0xffe0 && code <= 0xffe6)
    || (code >= 0x1f300 && code <= 0x1f9ff)
}

/**
 * The height a row is guessed to have before it has been measured.
 *
 * @param text - the row's text.
 * @param columns - how many columns fit across the pane; 0 or less means the
 *                  pane has not been measured yet, and one line is assumed.
 * @param rowH - one line's height in px.
 */
export function estimateRowHeight(text: string, columns: number, rowH: number): number {
  if (!Number.isFinite(columns) || columns <= 0) return rowH
  return Math.max(1, Math.ceil(displayColumns(text) / columns)) * rowH
}

/**
 * Per-row heights with O(log n) offsets, backed by a Fenwick tree.
 *
 * Bounded by construction: two arrays of `rowCount`, which the panes already
 * cap. {@link measured} reports how much of it is real rather than guessed, so
 * a test can prove the measuring stays viewport-sized instead of trusting it.
 */
export class RowHeights {
  /** Each row's height. */
  private readonly heights: Float64Array
  /** Fenwick sums, 1-based; `tree[i]` covers a block ending at row `i - 1`. */
  private readonly tree: Float64Array
  /** Rows whose height came from the DOM rather than from an estimate. */
  private readonly real: Uint8Array
  private realCount = 0

  /**
   * @param initial - each row's starting height, normally an estimate.
   */
  constructor(initial: readonly number[]) {
    const n = initial.length
    this.heights = new Float64Array(n)
    this.tree = new Float64Array(n + 1)
    this.real = new Uint8Array(n)
    for (let i = 0; i < n; i += 1) this.heights[i] = sane(initial[i]!)
    // Build in O(n): each node adds its own total into its parent.
    for (let i = 1; i <= n; i += 1) {
      this.tree[i]! += this.heights[i - 1]!
      const parent = i + (i & -i)
      if (parent <= n) this.tree[parent]! += this.tree[i]!
    }
  }

  /** How many rows there are. */
  get count(): number { return this.heights.length }

  /** How many rows carry a measured height rather than an estimate. */
  measured(): number { return this.realCount }

  /**
   * Record one row's real height.
   * @returns whether anything moved, so a caller can avoid a re-render.
   */
  set(index: number, px: number): boolean {
    if (!Number.isInteger(index) || index < 0 || index >= this.count) return false
    const next = sane(px)
    if (this.real[index] === 0) {
      this.real[index] = 1
      this.realCount += 1
    }
    const delta = next - this.heights[index]!
    if (delta === 0) return false
    this.heights[index] = next
    for (let i = index + 1; i <= this.count; i += i & -i) this.tree[i]! += delta
    return true
  }

  /** One row's height. */
  heightAt(index: number): number {
    if (index < 0 || index >= this.count) return 0
    return this.heights[index]!
  }

  /** Where a row starts, measured from the top of the scrolled content. */
  topAt(index: number): number {
    let sum = 0
    for (let i = Math.max(0, Math.min(index, this.count)); i > 0; i -= i & -i) sum += this.tree[i]!
    return sum
  }

  /** Every row's height together. */
  total(): number { return this.topAt(this.count) }

  /**
   * The row that contains `y`, by binary lifting over the tree — the same
   * search a running-totals array would do, without the array.
   */
  rowAt(y: number): number {
    if (this.count === 0) return 0
    let remaining = Number.isFinite(y) && y > 0 ? y : 0
    let index = 0
    let step = 1
    while (step * 2 <= this.count) step *= 2
    for (; step > 0; step = Math.floor(step / 2)) {
      const probe = index + step
      if (probe <= this.count && this.tree[probe]! <= remaining) {
        remaining -= this.tree[probe]!
        index = probe
      }
    }
    return Math.min(index, this.count - 1)
  }
}

/** @param value - a number from the DOM, which can be NaN or negative. */
function sane(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0
}

/**
 * The window of rows to render when the rows are not all one height.
 *
 * Same answer shape as {@link rowWindow}, and the same short-circuit below
 * {@link WINDOW_WHOLE_BELOW}: windowing has costs of its own, and a file that
 * was never slow should render exactly as it did before.
 *
 * @param scrollTop - the scroller's current offset in px.
 * @param viewportH - the scroller's visible height in px; 0 before measuring.
 * @param heights - the rows' heights.
 * @param overscan - rows to keep beyond each edge.
 */
export function variableRowWindow(
  scrollTop: number,
  viewportH: number,
  heights: RowHeights,
  overscan: number = WINDOW_OVERSCAN,
): RowWindow {
  const rows = heights.count
  if (rows <= WINDOW_WHOLE_BELOW) return { start: 0, end: rows, padTop: 0, padBottom: 0 }

  const top = Number.isFinite(scrollTop) && scrollTop > 0 ? scrollTop : 0
  const view = Number.isFinite(viewportH) && viewportH > 0 ? viewportH : ASSUMED_VIEWPORT_PX
  const pad = Math.max(0, Math.trunc(overscan))

  const start = Math.max(0, heights.rowAt(top) - pad)
  const end = Math.min(rows, heights.rowAt(top + view) + 1 + pad)
  const safeEnd = Math.max(start, end)
  return {
    start,
    end: safeEnd,
    padTop: heights.topAt(start),
    padBottom: Math.max(0, heights.total() - heights.topAt(safeEnd)),
  }
}
