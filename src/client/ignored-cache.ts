/**
 * The lazily read children of ignored directories, held as a BOUNDED cache.
 *
 * Browsing `node_modules/` reads one level per click, and every level read
 * stays around so folding and unfolding does not re-read the disk. Left
 * alone that is a cache that only grows: a long session drilling through a
 * dependency tree accumulates every level it ever opened, and "an unbounded
 * cache is a leak with a nicer name".
 *
 * So the cache carries its own size and evicts, with one exception that is
 * not negotiable: it never evicts a directory the reader is LOOKING at.
 * Dropping the children of an expanded row would make the effect that fills
 * it read them again, which would evict something else, which would be read
 * again — a cache that fights the viewport spins forever. The cap is
 * therefore a fuse against accumulated browsing, and the `keep` set is the
 * floor it will not cut below.
 *
 * Pure: no React, no DOM, no RPC. `tests/ignored-cache.test.ts` loads it.
 *
 * @module @young1lin/dsh-ui-gitworkbench/client/ignored-cache
 */

import type { DirEntry } from './dir-tree.ts'

/** One entry of a lazily listed ignored directory: a name plus whether
 *  expanding it again makes sense. */
export interface IgnoredChild {
  readonly name: string
  readonly dir: boolean
}

/** One directory's read, exactly as the host answered it. */
export interface DirRead {
  readonly entries: readonly IgnoredChild[]
  /** Whether the host cut this directory's listing at its own cap. */
  readonly truncated: boolean
}

/**
 * Every directory read so far, plus the two things a bound needs: the order
 * they were read in (the eviction queue, oldest first) and the total entry
 * count, so a test can PROVE the bound instead of trusting it.
 */
export interface IgnoredCache {
  readonly reads: Readonly<Record<string, DirRead>>
  readonly order: readonly string[]
  /** Total entries held across every directory. */
  readonly size: number
}

/** Nothing read yet. One instance, so an untouched worktree does not
 *  re-render the browser on every pass. */
export const NO_IGNORED_READS: IgnoredCache = { reads: {}, order: [], size: 0 }

/**
 * Most entries held across all directories at once. A real level is a few
 * hundred, so reaching this takes dozens of expansions of pathological
 * directories; it is the fuse, not a working number.
 */
export const IGNORED_CACHE_CAP = 20_000

/**
 * Record one directory's children, evicting the oldest reads that nobody is
 * looking at until the cache is back under the cap.
 *
 * @param cache - the cache as it stands.
 * @param dir - repo-relative directory the read belongs to.
 * @param read - what the host answered.
 * @param keep - directories that must survive eviction: the ones expanded on
 *               screen, and the ancestors of the open file (whose path must
 *               stay in the browsable list or the editor would report it
 *               vanished). The directory being written is always kept.
 * @param cap - most entries to hold in total.
 */
export function rememberDir(
  cache: IgnoredCache,
  dir: string,
  read: DirRead,
  keep: ReadonlySet<string>,
  cap: number = IGNORED_CACHE_CAP,
): IgnoredCache {
  const reads: Record<string, DirRead> = { ...cache.reads, [dir]: read }
  const order = [...cache.order.filter(key => key !== dir), dir]
  let size = cache.size - (cache.reads[dir]?.entries.length ?? 0) + read.entries.length

  // Oldest first, skipping what is on screen. When everything left is kept,
  // the walk simply ends: over the cap and holding only visible rows is the
  // one state where the right move is to hold them.
  let index = 0
  while (size > cap && index < order.length) {
    const victim = order[index]!
    if (victim === dir || keep.has(victim)) { index += 1; continue }
    size -= reads[victim]?.entries.length ?? 0
    delete reads[victim]
    order.splice(index, 1)
  }
  return { reads, order, size }
}

/** Whether any directory still held was cut at the host's per-directory cap.
 *  Derived rather than sticky: a cut directory that has been evicted, or a
 *  refresh that replaced the cache, stops claiming it. */
export function anyDirTruncated(cache: IgnoredCache): boolean {
  for (const read of Object.values(cache.reads)) {
    if (read.truncated) return true
  }
  return false
}

/** Files plus subtree counts — the invariant every {@link DirEntry} carries. */
function countOf(files: readonly string[], children: readonly DirEntry[]): number {
  return files.length + children.reduce((sum, child) => sum + child.fileCount, 0)
}

/** Merge one directory's read into the node that stands for it. Names the
 *  node already has win: the path list is the primary source, and a read that
 *  disagrees with it must not split one name into two rows. */
function withChildren(entry: DirEntry, read: DirRead): DirEntry {
  const haveDirs = new Set(entry.children.map(child => child.name))
  const haveFiles = new Set(entry.files)
  const files = [...entry.files]
  const children = [...entry.children]
  for (const child of read.entries) {
    if (haveDirs.has(child.name) || haveFiles.has(child.name)) continue
    if (child.dir) {
      haveDirs.add(child.name)
      children.push({ name: child.name, path: `${entry.path}/${child.name}`, fileCount: 0, files: [], children: [] })
    } else {
      haveFiles.add(child.name)
      files.push(child.name)
    }
  }
  files.sort((a, b) => a.localeCompare(b))
  children.sort((a, b) => a.name.localeCompare(b.name))
  return { ...entry, files, children, fileCount: countOf(files, children) }
}

/** Rebuild only the spine down to `parts`, leaving every other node — and
 *  every other subtree's identity — exactly as it was. Null when the path is
 *  not in the tree, which is how a read for a directory a refresh dropped
 *  becomes a no-op instead of an error. */
function replaceAt(
  dirs: readonly DirEntry[],
  parts: readonly string[],
  depth: number,
  apply: (entry: DirEntry) => DirEntry,
): readonly DirEntry[] | null {
  const name = parts[depth]!
  const index = dirs.findIndex(dir => dir.name === name)
  if (index === -1) return null
  const current = dirs[index]!
  let next: DirEntry
  if (depth === parts.length - 1) {
    next = apply(current)
  } else {
    const grafted = replaceAt(current.children, parts, depth + 1, apply)
    if (grafted === null) return null
    next = { ...current, children: grafted, fileCount: countOf(current.files, grafted) }
  }
  const out = [...dirs]
  out[index] = next
  return out
}

/**
 * Graft every read directory's children onto the tree built from the path
 * list.
 *
 * This is the reason expanding an ignored directory is not O(repository):
 * rebuilding the tree from a merged path list meant a fresh `Set`, a fresh
 * `localeCompare` sort and a fresh walk over EVERY path on every click —
 * measured at 140ms on a 50,000-path repository, synchronously, on the click.
 * Grafting touches only the nodes on the path to each read directory, so the
 * cost is the depth of what was clicked plus the width of what came back.
 *
 * Shallow directories are grafted first, so the empty node a parent's read
 * creates exists by the time its own read is grafted onto it.
 *
 * @param tree - the tree from {@link buildDirTree} over the path list.
 * @param cache - the directories read so far.
 */
export function attachReads(tree: readonly DirEntry[], cache: IgnoredCache): readonly DirEntry[] {
  const dirs = Object.keys(cache.reads)
  if (dirs.length === 0) return tree
  const shallowFirst = [...dirs].sort((a, b) => a.split('/').length - b.split('/').length)
  let out = tree
  for (const dir of shallowFirst) {
    if (dir.length === 0) continue
    const grafted = replaceAt(out, dir.split('/'), 0, entry => withChildren(entry, cache.reads[dir]!))
    if (grafted !== null) out = grafted
  }
  return out
}
