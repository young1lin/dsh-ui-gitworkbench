/**
 * The one filesystem delete in this plugin, and the checks it carries.
 *
 * `discard-ops.ts` plans a delete when git has no copy of a file to restore
 * from — untracked, or added-but-never-committed. git will not carry that out:
 * `git clean` refuses paths it cannot index, which on Windows includes every
 * reserved device name (`nul`, `con`, `aux`, `com1`, and the same names with
 * any extension). So the removal goes through the filesystem, where git's own
 * refusal to leave the repository does not apply — hence the path lock in
 * `path-lock.ts` rather than a bare `rm`.
 *
 * Lives outside `index.ts` so vitest can load it: the class there needs the
 * dsh runtime, and the property worth testing is "what does this delete, and
 * what does it refuse" — a question about paths and the disk, not about RPC.
 *
 * @module @young1lin/dsh-ui-gitworkbench/fs-remove
 */

import { rm } from 'node:fs/promises'

import { resolveInside } from './path-lock.js'

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
 * A symlinked directory inside the worktree could still point outward — the
 * limit of a lexical resolve, stated where the lock is.
 *
 * @param root - the worktree directory, absolute.
 * @param relative - repo-relative path from a plan step.
 */
export async function removePathInside(root: string, relative: string): Promise<void> {
  await rm(resolveInside(root, relative), { recursive: true, force: true })
}
