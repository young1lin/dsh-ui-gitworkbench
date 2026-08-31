/**
 * Where the drawer runs git: at the repository ROOT, not at the directory the
 * session happened to open.
 *
 * Every path the drawer carries — the tree's entries, the diff's pathspecs,
 * the editor's save target — is REPOSITORY-RELATIVE, because that is what
 * `git status --porcelain` and `git diff --numstat` print wherever they run.
 * Pathspecs and `:path` revisions are the opposite: git resolves them against
 * the process cwd. The two coincide only when the session opened the root
 * itself. A session opened at a subdirectory (a monorepo's `server/`, say)
 * gets a drawer that LISTS the right files and then quietly fails to do
 * anything with them: `git diff HEAD -- server/main.go` run from `server/`
 * looks for `server/server/main.go`, matches nothing, and exits 0 with empty
 * output — a changed file that opens to a blank pane, a stage tick that dies
 * with "pathspec did not match", a blame that cannot find the path in HEAD.
 *
 * Resolving the root once and running everything there makes every
 * repository-relative spelling correct by construction, whatever directory the
 * session opened. The resolve is a real git spawn per RPC entry — folded into
 * the parallel batch where a poll pays for it — and deliberately NOT cached:
 * re-resolving per call is what lets `git init` run inside a subdirectory
 * mid-session and be picked up by the next poll, and a cache would trade that
 * for a spawn that already runs concurrently with the reads it precedes.
 *
 * Pure and git-injected (the `write-checked` pattern) so vitest can pin both
 * halves: the resolution itself, and the git behaviors the whole arrangement
 * rests on.
 *
 * @module @young1lin/dsh-ui-gitworkbench/repo-root
 */

import type { GitRun } from './apply-blocks.js'

/** Run git in `cwd`. Must not throw — report through `exitCode`/`stderr`. */
export type RootGit = (cwd: string, argv: readonly string[]) => Promise<GitRun>

/**
 * The repository root of a directory, or null when git knows none.
 *
 * `--show-toplevel` is the discovery git itself uses, so what it returns is by
 * definition where the porcelain paths of commands run in that directory are
 * rooted — including a linked worktree's own root when the directory sits in
 * one. Output is normalized to forward slashes so `join()` behaves the same on
 * every platform (git for Windows already prints them that way).
 * @param git - how to run git.
 * @param cwd - any directory inside the repository.
 */
export async function resolveRepoRoot(git: RootGit, cwd: string): Promise<string | null> {
  const out = await git(cwd, ['rev-parse', '--show-toplevel'])
  if (out.exitCode !== 0) return null
  return out.stdout.trim().replace(/\\/g, '/') || null
}

/**
 * The directory to run git in for a session's workspace: its repository root,
 * or the directory itself when it is not inside a repository.
 *
 * The fallback keeps the failure honest: outside a repository the caller's own
 * git run fails exactly as it did before this module existed, and that error —
 * not a resolution error — is what the reader should see.
 * @param git - how to run git.
 * @param cwd - the directory the session opened.
 */
export async function rootedDir(git: RootGit, cwd: string): Promise<string> {
  return (await resolveRepoRoot(git, cwd)) ?? cwd
}
