import { describe, expect, it } from 'vitest'

import {
  NAV_PEEK_PX, anchorFor, anchorFrom, countBlocks, scrollTopFor, stepToBlock, unifiedBlocks,
  type BlockTop, type NavMemory, type RowKind,
} from '../src/client/diff-nav.ts'

/** Three changes, well apart, the way they sit in a long file. */
const ANCHORS: readonly BlockTop[] = [
  { block: 0, top: 400 },
  { block: 1, top: 1200 },
  { block: 2, top: 9000 },
]

describe('stepToBlock', () => {
  it('goes to the first change below where the reader is', () => {
    expect(stepToBlock(ANCHORS, 0, 1)?.block).toBe(0)
    expect(stepToBlock(ANCHORS, 500, 1)?.block).toBe(1)
    expect(stepToBlock(ANCHORS, 5000, 1)?.block).toBe(2)
  })

  it('goes to the last change above where the reader is', () => {
    expect(stepToBlock(ANCHORS, 9000, -1)?.block).toBe(1)
    expect(stepToBlock(ANCHORS, 1200, -1)?.block).toBe(0)
  })

  it('wraps at both ends rather than going dead', () => {
    // A button that stops working at the last change asks the reader to work
    // out why. Coming back to the first says "that was all of them" without a
    // disabled control to interpret.
    expect(stepToBlock(ANCHORS, 12000, 1)?.block).toBe(0)
    expect(stepToBlock(ANCHORS, 100, -1)?.block).toBe(2)
  })

  it('answers null only when the diff has no changes', () => {
    expect(stepToBlock([], 0, 1)).toBeNull()
    expect(stepToBlock([], 0, -1)).toBeNull()
  })

  it('does not offer the reader the block they are standing on', () => {
    // Exactly at a block's top, "next" is the one after it — otherwise the
    // button appears to do nothing.
    expect(stepToBlock(ANCHORS, 400, 1)?.block).toBe(1)
    expect(stepToBlock(ANCHORS, 400, -1)?.block).toBe(2)
  })

  it('ignores sub-pixel drift in the measurement', () => {
    // getBoundingClientRect reports fractions; a third of a pixel is not a
    // different position.
    expect(stepToBlock(ANCHORS, 400.4, 1)?.block).toBe(1)
    expect(stepToBlock(ANCHORS, 399.6, 1)?.block).toBe(1)
  })

  it('does not depend on the order it was handed', () => {
    const shuffled = [ANCHORS[2]!, ANCHORS[0]!, ANCHORS[1]!]
    expect(stepToBlock(shuffled, 500, 1)?.block).toBe(1)
    expect(stepToBlock(shuffled, 500, -1)?.block).toBe(0)
  })

  it('handles the single change, which is the case that prompted all this', () => {
    const only: readonly BlockTop[] = [{ block: 0, top: 3000 }]
    // From anywhere, both directions land on the one change there is.
    expect(stepToBlock(only, 0, 1)?.block).toBe(0)
    expect(stepToBlock(only, 8000, 1)?.block).toBe(0)
    expect(stepToBlock(only, 0, -1)?.block).toBe(0)
  })
})

describe('the peek invariant', () => {
  it('walks forward one change per press, never twice on the same one', () => {
    // THE bug this pair of functions exists to prevent. The scroll stops short
    // of the change so the line above stays visible; if that offset is not
    // added back when deciding what is next, the block just landed on still
    // counts as "below the top of the viewport" and every press lands on it
    // again.
    const walked: number[] = []
    let scrollTop = 0
    for (let press = 0; press < 3; press += 1) {
      const next = stepToBlock(ANCHORS, anchorFor(scrollTop), 1)
      expect(next).not.toBeNull()
      walked.push(next!.block)
      scrollTop = scrollTopFor(next!.top)
    }
    expect(walked).toEqual([0, 1, 2])
  })

  it('walks back the way it came', () => {
    let scrollTop = scrollTopFor(9000)
    const walked: number[] = []
    for (let press = 0; press < 2; press += 1) {
      const back = stepToBlock(ANCHORS, anchorFor(scrollTop), -1)
      walked.push(back!.block)
      scrollTop = scrollTopFor(back!.top)
    }
    expect(walked).toEqual([1, 0])
  })

  it('keeps context above the change instead of pinning it to the edge', () => {
    expect(scrollTopFor(1200)).toBe(1200 - NAV_PEEK_PX)
    // …but never scrolls past the top of the document for a change near it.
    expect(scrollTopFor(10)).toBe(0)
    expect(scrollTopFor(0)).toBe(0)
  })

  it('still reaches a change too near the top for a full peek', () => {
    // scrollTopFor clamps to 0, so the anchor is the peek itself — the block
    // at top 10 is above that and must not be skipped on the way back.
    const near: readonly BlockTop[] = [{ block: 0, top: 10 }, { block: 1, top: 4000 }]
    expect(stepToBlock(near, anchorFor(scrollTopFor(4000)), -1)?.block).toBe(0)
  })
})

