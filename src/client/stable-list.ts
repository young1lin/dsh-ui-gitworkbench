/**
 * Is this list the same list as last time?
 *
 * React memoisation keys on IDENTITY, and the drawer polls: `git status` comes
 * back every 3–15 seconds and every derived array is a new object even when
 * the repository has not moved. In the Files tab that identity change is the
 * head of a chain — the untracked paths feed the merged path list, which feeds
 * the directory tree, which feeds the rows — so one fresh array per poll
 * rebuilds a 20,000-path tree that is byte-for-byte what it already was.
 *
 * Comparing the contents costs one pass over the list; rebuilding costs a sort
 * and a tree walk. The comparison wins by two orders of magnitude, and it wins
 * by more the larger the repository is, which is exactly where it matters.
 *
 * @module @young1lin/dsh-ui-gitworkbench/client/stable-list
 */

/**
 * Element-wise equality, in order.
 *
 * Identity first: the common case is that nothing upstream changed at all, and
 * then there is nothing to compare.
 */
export function sameList(a: readonly string[], b: readonly string[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false
  }
  return true
}
