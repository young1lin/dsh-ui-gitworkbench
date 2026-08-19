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
