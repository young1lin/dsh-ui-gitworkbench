/**
 * Lane assignment for the commit graph — the branch/merge diagram down the left
 * edge of the history list, the way IDEA, gitk and GitHub's network view draw it.
 *
 * A LANE is a vertical line. Each one is "waiting for" a commit hash: the hash
 * of the commit that will terminate it further down the list. Walking the log
 * newest-first, every commit takes over the lane(s) waiting for it, then hands
 * that lane to its FIRST parent and opens a lane for each additional one. That
 * single rule is what makes mainline history read as one straight line and the
 * merged branch the one that curves away — first-parent order is the meaning of
 * `%p`, not an arbitrary choice.
 *
 * Everything here is pure. The renderer that consumes it draws paths and has no
 * decisions of its own, so the graph's whole behaviour is testable without a DOM.
 *
 * The list is PAGED, so the layout is always over a prefix of history. A lane
 * still waiting for an unfetched parent simply leaves the bottom edge, which is
 * exactly what should be drawn: the line continues because the history does.
 *
 * @module
 */

/** The only thing the layout needs from a commit. */
export interface GraphInput {
  readonly hash: string
  /** Parent hashes in git's order — first parent first. */
  readonly parents: readonly string[]
}

/** One row's geometry, in lane indices. The renderer turns these into paths. */
export interface GraphRow {
  readonly hash: string
  /** Lane the commit's dot sits in. */
  readonly lane: number
  /**
   * Lanes arriving from the rows above and ending at this commit. Contains
   * {@link lane} when this commit continues the line it sits on, and additional
   * entries when branches converge here. Empty for a tip.
   */
  readonly into: readonly number[]
  /**
   * Lanes leaving toward the rows below. Contains {@link lane} unless this is a
   * root commit, plus one entry per additional parent.
   */
  readonly outOf: readonly number[]
  /** Lanes crossing this row untouched — drawn as an unbroken vertical line. */
  readonly through: readonly number[]
  /** Lanes in use at this row; every index above is `< width`. */
  readonly width: number
  readonly isMerge: boolean
}

export interface Graph {
  readonly rows: readonly GraphRow[]
  /** The widest row — how much horizontal space the column reserves. */
  readonly width: number
}

/**
 * Assign lanes to a page of commits.
 * @param commits - newest-first, as `git log` orders them.
 * @returns per-row geometry plus the column width to reserve.
 */
export function layoutGraph(commits: readonly GraphInput[]): Graph {
  /** `lanes[i]` is the hash lane `i` is waiting for; null means the lane is free. */
  const lanes: (string | null)[] = []
  const rows: GraphRow[] = []
  let width = 0

  const freeSlot = (): number => {
    const reused = lanes.indexOf(null)
    if (reused !== -1) return reused
    lanes.push(null)
    return lanes.length - 1
  }
  const occupiedWidth = (state: readonly (string | null)[]): number => {
    for (let i = state.length - 1; i >= 0; i -= 1) if (state[i] !== null) return i + 1
    return 0
  }

  for (const commit of commits) {
    const before = [...lanes]

    // Every lane waiting for this commit ends here. The leftmost becomes the
    // commit's own lane; picking the leftmost is what keeps the graph compact
    // and holds the mainline against the left edge.
    const into: number[] = []
    for (let i = 0; i < lanes.length; i += 1) if (lanes[i] === commit.hash) into.push(i)

    const lane = into.length > 0 ? into[0]! : freeSlot()
    for (const other of into) if (other !== lane) lanes[other] = null

    // Hand the lane to the first parent; open one per additional parent. A
    // parent some other lane is already waiting for reuses that lane instead of
    // opening a second line to the same commit.
    const outOf: number[] = []
    const seen = new Set<string>()
    lanes[lane] = null
    for (const parent of commit.parents) {
      if (seen.has(parent)) continue
      seen.add(parent)
      if (outOf.length === 0) {
        lanes[lane] = parent
        outOf.push(lane)
        continue
      }
      let target = lanes.indexOf(parent)
      if (target === -1) {
        target = freeSlot()
        lanes[target] = parent
      }
      outOf.push(target)
    }

    // A lane passes through when it was busy before, is still busy after, and
    // its expectation did not change — i.e. this commit had nothing to do with it.
    const through: number[] = []
    for (let i = 0; i < before.length; i += 1) {
      if (i === lane) continue
      if (before[i] !== null && before[i] === lanes[i]) through.push(i)
    }

    // Trailing free lanes cost width without carrying a line.
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop()

    const rowWidth = Math.max(occupiedWidth(before), occupiedWidth(lanes), lane + 1)
    width = Math.max(width, rowWidth)
    rows.push({
      hash: commit.hash,
      lane,
      into,
      outOf,
      through,
      width: rowWidth,
      isMerge: seen.size > 1,
    })
  }

  return { rows, width }
}
