/**
 * Where the reader is in the Files tab — the file they have open, the folders
 * they have opened, the search they typed, whether blame is on.
 *
 * This is separate from the browser component because the component unmounts:
 * switching to Changes and back used to lose the selection and every expanded
 * folder, which is the difference between a tab you return to and a tab you
 * start over in. Keeping the place one level up means the tab remembers, and
 * the cached path list means returning renders the tree at once instead of
 * blanking while the repository is re-read.
 *
 * Expanded folders are NOT pruned against the current file list. A directory
 * can leave `ls-tree` because a branch was checked out or a rebase is halfway
 * through, and re-opening the same six folders every time that happens is the
 * annoyance this module exists to remove — a stale entry renders nothing and
 * costs one string. A file that has genuinely gone IS dropped, because an
 * editor over a file that is not there would show an empty buffer as if the
 * file itself were empty. That case is reported rather than silently applied:
 * a selection that clears itself with no explanation reads as a bug.
 *
 * Pure: no React, no DOM, no git. `tests/files-place.test.ts` loads it.
 *
 * @module @young1lin/dsh-ui-gitworkbench/client/files-place
 */

import { ancestorsOf } from './file-rows.ts'

/** The reader's position in the Files tab. Serialisable — no Set, no Map. */
export interface FilesPlace {
  /** The open file's repo-relative path, or null for none. */
  readonly open: string | null
  /** Paths of the directories the reader has opened. */
  readonly expanded: readonly string[]
  /** The search box's text. */
  readonly query: string
  /** Whether the blame gutter is showing. */
  readonly blameOn: boolean
}

/** Nothing open, nothing expanded — the tab before it is first used. */
export const NO_PLACE: FilesPlace = { open: null, expanded: [], query: '', blameOn: false }

/**
 * Open a file: it becomes the selection, and every folder above it opens so
 * that it is visible in the tree.
 */
export function openAt(place: FilesPlace, path: string): FilesPlace {
  const expanded = new Set(place.expanded)
  for (const dir of ancestorsOf(path)) expanded.add(dir)
  return { ...place, open: path, expanded: [...expanded] }
}

/** Fold or unfold one directory. */
export function toggleDir(place: FilesPlace, path: string): FilesPlace {
  const expanded = new Set(place.expanded)
  if (expanded.has(path)) expanded.delete(path)
  else expanded.add(path)
  return { ...place, expanded: [...expanded] }
}

/** What a reconciliation did, so the caller can say so. */
export interface Reconciled {
  readonly place: FilesPlace
  /** The path that was open and is not in the repository any more, else null. */
  readonly vanished: string | null
}

/**
 * Settle the place against a freshly read file list.
 *
 * @param place - the reader's position as it stands.
 * @param paths - every path the repository now has. An EMPTY list is treated
 *                as "not read yet" rather than as "the repository is empty":
 *                the fetch is in flight for most of the time this runs, and
 *                blanking someone's selection on an in-flight fetch would
 *                clear it every time the tab is opened.
 */
export function reconcilePlace(place: FilesPlace, paths: readonly string[]): Reconciled {
  if (place.open === null || paths.length === 0) return { place, vanished: null }
  if (paths.includes(place.open)) return { place, vanished: null }
  return { place: { ...place, open: null }, vanished: place.open }
}

/**
 * One place per worktree, because a worktree IS a different place: it holds
 * different files, at different paths, and the file the reader had open may
 * simply not exist in the one they switched to. Sharing a single place across
 * sources also meant the tree kept rendering the PREVIOUS worktree's files
 * until the new list arrived.
 *
 * Keyed by {@link pathKey}, so the same worktree is one entry however the path
 * reached the drawer — `git worktree list` reports forward slashes and a
 * session cwd arrives with the platform's own.
 */
export type FilesPlaces = ReadonlyMap<string, FilesPlace>

/** This worktree's place, or a fresh one for a worktree not visited yet. */
export function placeAt(places: FilesPlaces, key: string): FilesPlace {
  return places.get(key) ?? NO_PLACE
}

/**
 * Record this worktree's place, leaving every other worktree's alone.
 *
 * The key is re-inserted rather than overwritten, so iteration order is
 * least-recent first. That is what makes {@link encodePlaces}'s cap mean
 * "the worktrees you actually work in" instead of "the first twenty you
 * happened to open".
 */
export function withPlace(places: FilesPlaces, key: string, place: FilesPlace): FilesPlaces {
  const next = new Map(places)
  next.delete(key)
  next.set(key, place)
  return next
}

/** Worktrees kept across restarts. Enough for the ones anybody actually works
 *  in; a fixture repository alone can have forty. */
export const PLACES_CAP = 20

/** One worktree's place as it is stored. */
interface StoredPlace {
  readonly key: string
  readonly open: string | null
  readonly expanded: readonly string[]
  readonly blame: boolean
}

/**
 * The places, ready for storage: the most recent {@link PLACES_CAP}, without
 * the search text.
 *
 * The search is deliberately dropped. Restoring it would filter the tree on a
 * cold start, and a tree showing two rows out of nine hundred reads as broken
 * when you do not remember typing anything — within one session you remember,
 * a week later you do not.
 */
export function encodePlaces(places: FilesPlaces): readonly StoredPlace[] {
  const all = [...places.entries()]
  const kept = all.length > PLACES_CAP ? all.slice(all.length - PLACES_CAP) : all
  return kept.map(([key, place]) => ({
    key,
    open: place.open,
    expanded: [...place.expanded],
    blame: place.blameOn,
  }))
}

/** Whether a parsed value is one stored place this build can use. */
function isStoredPlace(value: unknown): value is StoredPlace {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  return typeof entry.key === 'string'
    && (entry.open === null || typeof entry.open === 'string')
    && Array.isArray(entry.expanded)
    && entry.expanded.every(path => typeof path === 'string')
    && typeof entry.blame === 'boolean'
}

/**
 * Read places back. Anything unrecognisable is skipped rather than failing the
 * whole list: a build that adds a field should cost the reader one worktree's
 * memory, not all of them.
 */
export function decodePlaces(value: unknown): FilesPlaces {
  if (!Array.isArray(value)) return new Map()
  const out = new Map<string, FilesPlace>()
  for (const entry of value) {
    if (!isStoredPlace(entry)) continue
    out.set(entry.key, {
      open: entry.open,
      expanded: entry.expanded,
      query: '',
      blameOn: entry.blame,
    })
  }
  return out
}
