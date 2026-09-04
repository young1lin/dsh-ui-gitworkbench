/**
 * The one place a client-supplied path becomes an absolute path on disk.
 *
 * git needs no such lock: whatever pathspec it is handed, it will not read or
 * write outside the repository, which is why `isSafePathArg` only has to keep
 * a path from being mistaken for an option. The moment a path leaves git and
 * reaches `readFile`, `stat` or `readdir`, that backstop is gone — `join(root,
 * '../../../etc/passwd')` is just a path, and the browser is the least trusted
 * source of paths this plugin has.
 *
 * So every filesystem call in the host resolves through here, and the RPCs
 * that do it are pinned by `host-rooted-paths.test.ts` so a new one cannot
 * quietly join a client string onto the root instead.
 *
 * What this does NOT defend against, deliberately and for the same reason
 * `fs-remove.ts` says so: `resolve` is lexical, so a SYMLINK inside the
 * worktree that points outward still resolves inside and is followed. Closing
 * that means a `realpath` per segment on every read of every file, for a case
 * git itself does not defend against and that presupposes write access to the
 * repository the reader already opened.
 *
 * @module @young1lin/dsh-ui-gitworkbench/path-lock
 */

import { resolve, sep } from 'node:path'

import { isSafeRelativePath } from './discard-ops.js'

/**
 * Resolve a repo-relative path against the worktree root, refusing to leave it.
 *
 * Two locks, not one. {@link isSafeRelativePath} rejects the traversal
 * SPELLINGS — absolute paths, drive letters, UNC prefixes, NUL bytes, any `..`
 * segment including one buried mid-path. The `startsWith` below re-checks the
 * RESOLVED path, which is the form the filesystem acts on, so a path that
 * survives the first check by being spelled unusually still has to land inside
 * the root to be acted on.
 *
 * @param root - the worktree directory, absolute.
 * @param relative - repo-relative path from the client or from git's output.
 * @returns the absolute path to act on.
 * @throws if the path is not a safe relative path, resolves outside the root,
 *         or IS the root.
 */
export function resolveInside(root: string, relative: string): string {
  if (!isSafeRelativePath(relative)) {
    throw new Error(`unsafe path argument: ${JSON.stringify(relative)}`)
  }
  const base = resolve(root)
  const target = resolve(base, relative)
  if (target === base) throw new Error('refusing to act on the worktree root itself')
  if (!target.startsWith(base + sep)) {
    throw new Error(`path escapes the worktree: ${JSON.stringify(relative)}`)
  }
  return target
}
