/**
 * One lazily listed directory, shaped for the wire.
 *
 * The Files tab browses ignored directories by reading them from the
 * filesystem ONE level at a time — git cannot do this scoped: a pathspec
 * under `--directory` still collapses the whole ignored directory to a
 * single line, and dropping `--directory` would enumerate every file inside
 * `node_modules` at once. A `readdir` is one level by construction, costs
 * milliseconds, and says what a browser wants to know: what is HERE.
 *
 * Only the shaping is pure (ordering, capping); the read itself stays in
 * `index.ts`, which vitest cannot load. Same split as `fs-remove.ts`.
 *
 * @module @young1lin/dsh-ui-gitworkbench/dir-listing
 */

/** One entry of a listed directory: a name plus whether expanding it again
 *  makes sense. `dir` decides the row's glyph and whether it is clickable
 *  as a folder. */
export interface DirChild {
  readonly name: string
  readonly dir: boolean
}

/** The most entries one expansion returns. A real directory level is a few
 *  hundred at most (`node_modules`'s own top level); a cap beyond that is a
 *  reported fuse against a pathological directory, not a working number. */
export const DIR_CHILD_CAP = 5_000

/**
 * Order and cap raw readdir results: directories before files (the shape
 * every file tree has, matching `treeRows`), each run by name, and a cut
 * REPORTED rather than silent.
 *
 * @param raw - the directory's entries with their best-known dir-ness
 *              (symlinks already resolved by the caller).
 * @param cap - most entries to return.
 */
export function shapeDirChildren(
  raw: readonly DirChild[],
  cap: number = DIR_CHILD_CAP,
): { entries: DirChild[]; truncated: boolean } {
  const byName = (a: DirChild, b: DirChild): number => a.name.localeCompare(b.name)
  const ordered = [...raw.filter(entry => entry.dir).sort(byName), ...raw.filter(entry => !entry.dir).sort(byName)]
  const truncated = ordered.length > cap
  return { entries: truncated ? ordered.slice(0, cap) : ordered, truncated }
}
