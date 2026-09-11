/**
 * Where a binary file's bytes live, per view.
 *
 * The Files tab has one answer — the working tree — and `fileImage` reads it.
 * The diff pane has three views, and a file's bytes are somewhere different in
 * each: on disk for a working-tree change, in a commit for history, at the
 * head ref for a comparison. A deletion inverts every one of those, because
 * the file the reader clicked no longer exists on the side the view is about,
 * and the picture being removed is the picture worth showing.
 *
 * Pure, so `tests/image-source.test.ts` can pin the table without a pane.
 *
 * @module @young1lin/dsh-ui-gitworkbench/client/image-source
 */

import type { GitFileStatus } from './git-workbench-types.ts'

/** A place the host can read a file's bytes from. */
export type ImageSource =
  /** The file under its own name on disk: `fileImage`. */
  | { readonly kind: 'worktree' }
  /** The blob `<rev>:<path>`: `revImage`. */
  | { readonly kind: 'rev'; readonly rev: string }

/**
 * Which source the diff pane should ask for, or null when the view cannot
 * name one yet.
 *
 * @param view - which tab the pane is drawing for.
 * @param status - the file's status in that view's listing.
 * @param commitHash - the selected commit, history only.
 * @param parents - that commit's parents, first parent first; a deletion is
 *   read at the first one. `<hash>^` would say the same, but `^` is not in the
 *   host's ref alphabet and the drawer already holds the parent.
 * @param baseRef - the comparison's base end, compare only.
 * @param headRef - the comparison's head end, compare only.
 */
export function imageSourceFor(
  view: 'changes' | 'history' | 'compare',
  status: GitFileStatus,
  commitHash: string | null,
  parents: readonly string[],
  baseRef: string,
  headRef: string,
): ImageSource | null {
  const deleted = status === 'deleted'
  switch (view) {
    case 'changes':
      return deleted ? { kind: 'rev', rev: 'HEAD' } : { kind: 'worktree' }
    case 'history': {
      if (commitHash === null || commitHash.length === 0) return null
      if (!deleted) return { kind: 'rev', rev: commitHash }
      const parent = parents[0]
      return parent === undefined || parent.length === 0 ? null : { kind: 'rev', rev: parent }
    }
    case 'compare': {
      if (baseRef.length === 0 || headRef.length === 0) return null
      return { kind: 'rev', rev: deleted ? baseRef : headRef }
    }
  }
}

/** A string identity for a source, so an effect can key on it. */
export function imageSourceKey(source: ImageSource): string {
  return source.kind === 'worktree' ? 'worktree' : `rev:${source.rev}`
}