describe('anchorFrom, and the end of the file', () => {
  /** A change in the last screenful: the scroller runs out before it can be
   *  parked at the peek line. Found on the live pane, not here — the pure
   *  model has no floor, so nothing in this file could have predicted it. */
  const LATE: readonly BlockTop[] = [
    { block: 0, top: 128 },
    { block: 1, top: 1848 },
    { block: 2, top: 2400 },
  ]
  /** What the browser clamps to for this content. */
  const MAX_SCROLL = 1834

  /** One press, with the scroller's clamping applied. */
  const press = (
    at: number, held: NavMemory | null, direction: 1 | -1,
  ): { scrollTop: number; memory: NavMemory } => {
    const target = stepToBlock(LATE, anchorFrom(LATE, at, held), direction)!
    const scrollTop = Math.min(scrollTopFor(target.top), MAX_SCROLL)
    return { scrollTop, memory: { block: target.block, scrollTop } }
  }

  it('wraps off the last change even though the scroll cannot move', () => {
    // Without the memory this is an infinite loop on block 2: scrollTop stops
    // changing at the floor, so the viewport keeps reporting the same anchor
    // and "next" keeps choosing the same block.
    let state = press(0, null, 1)
    const visited = [state.memory.block]
    for (let i = 0; i < 3; i += 1) {
      state = press(state.scrollTop, state.memory, 1)
      visited.push(state.memory.block)
    }
    expect(visited).toEqual([0, 1, 2, 0])
  })

  it('lets the viewport take over the moment the reader scrolls', () => {
    // The memory is trusted only while the scroll has not moved; a wheel
    // scroll must not be overridden by where a button press left off.
    const stale: NavMemory = { block: 2, scrollTop: MAX_SCROLL }
    expect(anchorFrom(LATE, 200, stale)).toBe(anchorFor(200))
  })

  it('falls back to the viewport when the remembered block is gone', () => {
    // The drawer's poll can refresh the diff under the reader.
    const vanished: NavMemory = { block: 9, scrollTop: 500 }
    expect(anchorFrom(LATE, 500, vanished)).toBe(anchorFor(500))
  })

  it('agrees with the viewport wherever both apply', () => {
    // A block parked at the peek line has a top exactly equal to anchorFor of
    // the resulting scroll, so the two rules never disagree off the floor.
    const held: NavMemory = { block: 1, scrollTop: scrollTopFor(1848) }
    expect(anchorFrom(LATE, held.scrollTop, held)).toBe(anchorFor(held.scrollTop))
  })
})

describe('unifiedBlocks', () => {
  const ids = (kinds: readonly RowKind[]): readonly number[] => unifiedBlocks(kinds)

  it('counts a replacement as one change, not two', () => {
    // THE case this function exists for. git writes a replaced line as a
    // deletion immediately followed by an addition; to a reader that is one
    // edit, and sending them to the minus lines and then again to the plus
    // lines directly below would be the button appearing to stutter.
    expect(ids(['context', 'del', 'add', 'context'])).toEqual([-1, 0, 0, -1])
  })

  it('separates changes that have context between them', () => {
    expect(ids(['add', 'context', 'add'])).toEqual([0, -1, 1])
  })

  it('separates changes across a hunk header', () => {
    // A hunk header means git skipped lines: whatever follows is somewhere
    // else in the file, however adjacent the two runs look on screen.
    expect(ids(['add', 'hunk', 'add'])).toEqual([0, -1, 1])
  })

  it('marks nothing in a diff that only has context', () => {
    expect(ids(['hunk', 'context', 'context'])).toEqual([-1, -1, -1])
  })

  it('handles a run at either end', () => {
    expect(ids(['del', 'context', 'del'])).toEqual([0, -1, 1])
  })

  it('is empty for an empty diff', () => {
    expect(ids([])).toEqual([])
  })
})

describe('countBlocks', () => {
  it('counts the blocks, not the rows', () => {
    expect(countBlocks([-1, 0, 0, -1, 1, -1])).toBe(2)
  })

  it('is zero when nothing changed', () => {
    expect(countBlocks([])).toBe(0)
    expect(countBlocks([-1, -1])).toBe(0)
  })
})
