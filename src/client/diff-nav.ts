/**
 * Walking a diff change by change.
 *
 * A file whose whole delta is `+1 −1` is unreadable by scrolling: the change
 * is one tinted line somewhere in two thousand, and the tint is only visible
 * once you are already looking at it. The row model already knows where every
 * change is — `alignRows` groups changed rows into blocks and every rendered
 * code cell carries its block id — so nothing here has to find the changes.
 * What it decides is which one is NEXT.
 *
 * Position comes from the VIEWPORT, not from a remembered index. A reader
 * hunting for a change also scrolls with the wheel, and a counter kept in
 * state goes stale the moment they do — pressing the button would then jump
 * back to wherever the last press left off, which reads as the button being
 * broken. Asking the scroller where it is costs one layout read per press and
 * is always right.
 *
 * The peek is the part that is easy to get wrong. Landing a change flush
 * against the top edge hides the line above it, which is usually the line that
 * makes the change legible — so the scroll stops a few rows short. That offset
 * must then be added BACK when deciding what comes next, or the block just
 * landed on still counts as "below the top of the viewport" and every press
 * lands on it again. {@link anchorFor} and {@link scrollTopFor} are the two
 * halves of that one invariant, which is why they are named rather than
 * inlined as arithmetic at the call site.
 *
 * Pure: no React, no DOM. The component measures, this decides.
 *
 * @module @young1lin/dsh-ui-gitworkbench/client/diff-nav
 */

/** The pane's row height, from `.sideColGrid`'s `line-height`. */
export const NAV_ROW_PX = 20

/**
 * Rows of context kept above a change the reader is sent to.
 *
 * Three, because a one-line edit is read against its neighbours: the line
 * above is what tells you which rule, which function, which property this is.
 */
export const NAV_PEEK_ROWS = 3

/** The peek in pixels. */
export const NAV_PEEK_PX = NAV_ROW_PX * NAV_PEEK_ROWS

/**
 * Sub-pixel tolerance. `getBoundingClientRect` reports fractions, and a block
 * sitting a third of a pixel below the anchor is the block the reader is
 * already looking at, not the next one.
 */
const EPSILON_PX = 1

/** Where one change block starts, in the scroller's content coordinates. */
export interface BlockTop {
  /** The block id the rows carry. */
  readonly block: number
  /** Offset from the top of the scrolled content, in pixels. */
  readonly top: number
}

/**
 * The content position that counts as "where the reader is".
 *
 * The top of the viewport plus the peek, so a change the reader was just sent
 * to sits exactly AT the anchor rather than below it — which is what stops
 * "next" from choosing it a second time.
 */
export function anchorFor(scrollTop: number): number {
  return scrollTop + NAV_PEEK_PX
}

/** Where to scroll so a block sits {@link NAV_PEEK_ROWS} rows below the top. */
export function scrollTopFor(top: number): number {
  return Math.max(0, top - NAV_PEEK_PX)
}

/** The block a press landed on, and the scroll position it actually achieved. */
export interface NavMemory {
  readonly block: number
  /** `scrollTop` AFTER the browser clamped it, not the value asked for. */
  readonly scrollTop: number
}

/**
 * Where to step from.
 *
 * Normally the viewport answers this, and {@link anchorFor} is the whole
 * story. It stops being the whole story at the END of a file: a change in the
 * last screenful cannot be scrolled to the peek line, because the scroller
 * runs out of content first. `scrollTop` then stops changing between presses,
 * the viewport can no longer say which change was last visited, and "next"
 * chooses that same block forever — the reader is stuck on the final change
 * with no way to wrap around.
 *
 * So when the scroll has NOT moved since the last press, the block that press
 * landed on is the anchor instead. The two agree everywhere they both apply: a
 * block parked at the peek line has a top exactly equal to `anchorFor` of the
 * resulting scroll. Any hand-scrolling invalidates the memory and the viewport
 * takes over again, which is what keeps the wheel and the buttons consistent.
 *
 * @param tops - every block's top, as measured for this press.
 * @param scrollTop - the scroller's current position.
 * @param held - what the previous press recorded, or null.
 */
