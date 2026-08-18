/**
 * Checkbox-tree semantics for the path picker.
 *
 * Ticking a FOLDER means its whole subtree — so the selection is a set of
 * pathspecs with an invariant: no member covers another. Ticking a folder
 * absorbs the files already ticked inside it (the lone file's chip gives way
 * to the folder's one); unticking one file under a checked folder cascades
 * OUT — the folder is replaced by its other children, level by level. Rows
 * then DERIVE their checkbox state (on / off / partial) from the set, which
 * is why ticking a folder visibly checks everything under it.
 *
 * Pure throughout; the index is built from the same raw path list the host
 * sent, so children order is the tree's alphabetical order.
 *
 * @module @young1lin/dsh-ui-gitworkbench/path-select
 */

/** Directory path → its direct children, full paths, files and dirs apart. */
export interface PathIndex {
  readonly dirs: ReadonlyMap<string, readonly string[]>
  readonly files: ReadonlyMap<string, readonly string[]>
}

/**
 * Index a raw path list for child lookup.
 * @param paths - repo-relative file paths, exactly as `repoTree` returned.
 */
export function buildIndex(paths: readonly string[]): PathIndex {
  const dirs = new Map<string, string[]>()
  const files = new Map<string, string[]>()
  const noteDir = (dir: string): void => {
    if (!dirs.has(dir)) dirs.set(dir, [])
  }
  noteDir('')
  for (const path of paths) {
    if (path.length === 0) continue
    const parts = path.split('/')
    let dir = ''
    for (let i = 0; i < parts.length - 1; i += 1) {
      const childDir = dir === '' ? parts[i]! : `${dir}/${parts[i]!}`
      noteDir(childDir)
      const list = dirs.get(dir)!
      if (!list.includes(childDir)) list.push(childDir)
      dir = childDir
    }
    const list = files.get(dir) ?? []
    list.push(path)
    files.set(dir, list)
  }
  for (const list of dirs.values()) list.sort()
  for (const list of files.values()) list.sort()
  return { dirs, files }
}

/** Children of a directory, alphabetical by full path — the tree's order. */
function childrenOf(index: PathIndex, dir: string): readonly string[] {
  return [...(index.dirs.get(dir) ?? []), ...(index.files.get(dir) ?? [])].sort()
}

/**
 * Is `p` selected — itself ticked, or inside a ticked directory?
 * (Segment-boundary prefix: `src` does not cover `src2`.)
 */
export function isCovered(paths: readonly string[], p: string): boolean {
  return paths.some(tick => tick === p || p.startsWith(`${tick}/`))
}

/**
 * Tick a path. No-op when an ancestor already covers it; absorbs every
 * descendant it covers, keeping the set minimal — one folder chip, never the
 * pile of files under it.
 */
export function addPath(paths: readonly string[], p: string): readonly string[] {
  if (isCovered(paths, p)) return paths
  const kept = paths.filter(tick => !(tick === p || tick.startsWith(`${p}/`)))
  return [...kept, p]
}

/**
 * Untick a path. Removing an exact tick drops it; removing a file COVERED by
 * a ticked folder replaces that folder with its other children, level by
 * level down to the file — the standard cascade-out.
 */
export function removePath(paths: readonly string[], p: string, index: PathIndex): readonly string[] {
  const out: string[] = []
  for (const tick of paths) {
    if (tick !== p && !p.startsWith(`${tick}/`)) {
      out.push(tick)
      continue
    }
    // This tick is p itself or an ancestor of it; replace it with the subtree
    // minus p. Walk down the chain, adding each level's other children.
    let dir = tick
    while (dir !== p) {
      // The child of `dir` on the way to p: the next path segment.
      const rest = p.slice(dir.length + 1)
      const nextName = dir === '' ? p.split('/')[0]! : rest.split('/')[0]!
      const next = dir === '' ? nextName : `${dir}/${nextName}`
      for (const child of childrenOf(index, dir)) {
        if (child !== next) out.push(child)
      }
      dir = next
    }
  }
  return out
}

/** Every file under a directory (empty for a file path). */
function filesUnder(index: PathIndex, dir: string): readonly string[] {
  const out: string[] = []
  const stack = [dir]
  while (stack.length > 0) {
    const current = stack.pop()!
    out.push(...(index.files.get(current) ?? []))
    stack.push(...(index.dirs.get(current) ?? []))
  }
  return out
}

/**
 * A row's checkbox state, derived: `on` when covered — by an ancestor tick OR
 * by every file under it being covered individually; `partial` when a
 * directory holds some but not all of its files; else `off`.
 */
export function checkedState(paths: readonly string[], p: string, index: PathIndex): 'on' | 'off' | 'partial' {
  if (isCovered(paths, p)) return 'on'
  const files = filesUnder(index, p)
  if (files.length === 0) return 'off'
  const covered = files.filter(file => isCovered(paths, file)).length
  return covered === files.length ? 'on' : covered > 0 ? 'partial' : 'off'
}
