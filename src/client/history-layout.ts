/**
 * Which way the History tab arranges its panes.
 *
 * Two arrangements, kept because they are good at different things and the
 * drawer's width is fixed, so neither wins outright.
 *
 * `columns` puts the commit list beside the tree and the diff. The list is then
 * as tall as the drawer, which is what makes a log scannable — but it is a 26%
 * column, and measured on a 1700px drawer that left about 420px, enough for a
 * subject of roughly forty characters before the ellipsis.
 *
 * `stacked` spans the list across the top instead, the way IDEA's git log does.
 * No subject is cut and thirty rows fit where the column fitted thirteen, at
 * the cost of the height the diff below it would otherwise have had.
 */
export type HistoryLayout = 'columns' | 'stacked'

/** Every layout, in the order the switch offers them. */
export const HISTORY_LAYOUTS: readonly HistoryLayout[] = ['columns', 'stacked']

/** The arrangement the tab had first, and what a reader who never touches the
 *  switch gets. */
export const DEFAULT_HISTORY_LAYOUT: HistoryLayout = 'columns'

/**
 * Narrow a stored value to a layout this build has.
 *
 * Storage is a durable boundary: the value on disk was written by whatever
 * build the reader ran last, and a layout this one has since dropped must fall
 * back rather than reach the stylesheet.
 * @param value - value read back from storage.
 * @returns whether it names a layout.
 */
export function isHistoryLayout(value: unknown): value is HistoryLayout {
  return HISTORY_LAYOUTS.some(known => known === value)
}

/**
 * How tall one commit row is, per layout.
 *
 * The two differ because the row itself differs: a column has no width to
 * spend, so the hash, the author and the date take a line of their own above
 * the subject; spanning the drawer they all fit on one line and a 48px row
 * would spend the stacked layout's scarcest axis on padding.
 *
 * This is the ONE home for the number. The panel publishes the active entry as
 * `--gs-commit-row` and the stylesheet sizes the row from it, while the lane
 * graph draws each row's segment exactly that tall — the lanes only meet across
 * the seam between rows if both come from here. Guarded by
 * `tests/commit-row-height.test.ts`.
 */
export const COMMIT_ROW_H: Record<HistoryLayout, number> = { columns: 48, stacked: 28 }