export function anchorFrom(
  tops: readonly BlockTop[],
  scrollTop: number,
  held: NavMemory | null,
): number {
  if (held !== null && Math.abs(held.scrollTop - scrollTop) < 1) {
    const landed = tops.find(entry => entry.block === held.block)
    // A block that no longer exists — the diff was refreshed under the reader
    // — leaves nothing to step from, so the viewport answers after all.
    if (landed !== undefined) return landed.top
  }
  return anchorFor(scrollTop)
}

/**
 * The next or previous change block, wrapping at the ends.
 *
 * Wrapping rather than stopping: a reader pressing the button repeatedly is
 * taking a tour of the file's changes, and a button that goes dead at the last
 * one asks them to notice why. Coming back around to the first says the same
 * thing — you have seen them all — without a disabled control to interpret.
 *
 * @param anchors - every block's top; order does not matter.
 * @param anchorTop - from {@link anchorFor}, never a raw `scrollTop`.
 * @param direction - 1 for the next change, -1 for the previous one.
 * @returns the block to go to, or null when the diff has no changes at all.
 */
export function stepToBlock(
  anchors: readonly BlockTop[],
  anchorTop: number,
  direction: 1 | -1,
): BlockTop | null {
  if (anchors.length === 0) return null
  const ordered = [...anchors].sort((a, b) => a.top - b.top)
  if (direction === 1) {
    const ahead = ordered.find(entry => entry.top > anchorTop + EPSILON_PX)
    return ahead ?? ordered[0] ?? null
  }
  let behind: BlockTop | null = null
  for (const entry of ordered) {
    if (entry.top < anchorTop - EPSILON_PX) behind = entry
    else break
  }
  return behind ?? ordered[ordered.length - 1] ?? null
}

/** One unified-diff row, as far as grouping is concerned. */
export type RowKind = 'add' | 'del' | 'context' | 'hunk'

/**
 * Group a unified diff's rows into change blocks.
 *
 * A block is a maximal run of added and deleted rows. A replacement arrives
 * from git as deletions followed by additions with nothing between them, and
 * that is ONE change to a reader — sending them to the `-` lines and then
 * again to the `+` lines directly below would be counting the same edit twice.
 * Context and hunk headers both end a run: a hunk header means git skipped
 * lines, so what follows is somewhere else in the file.
 *
 * The side-by-side pane does not need this — its row model already carries a
 * block id per row, because the blocks there are also what the stage and
 * roll-back buttons act on. The unified view has no such model, so the runs
 * are read off the kinds.
 *
 * @param kinds - every row's kind, in document order.
 * @returns a block id per row, aligned with the input; -1 for a row that is
 *   not part of any change.
 */
export function unifiedBlocks(kinds: readonly RowKind[]): readonly number[] {
  const ids: number[] = []
  let block = -1
  let inRun = false
  for (const kind of kinds) {
    const changed = kind === 'add' || kind === 'del'
    if (!changed) {
      inRun = false
      ids.push(-1)
      continue
    }
    if (!inRun) {
      block += 1
      inRun = true
    }
    ids.push(block)
  }
  return ids
}

/** How many change blocks {@link unifiedBlocks} found. */
export function countBlocks(ids: readonly number[]): number {
  let top = -1
  for (const id of ids) if (id > top) top = id
  return top + 1
}

/**
 * Where each change block sits, derived from the rows rather than measured.
 *
 * A windowed pane cannot measure: the block being walked to usually has no
 * element, because the whole point is that it is not on screen. The rows are a
 * fixed height there by construction, so the position is arithmetic.
 *
 * @param blocks - each row's block id, `-1` for a row that is not part of one.
 * @param rowH - row height in px.
 * @param offset - px above the first row, e.g. the grid's top padding.
 * @returns the first row of each block, in the order the blocks appear.
 */
export function blockTopsFromRows(
  blocks: readonly number[],
  rowH: number,
  offset = 0,
): readonly BlockTop[] {
  const tops: BlockTop[] = []
  const seen = new Set<number>()
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i]!
    if (!Number.isInteger(block) || block < 0 || seen.has(block)) continue
    seen.add(block)
    tops.push({ block, top: offset + i * rowH })
  }
  return tops
}
