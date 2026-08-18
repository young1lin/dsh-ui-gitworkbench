/**
 * Narrowing a file list by typing at it.
 *
 * A commit that touched 140 files is a scroll, not a list, and the drawer's
 * tree is the same object in every tab — so the rule lives here once and both
 * the working tree and a commit's contents get it.
 *
 * Two decisions worth stating, because both are the kind that get "simplified"
 * later:
 *
 *   - **Terms are ANDed, in any order.** `panel css` finds
 *     `src/client/GitWorkbenchPanel.module.css` — which is how anyone types
 *     when they half-remember a path, and is the behaviour a single-substring
 *     match gets wrong for exactly the paths that are long enough to need
 *     filtering.
 *   - **Smart case.** An all-lowercase query ignores case; the moment the
 *     reader types a capital they mean it. `README` should not match
 *     `readme-generator`, and `readme` should still find `README.md`.
 *
 * The result keeps the caller's order and its element type: the tree is built
 * from whatever survives, so filtering never has to know what a file is beyond
 * its path.
 *
 * @module @young1lin/dsh-ui-gitworkbench/client/file-filter
 */

/** Split a raw query into the terms every path must contain. */
function termsOf(query: string): readonly string[] {
  return query.split(/\s+/).filter(term => term.length > 0)
}

/**
 * Whether one path satisfies a query.
 *
 * @param path - repo-relative path, as the tree lists it.
 * @param query - raw text from the filter box; blank matches everything, so a
 *                caller that renders `filterFiles` unconditionally shows the
 *                whole list until something is typed.
 */
export function matchesPath(path: string, query: string): boolean {
  const terms = termsOf(query)
  if (terms.length === 0) return true
  return terms.every(term => {
    // Per TERM, not per query: `src README` is a sensible thing to type, and
    // deciding the whole query's case from one capital would make the `src`
    // half case-sensitive too.
    const cased = term.toLowerCase() !== term
    return cased ? path.includes(term) : path.toLowerCase().includes(term.toLowerCase())
  })
}

/**
 * Keep the files whose path satisfies the query, in the order given.
 *
 * @param files - anything carrying a `path`; the tree's own file objects.
 * @param query - raw text from the filter box.
 * @returns the same array instance when nothing is filtered out, so a blank
 *          query costs no re-render downstream.
 */
export function filterFiles<T extends { readonly path: string }>(
  files: readonly T[],
  query: string,
): readonly T[] {
  if (termsOf(query).length === 0) return files
  return files.filter(file => matchesPath(file.path, query))
}
