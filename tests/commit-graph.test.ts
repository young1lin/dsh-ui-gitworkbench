/**
 * Lane assignment for the commit graph.
 *
 * The renderer is a few SVG paths with no decisions in it; every decision lives
 * here, in a pure function over hashes. These tests are the specification of
 * what the drawn graph means:
 *
 *   - a lane is a vertical line, and a commit's dot sits in exactly one
 *   - `into` are the lines arriving from the rows above, `outOf` the lines
 *     leaving toward the rows below, and `through` the lines that pass this row
 *     without touching it
 *   - the FIRST parent keeps the commit's own lane, so mainline history reads
 *     as one straight line and merged branches are the ones that curve
 */
import { describe, expect, it } from 'vitest'
import { layoutGraph, type GraphInput } from '../src/client/commit-graph.ts'

/** `a <- b` reads "a's parent is b". Commits are listed newest-first, as git logs them. */
function chain(...pairs: [string, ...string[]][]): GraphInput[] {
  return pairs.map(([hash, ...parents]) => ({ hash, parents }))
}

describe('linear history', () => {
  const graph = layoutGraph(chain(['c', 'b'], ['b', 'a'], ['a']))

  it('keeps every commit in one lane', () => {
    expect(graph.rows.map(row => row.lane)).toEqual([0, 0, 0])
    expect(graph.width).toBe(1)
  })

  it('starts the tip with nothing arriving from above', () => {
    expect(graph.rows[0]!.into).toEqual([])
    expect(graph.rows[0]!.outOf).toEqual([0])
  })

  it('ends the root with nothing leaving below', () => {
    const root = graph.rows[2]!
    expect(root.into).toEqual([0])
    expect(root.outOf).toEqual([])
  })

  it('draws no pass-through lines when there is only one lane', () => {
    expect(graph.rows.every(row => row.through.length === 0)).toBe(true)
  })
})

describe('a parent outside the loaded page', () => {
  it('lets the line continue off the bottom', () => {
    // The history list pages. The last loaded commit almost always has a parent
    // that has not been fetched, and its lane must not be closed off — the line
    // leaving the bottom edge is what says "there is more".
    const graph = layoutGraph(chain(['b', 'a']))
    expect(graph.rows[0]!.outOf).toEqual([0])
  })
})

describe('a merge', () => {
  // m ─┬─ a ── c
  //    └─ b ──┘
  const graph = layoutGraph(chain(['m', 'a', 'b'], ['a', 'c'], ['b', 'c'], ['c']))

  it('marks the merge row and sends a line to each parent', () => {
    const merge = graph.rows[0]!
    expect(merge.isMerge).toBe(true)
    expect(merge.lane).toBe(0)
    expect(merge.outOf).toEqual([0, 1])
  })

  it('keeps the first parent in the merge commit\'s own lane', () => {
    // This is what makes mainline history a straight line: the branch that was
    // merged in is the one that curves away, never the branch merged into.
    expect(graph.rows[1]!.hash).toBe('a')
    expect(graph.rows[1]!.lane).toBe(0)
    expect(graph.rows[2]!.hash).toBe('b')
    expect(graph.rows[2]!.lane).toBe(1)
  })

  it('reserves two lanes while the branch is open', () => {
    expect(graph.width).toBe(2)
  })

  it('collapses both lanes back when they reach the shared parent', () => {
    const shared = graph.rows[3]!
    expect(shared.hash).toBe('c')
    // Both lanes were waiting for `c`; it takes the leftmost and the other ends.
    expect(shared.lane).toBe(0)
    expect(shared.into).toEqual([0, 1])
    expect(shared.outOf).toEqual([])
  })

  it('passes the open branch through the rows it does not touch', () => {
    // Row `a` sits in lane 0 while lane 1 is still waiting for `b`: that line
    // must be drawn straight through, or the branch appears to vanish.
    expect(graph.rows[1]!.through).toEqual([1])
  })
})

describe('lane reuse', () => {
  it('puts a later branch back into a lane a finished one gave up', () => {
    // m1 opens lane 1 and closes it at `x`; m2 should reuse lane 1 rather than
    // widening the graph forever.
    const graph = layoutGraph(chain(
      ['m1', 'p1', 'b1'],
      ['p1', 'x'],
      ['b1', 'x'],
      ['x', 'm2'],
      ['m2', 'p2', 'b2'],
      ['p2', 'z'],
      ['b2', 'z'],
      ['z'],
    ))
    expect(graph.width).toBe(2)
    const b2 = graph.rows.find(row => row.hash === 'b2')!
    expect(b2.lane).toBe(1)
  })
})

describe('octopus merge', () => {
  it('opens a lane for every extra parent', () => {
    const graph = layoutGraph(chain(['o', 'a', 'b', 'c'], ['a'], ['b'], ['c']))
    expect(graph.rows[0]!.outOf).toEqual([0, 1, 2])
    expect(graph.width).toBe(3)
  })
})

describe('degenerate input', () => {
  it('returns an empty graph for no commits', () => {
    expect(layoutGraph([])).toEqual({ rows: [], width: 0 })
  })

  it('survives a parent that appears twice', () => {
    // `git log` will not produce this, but a truncated page plus a rewritten
    // history can, and a duplicate must not open a second lane for one edge.
    const graph = layoutGraph(chain(['m', 'a', 'a'], ['a']))
    expect(graph.rows[0]!.outOf).toEqual([0])
    expect(graph.width).toBe(1)
  })

  it('never reports a lane index past the row width', () => {
    const graph = layoutGraph(chain(
      ['m', 'a', 'b'], ['a', 'c'], ['b', 'd'], ['c', 'e'], ['d', 'e'], ['e'],
    ))
    for (const row of graph.rows) {
      for (const lane of [row.lane, ...row.into, ...row.outOf, ...row.through]) {
        expect(lane, `${row.hash} lane ${lane} vs width ${row.width}`).toBeLessThan(row.width)
      }
      expect(row.width).toBeLessThanOrEqual(graph.width)
    }
  })
})
