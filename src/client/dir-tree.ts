/**
 * Directory tree for the history filter's path picker, aggregated from a flat
 * file list.
 *
 * The host sends `git ls-tree -r --name-only HEAD` verbatim; this module
 * folds it into DIRECTORIES with their FILES as leaf rows — "when did this
 * file change" is the question a file row answers, and it is the most common
 * one. Everything is pure so the aggregation and the search are testable from
 * a literal file list.
 *
 * @module @young1lin/dsh-ui-gitworkbench/dir-tree
 */

/** One directory in the picker. */
export interface DirEntry {
  readonly name: string
  /** Repo-relative path — also the pathspec a tick produces. */
  readonly path: string
  /** Files in this SUBTREE — what ticking this row would match. */
  readonly fileCount: number
  /** File NAMES directly in this directory (leaf rows). */
  readonly files: readonly string[]
  /** Subdirectories, sorted by name. */
  readonly children: readonly DirEntry[]
}

/** A mutable builder node; frozen into the readonly shape at the end. */
interface BuildNode {
  name: string
  path: string
  files: string[]
  children: Map<string, BuildNode>
}

/**
 * Fold a flat path list into a sorted directory tree carrying its files.
 * Root-level files live on no directory; the SEARCH ({@link searchPaths}) is
 * where they surface.
 * @param paths - repo-relative file paths, any order, no duplicates assumed.
 * @returns the top-level directories, children and files sorted by name.
 */
export function buildDirTree(paths: readonly string[]): readonly DirEntry[] {
  const rootNode: BuildNode = { name: '', path: '', files: [], children: new Map() }
  for (const path of paths) {
    if (path.length === 0) continue
    const parts = path.split('/')
    // A trailing part is the file; every part before it must exist as a
    // directory, whether or not any other file mentioned it.
    let node = rootNode
    for (let i = 0; i < parts.length - 1; i += 1) {
      const name = parts[i]!
      let child = node.children.get(name)
      if (child === undefined) {
        child = { name, path: parts.slice(0, i + 1).join('/'), files: [], children: new Map() }
        node.children.set(name, child)
      }
      node = child
    }
    node.files.push(parts[parts.length - 1]!)
  }

  const freeze = (node: BuildNode): DirEntry => {
    const children = [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name)).map(freeze)
    const files = [...node.files].sort((a, b) => a.localeCompare(b))
    const subtreeCount = files.length + children.reduce((sum, child) => sum + child.fileCount, 0)
    return { name: node.name, path: node.path, fileCount: subtreeCount, files, children }
  }

  return freeze(rootNode).children
}

/** One flat search hit: a directory or a file path, tickable as a pathspec. */
export interface PathHit {
  readonly path: string
  readonly isFile: boolean
}

/**
 * Search the repository's paths for a fragment — case-insensitive, over the
 * full path. Results are FLAT: a search list is not a tree (the same honesty
 * as the filtered commit list), and each hit ticks as a pathspec directly.
 *
 * Directories match too: every directory is some file's prefix, and ticking a
 * directory covers its subtree — the search takes the raw path list the host
 * sent, so root-level files and unexpanded directories are all in scope.
 * @param paths - repo-relative file paths, exactly as `repoTree` returned.
 * @param needle - raw search text; blank matches nothing (caller shows the tree).
 */
export function searchPaths(paths: readonly string[], needle: string): readonly PathHit[] {
  const n = needle.trim().toLowerCase()
  if (n.length === 0) return []
  const hits: PathHit[] = []
  const seen = new Set<string>()
  for (const path of paths) {
    if (path.toLowerCase().includes(n)) {
      hits.push({ path, isFile: true })
      seen.add(path)
    }
    // Every directory prefix is a candidate too; deduped via `seen`.
    const parts = path.split('/')
    for (let i = 1; i < parts.length; i += 1) {
      const dir = parts.slice(0, i).join('/')
      if (!seen.has(dir) && dir.toLowerCase().includes(n)) {
        seen.add(dir)
        hits.push({ path: dir, isFile: false })
      }
    }
  }
  // Files first — the common query is a file; the directory that contains it
  // reads better below it than above.
  return [...hits.filter(hit => hit.isFile), ...hits.filter(hit => !hit.isFile)]
}
