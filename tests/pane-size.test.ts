/**
 * The ceiling on a dragged pane, and the word that broke it.
 *
 * Reported as "the middle divider will not move". It moved exactly as far as
 * it was allowed to: the History tab stacks the commit list across the whole
 * drawer, the clamp counted that full-width list as the tree's neighbour, and
 * `drawer - drawer - MIN_DIFF` is negative — so the ceiling fell below the
 * floor and the tree took its minimum whatever the pointer did.
 */
import { describe, expect, it } from 'vitest'

import { clampPane, neighbourWidth, type PaneBox } from '../src/client/pane-size.ts'

const box = (left: number, width: number): PaneBox => ({ left, right: left + width, width })

describe('neighbourWidth', () => {
  it('counts a pane that sits beside the one being dragged', () => {
    // The Changes and Compare layout: commit list, then tree, then diff.
    const commits = box(0, 340)
    const tree = box(340, 260)
    expect(neighbourWidth(commits, tree)).toBe(340)
  })

  it('counts it from either side', () => {
    const tree = box(0, 260)
    const commits = box(260, 340)
    expect(neighbourWidth(commits, tree)).toBe(340)
  })

  it('counts nothing for a pane stacked above', () => {
    // THE bug. Stacked, both boxes start at the drawer's left edge and span
    // it, so neither ends where the other begins.
    const commits = box(0, 1600)
    const tree = box(0, 260)
    expect(neighbourWidth(commits, tree)).toBe(0)
  })

  it('counts nothing for a pane that is not rendered', () => {
    expect(neighbourWidth(null, box(0, 260))).toBe(0)
    expect(neighbourWidth(box(0, 340), null)).toBe(0)
  })

  it('tolerates sub-pixel drift between touching edges', () => {
    // getBoundingClientRect reports fractions; a third of a pixel of overlap
    // does not stop two panes being side by side.
    expect(neighbourWidth(box(0, 340.4), box(340, 260))).toBe(340.4)
  })
})

describe('clampPane', () => {
  const DRAWER = 1600
  const MIN_DIFF = 320

  it('lets a pane grow into the space nothing else needs', () => {
    expect(clampPane(700, 180, DRAWER, 340, MIN_DIFF)).toBe(700)
    // …up to that space and no further.
    expect(clampPane(5000, 180, DRAWER, 340, MIN_DIFF)).toBe(DRAWER - 340 - MIN_DIFF)
  })

  it('holds the floor', () => {
    expect(clampPane(10, 180, DRAWER, 340, MIN_DIFF)).toBe(180)
    expect(clampPane(-500, 180, DRAWER, 340, MIN_DIFF)).toBe(180)
  })

  it('gives the stacked tree the whole row to grow into', () => {
    // With the neighbour rule feeding it a 0, the same drawer that used to
    // pin the tree at 180 now lets it reach 1280.
    expect(clampPane(900, 180, DRAWER, 0, MIN_DIFF)).toBe(900)
    expect(clampPane(5000, 180, DRAWER, 0, MIN_DIFF)).toBe(DRAWER - MIN_DIFF)
  })

  it('does not invert in a drawer too narrow for both floors', () => {
    // The ceiling would be negative here. The pane takes its minimum rather
    // than a number below it.
    expect(clampPane(400, 180, 300, 340, MIN_DIFF)).toBe(180)
  })

  it('reproduces the reported freeze when the neighbour is counted wrongly', () => {
    // What the History tab actually computed: the full-width list passed in
    // as the neighbour. Every pointer position collapses to the floor, which
    // is what "the divider will not move" looked like.
    const pinned = [200, 400, 800, 1200].map(x => clampPane(x, 180, DRAWER, DRAWER, MIN_DIFF))
    expect(pinned).toEqual([180, 180, 180, 180])
  })
})
