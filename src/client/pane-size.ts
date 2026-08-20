/**
 * How wide a dragged pane is allowed to be.
 *
 * A pane may grow only into space the others do not need, so the ceiling is
 * the drawer minus its neighbour minus the floor under the diff. The part that
 * broke is the word NEIGHBOUR: the History tab stacks the commit list across
 * the top, where it is a sibling of the tree-and-diff row rather than a column
 * beside the tree — and counting a full-drawer-wide list as the tree's
 * neighbour makes the ceiling smaller than the floor. The tree then sits at its
 * minimum whatever the pointer does, which reads as a divider that will not
 * move.
 *
 * So the question is asked of the geometry instead of the tab: two boxes are
 * neighbours when one actually ends where the other begins. That stays true if
 * another tab is stacked later, and it cannot be got wrong by a rename.
 *
 * Pure: no React, no DOM — the caller measures, this decides.
 *
 * @module @young1lin/dsh-ui-gitworkbench/client/pane-size
 */

/** As much of a `DOMRect` as any of this needs. */
export interface PaneBox {
  readonly left: number
  readonly right: number
  readonly width: number
}

/** Sub-pixel tolerance: two boxes a third of a pixel apart are touching. */
const EPSILON_PX = 1

/**
 * The width `other` contributes to a drag on `pane` — zero unless the two are
 * side by side.
 *
 * @param other - the pane that might be in the way, or null when it is not on
 *   screen at all.
 * @param pane - the pane being dragged.
 */
export function neighbourWidth(other: PaneBox | null, pane: PaneBox | null): number {
  if (other === null || pane === null) return 0
  // Either order: whichever is on the left, they are neighbours only if one's
  // trailing edge meets the other's leading edge. A box stacked above spans
  // the same columns as the one below, so neither test holds.
  const beside = other.right <= pane.left + EPSILON_PX || pane.right <= other.left + EPSILON_PX
  return beside ? other.width : 0
}

/**
 * Clamp a dragged width between the pane's floor and the room actually left.
 *
 * The outer `Math.max` keeps the range from inverting in a drawer too narrow to
 * hold both floors — the pane then simply takes its minimum, rather than the
 * clamp returning a number below it.
 *
 * @param next - the width the pointer implies.
 * @param min - this pane's floor.
 * @param drawer - the drawer's inner width.
 * @param other - the neighbour's width, from {@link neighbourWidth}.
 * @param minDiff - the floor under the diff, which is never dragged directly.
 */
export function clampPane(
  next: number,
  min: number,
  drawer: number,
  other: number,
  minDiff: number,
): number {
  const max = Math.max(min, drawer - other - minDiff)
  return Math.min(Math.max(next, min), max)
}
