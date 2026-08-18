/**
 * The one filesystem delete in this plugin, and the checks it carries.
 *
 * `discard-ops.ts` plans a delete when git has no copy of a file to restore
 * from — untracked, or added-but-never-committed. git will not carry that out:
 * `git clean` refuses paths it cannot index, which on Windows includes every
 * reserved device name (`nul`, `con`, `aux`, `com1`, and the same names with
 * any extension). So the removal goes through the filesystem, where git's own
 * refusal to leave the repository does not apply — hence the checks here
 * rather than a bare `rm`.
 *
 * Lives outside `index.ts` so vitest can load it: the class there needs the
 * dsh runtime, and the property worth testing is "what does this delete, and
 * what does it refuse" — a question about paths and the disk, not about RPC.
 *
 * @module @young1lin/dsh-ui-gitworkbench/fs-remove
 */

import { rm } from 'node:fs/promises'
import { resolve, sep } from 'node:path'

import { isSafeRelativePath } from './discard-ops.js'

/**
 * Resolve a repo-relative path against the worktree root, refusing to leave it.
 *
 * The second lock rather than the only one: {@link isSafeRelativePath} already
 * rejected traversal spellings when the plan was made. This re-checks the
 * RESOLVED path, which is the form the filesystem acts on, so a path that
 * survives the first check by being spelled unusually still has to land inside
 * the root to be acted on.
 *
 * @param root - the worktree directory, absolute.
 * @param relative - repo-relative path from a plan step.
 * @returns the absolute path to act on.
 * @throws if the path is not a safe relative path, resolves outside the root,
 *         or IS the root.
 */
export function resolveInside(root: string, relative: string): string {
  if (!isSafeRelativePath(relative)) {
    throw new Error(`unsafe path to delete: ${JSON.stringify(relative)}`)
  }
  const base = resolve(root)
  const target = resolve(base, relative)
  if (target === base) throw new Error('refusing to delete the worktree root')
  if (!target.startsWith(base + sep)) {
    throw new Error(`refusing to delete outside the worktree: ${JSON.stringify(relative)}`)
  }
  return target
}

/**
 * Remove one entry from the worktree, having proven it is inside it.
 *
 * `recursive` is not a widening of the blast radius: `resolveInside` has
 * already pinned the target to one path git named, and git names a DIRECTORY
 * whenever it will not look inside one — an untracked nested repository is
 * reported as `sub/`, with no per-file lines even under
 * `--untracked-files=all`. Without `recursive` that row is the only one in the
 * drawer whose roll-back fails, and it fails as `EISDIR`, which says nothing
 * to the person who clicked it.
 *
 * `force` makes an absent entry a success: the reader asked for it to be gone,
 * and it is.
 *
 * A symlinked directory inside the worktree could still point outward; that is
 * a repository someone already has write access to, and resolving link targets
 * per segment on every delete would cost a stat per segment for a case git
 * itself does not defend against.
 *
 * @param root - the worktree directory, absolute.
 * @param relative - repo-relative path from a plan step.
 */
export async function removePathInside(root: string, relative: string): Promise<void> {
  await rm(resolveInside(root, relative), { recursive: true, force: true })
}
