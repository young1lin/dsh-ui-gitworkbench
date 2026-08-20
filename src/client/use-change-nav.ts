/**
 * Walking a scroller change by change — the wiring half of `diff-nav.ts`.
 *
 * The decisions (which block is next, where to stop, how to survive the end of
 * the file) are pure and live next door, where vitest can reach them. What is
 * left is the part that cannot be pure: reading the DOM for where the blocks
 * actually are, and moving the scroller. Both panes that offer the walk — the
 * side-by-side view in Changes and the unified view in History and Compare —
 * need exactly this, and a second copy of it is a second place for the
 * scroll-position bookkeeping to be got subtly wrong.
 *
 * The scroller is passed IN rather than created here: in Changes the pane owns
 * it, in History the drawer does. The blocks are found by attribute, so any
 * renderer that marks its changed rows with `data-block` can be walked.
 *
 * @module @young1lin/dsh-ui-gitworkbench/client/use-change-nav
 */

import { useRef, type MutableRefObject } from 'react'

import { anchorFrom, scrollTopFor, stepToBlock, type BlockTop, type NavMemory } from './diff-nav.ts'

/** What a pane needs to offer the walk. */
export interface ChangeNav {
  /** Move to the next (1) or previous (-1) change, wrapping at both ends. */
  readonly goToChange: (direction: 1 | -1) => void
}

/**
 * @param scrollRef - the element that scrolls, and the one whose subtree
 *   carries the `data-block` marks.
 */
export function useChangeNav(scrollRef: MutableRefObject<HTMLDivElement | null>): ChangeNav {
  /** What the last press landed on. A ref, not state: it exists to make the
   *  NEXT press correct, and nothing on screen reads it. */
  const navMemory = useRef<NavMemory | null>(null)

  /**
   * Every change block's position inside the scrolled content.
   *
   * Measured off the DOM rather than derived from a row model: a model knows
   * which rows changed, not how many pixels down the page they sit, and the
   * rows are never the only thing in the scroller — padding, a sticky bar and,
   * in the armed side-by-side pane, a CodeMirror view of a different height
   * all move the answer. One layout read per PRESS is cheap; nothing here runs
   * on scroll.
   *
   * `offsetTop` is deliberately not used: it is relative to whichever ancestor
   * happens to be positioned, which no rule in the stylesheet guarantees.
   * Measuring both boxes and subtracting is independent of that.
   */
  const blockTops = (): readonly BlockTop[] => {
    const scroller = scrollRef.current
    if (scroller === null) return []
    // First element carrying each id, in document order. A side-by-side row
    // marks both of its columns, so the first hit for a block is its first row.
    const first = new Map<number, HTMLElement>()
    for (const cell of scroller.querySelectorAll<HTMLElement>('[data-block]')) {
      const block = Number(cell.dataset.block)
      if (!Number.isInteger(block) || block < 0 || first.has(block)) continue
      first.set(block, cell)
    }
    const base = scroller.getBoundingClientRect().top - scroller.scrollTop
    const tops: BlockTop[] = []
    for (const [block, cell] of first) tops.push({ block, top: cell.getBoundingClientRect().top - base })
    return tops
  }

  const goToChange = (direction: 1 | -1): void => {
    const scroller = scrollRef.current
    if (scroller === null) return
    const tops = blockTops()
    const target = stepToBlock(tops, anchorFrom(tops, scroller.scrollTop, navMemory.current), direction)
    if (target === null) return
    scroller.scrollTop = scrollTopFor(target.top)
    // Read back rather than storing what was asked for: the browser clamps at
    // the end of the content, and the clamped value is what the next press
    // compares against to tell "still here" from "the reader scrolled".
    navMemory.current = { block: target.block, scrollTop: scroller.scrollTop }
  }

  return { goToChange }
}
