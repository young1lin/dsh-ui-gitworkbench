/**
 * Which file a view opens on.
 *
 * The drawer keeps ONE selected path across commits, so walking down a
 * filtered history is meant to be a walk through one file's life. That only
 * works if the fallback — what happens when the selection is not in the
 * commit you just clicked — knows about the path filter. It did not: the
 * fallback was `files[0]`, so filtering by `xx/aa/dd.ts` and clicking a
 * commit opened whatever sorted first in that commit, and the file the
 * filter was ABOUT sat unhighlighted somewhere down the tree.
 *
 * Pure and React-free so it can be tested; the panel only wires it up.
 *
 * @module @young1lin/dsh-ui-gitworkbench/active-file
 */

/** Just the field this module reads off the view's file list. */
export interface PathLike {
  readonly path: string
}

/** No filter — a shared empty so callers keep a stable reference. */
export const NO_PATHS: readonly string[] = []

/**
 * Whether a file is what a pathspec selected: the file itself, or anything in
 * its subtree.
 *
 * A pathspec from the picker is either a file path or a directory path with no
 * trailing slash (`dir.path` / the file's full path — `path-select.ts`), and
 * the two cases are told apart by the file rather than by the spec: `===` is
 * the file, `spec + '/'` prefix is the subtree. Guessing which KIND a spec is
 * from its string alone is what a trailing-slash convention would force, and
 * it would be wrong for any file without an extension.
 */
function covers(spec: string, path: string): boolean {
  return path === spec || path.startsWith(`${spec}/`)
}

/**
 * The file a view should highlight.
 *
 * The order of preference, and why it is this order:
 *
 * 1. **The selection, if this view has it.** Stepping down a filtered list is
 *    the whole point of filtering; changing the file under the reader every
 *    time they move a row would undo it. This also means an explicit click
 *    outranks the filter — the reader looked somewhere on purpose.
 * 2. **A file the filter names EXACTLY.** Ticking `xx/aa/dd.ts` is a statement
 *    about that file; ticking `xx` is a statement about a region. When a
 *    commit touches both kinds, the named file is the more specific intent, so
 *    it wins. (The two can only coexist across disjoint trees: the picker's
 *    invariant is that no ticked path covers another.)
 * 3. **A file under a filtered directory.**
 * 4. **The first file.** No filter, or nothing in this commit matched it —
 *    the behaviour before any of this existed.
 *
 * Ties inside 2 and 3 go to the commit's own file order, which is the order
 * the tree renders: the highlight lands on the topmost matching row, so it is
 * where the reader is already looking and never needs a scroll to find. The
 * alternative — first match in FILTER order — would be arbitrary, since that
 * order is an artifact of the sequence the boxes were ticked in and is never
 * shown anywhere.
 *
 * @param files - the view's files, in the order the tree shows them.
 * @param filterPaths - active path filter; empty on views that have none.
 * @param previous - the currently selected path, or null.
 * @returns the path to highlight, or null when there are no files at all.
 */
export function preferredFile(
  files: readonly PathLike[],
  filterPaths: readonly string[],
  previous: string | null,
): string | null {
  if (previous !== null && files.some(file => file.path === previous)) return previous
  if (filterPaths.length > 0) {
    const exact = files.find(file => filterPaths.some(spec => file.path === spec))
    if (exact !== undefined) return exact.path
    const under = files.find(file => filterPaths.some(spec => covers(spec, file.path)))
    if (under !== undefined) return under.path
  }
  return files[0]?.path ?? null
}
