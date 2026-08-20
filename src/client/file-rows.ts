/**
 * The file browser's row list: which rows a repository tree renders, given
 * which directories the reader has opened.
 *
 * This sits on top of {@link buildDirTree}, which the history filter's path
 * picker already uses, and adds the two things a BROWSER needs that a picker
 * did not. First, root-level files: `buildDirTree` returns the root's child
 * directories, so a file living on no directory — `package.json`, `README.md`
 * — never appears in it. A picker could leave those to its search; a browser
 * that cannot open `package.json` is not a browser. Second, a flat row list
 * with depth, because the tree renders as rows and the component should not
 * be walking a recursive structure while it also handles clicks.
 *
 * Search results are FILE rows only. The picker lists directories too, since
 * a directory is a tickable pathspec there; here a row is something to open,
 * and a directory does not open.
 *
 * Pure: no React, no DOM, no git. `tests/file-rows.test.ts` loads it directly.
 *
 * @module @young1lin/dsh-ui-gitworkbench/client/file-rows
 */

import type { DirEntry } from './dir-tree.ts'

/** One rendered row of the browser's tree. */
export interface FileRow {
  /** `more` is the "and N others" marker a capped directory ends with. */
  readonly kind: 'dir' | 'file' | 'more'
  /** Repo-relative path — for a file row, what gets opened. */
  readonly path: string
  /** What the row shows: the last segment, or the whole path in a search. */
  readonly name: string
  /** Indent level; 0 at the top. */
  readonly depth: number
  /** Whether this directory is expanded. Always false on a file row. */
  readonly open: boolean
  /** On a `more` row: how many entries the cap held back. */
  readonly hidden?: number
  /**
   * On a `more` row: what it is holding back.
   *
   * A directory can end with both markers — too many subdirectories AND too
   * many files — and they sit at the same depth under the same prefix, so
   * without this they are indistinguishable, including to the key the renderer
   * builds from a row.
   */
  readonly more?: 'dirs' | 'files'
}

/**
 * The files that live directly in the repository root, sorted by name.
 * @param paths - repo-relative paths, exactly as `repoTree` returned them.
 */
export function rootFiles(paths: readonly string[]): readonly string[] {
  return paths.filter(path => path.length > 0 && !path.includes('/')).sort((a, b) => a.localeCompare(b))
}

/**
 * Flatten the tree into the rows to render.
 *
 * Directories come before files at every level — the shape every file tree
 * has — and a directory's contents appear only while it is expanded. An entry
 * in `expanded` whose parent is closed contributes nothing: expansion is only
 * meaningful along a path that is itself visible.
 *
 * @param tree - top-level directories from {@link buildDirTree}.
 * @param roots - root-level files from {@link rootFiles}.
 * @param expanded - paths of the directories the reader has opened.
 * @param cap - most SUBDIRECTORIES and most files rendered per directory; the
 *              rest become one `more` row each. Each row is a button and two
 *              icons, so the cost is the DOM rather than this walk, and one
 *              click must not be able to put an unbounded number of them
 *              there. Capping files alone was not enough: a directory holding
 *              6,000 subdirectories froze the tab for 628ms on expanding it,
 *              measured, and that grows with the directory. Both caps have the
 *              same escape hatch — the search box, which reads the whole path
 *              list and ignores the tree. Omit for no cap.
 */
export function treeRows(
  tree: readonly DirEntry[],
  roots: readonly string[],
  expanded: ReadonlySet<string>,
  cap = Number.POSITIVE_INFINITY,
): readonly FileRow[] {
  const out: FileRow[] = []
  /** Emit a directory's files, then the marker if the cap bit. */
  const files = (names: readonly string[], prefix: string, depth: number): void => {
    const shown = names.length > cap ? names.slice(0, cap) : names
    for (const name of shown) {
      out.push({ kind: 'file', path: `${prefix}${name}`, name, depth, open: false })
    }
    if (names.length > shown.length) {
      out.push({
        kind: 'more',
        path: prefix,
        name: '',
        depth,
        open: false,
        hidden: names.length - shown.length,
        more: 'files',
      })
    }
  }
  const walk = (dirs: readonly DirEntry[], prefix: string, depth: number): void => {
    const shown = dirs.length > cap ? dirs.slice(0, cap) : dirs
    for (const dir of shown) {
      const open = expanded.has(dir.path)
      out.push({ kind: 'dir', path: dir.path, name: dir.name, depth, open })
      if (!open) continue
      walk(dir.children, `${dir.path}/`, depth + 1)
      files(dir.files, `${dir.path}/`, depth + 1)
    }
    if (dirs.length > shown.length) {
      out.push({
        kind: 'more',
        path: prefix,
        name: '',
        depth,
        open: false,
        hidden: dirs.length - shown.length,
        more: 'dirs',
      })
    }
  }
  walk(tree, '', 0)
  files(roots, '', 0)
  return out
}

/**
 * Every directory above a path, outermost first — what to expand so that
 * opening a file reveals it in the tree.
 */
export function ancestorsOf(path: string): readonly string[] {
  const parts = path.split('/')
  const out: string[] = []
  for (let i = 1; i < parts.length; i += 1) out.push(parts.slice(0, i).join('/'))
  return out
}

/**
 * Search the repository's files, case-insensitively over the whole path.
 *
 * Each hit carries its full path as its name: a flat list of bare filenames
 * cannot be told apart, and a repository usually holds several `index.ts`.
 *
 * @param paths - repo-relative paths as `repoTree` returned them.
 * @param needle - raw search text; blank matches nothing.
 * @param cap - most rows to return, so a one-letter search cannot render the
 *              whole repository.
 */
export function searchRows(paths: readonly string[], needle: string, cap: number): readonly FileRow[] {
  const n = needle.trim().toLowerCase()
  if (n.length === 0) return []
  const out: FileRow[] = []
  for (const path of paths) {
    if (out.length >= cap) break
    if (path.toLowerCase().includes(n)) {
      out.push({ kind: 'file', path, name: path, depth: 0, open: false })
    }
  }
  return out
}

/**
 * The browsable path list: everything git tracks, plus files that exist on
 * disk but not in HEAD.
 *
 * `repoTree` is `git ls-tree HEAD`, so a file created five minutes ago is not
 * in it — and a browser that cannot open the file you just wrote reads as
 * broken rather than as principled. The drawer already holds the working
 * tree's own file list, so the union costs one pass.
 *
 * @param tracked - paths from `repoTree`.
 * @param extra - paths from the working-tree status; deleted files must be
 *                filtered out by the caller, since opening one would fail.
 */
export function mergePaths(tracked: readonly string[], extra: readonly string[]): readonly string[] {
  const all = new Set(tracked)
  for (const path of extra) {
    if (path.length > 0) all.add(path)
  }
  return [...all].sort((a, b) => a.localeCompare(b))
}
