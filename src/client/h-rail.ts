/**
 * Where a side-by-side column's horizontal scrollbar belongs.
 *
 * The pane scrolls vertically; each column scrolls horizontally on its own,
 * which is what lets the divider mean something (one grid across both sides is
 * sized by the widest line in the file, so dragging it moves nothing). The
 * cost of that split is where the browser draws the column's scrollbar: at the
 * bottom of the COLUMN, and the column is as tall as the file. On a
 * two-thousand-line diff the only way to reach the control that scrolls
 * sideways was to scroll all the way down first — and then scroll back up to
 * see what it did.
 *
 * So the column's own scrollbar is hidden and a rail is stuck to the bottom of
 * the pane instead, one per column, each a real scroller whose content is
 * exactly as wide as its column's. Same geometry, so the two scroll positions
 * map one to one; native, so it looks and behaves like every other scrollbar
 * on the machine.
 *
 * This module is the part with no DOM in it: when a rail is warranted at all.
 *
 * @module @young1lin/dsh-ui-gitworkbench/client/h-rail
 */

/** A column's visible width and the width of what is inside it. */
export interface RailMetric {
  /** The column's client width — what the reader can see at once. */
  readonly view: number
  /** The column's scroll width — how wide the widest row made it. */
  readonly content: number
}

/** Before anything has been measured, and for a column that is not mounted. */
export const NO_RAIL: RailMetric = { view: 0, content: 0 }

/**
 * Whether a column overflows by enough to be worth a scrollbar.
 *
 * The one-pixel slack is not tidiness: a grid track rounds to a fraction, so a
 * column whose longest line exactly fits still reports a scroll width a third
 * of a pixel wider than its client width. Without the slack every file gets a
 * rail, and every one of those rails scrolls nowhere.
 *
 * @param metric - the column's measured widths.
 * @returns true when a rail should be shown for it.
 */
export function railNeeded(metric: RailMetric): boolean {
  const { view, content } = metric
  if (!Number.isFinite(view) || !Number.isFinite(content)) return false
  if (view <= 0) return false
  return content > view + 1
}

/** Whether the rail row is shown at all — either column overflowing is enough,
 *  since the row is one sticky strip and a lone rail still needs its space. */
export function railsShown(left: RailMetric, right: RailMetric): boolean {
  return railNeeded(left) || railNeeded(right)
}

/**
 * Whether two measurements are the same.
 *
 * The measuring effect runs on every render, so this is what keeps it from
 * setting state on every render and rendering again forever.
 *
 * @param a - the measurement held in state.
 * @param b - the one just read from the DOM.
 */
export function sameMetric(a: RailMetric, b: RailMetric): boolean {
  return a.view === b.view && a.content === b.content
}
