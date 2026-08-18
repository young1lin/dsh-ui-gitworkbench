/**
 * What "discard this file" resolves to, as a plan the host can carry out.
 *
 * This is the confirmation design `git-ops.ts` says a destructive button owes
 * before it may exist. Three rules hold here, and each one closes a way this
 * feature could quietly destroy the wrong thing:
 *
 *   - **The plan is derived from git's OWN report of the file, never from what
 *     the client said it was.** A client that mislabels a tracked file as
 *     untracked would otherwise turn a restore into a delete. `planFor` takes
 *     a porcelain XY pair that the host read itself.
 *   - **No plan may contain a destructive spelling.** Not `clean`, not
 *     `reset --hard`, not `checkout -f`, no `--force`. `git restore` scoped to
 *     one pathspec after `--` is the whole vocabulary; a stray `clean` would
 *     take out every untracked file in the tree instead of the one named.
 *     `tests/discard-ops.test.ts` scans every plan this module can produce.
 *   - **A path that is deleted from disk is checked far harder than a
 *     pathspec.** git refuses to leave the repository; `fs.rm` does not, so
 *     `isSafeRelativePath` rejects absolutes, drive letters, UNC prefixes and
 *     any `..` segment before a delete step can name a file.
 *
 * IDEA parity decides the semantics: Rollback there takes a file back to its
 * committed state in one gesture and does not ask whether the change was
 * staged, so neither does this. A file that was never committed goes away; a
 * file that was deleted comes back.
 *
 * Pure throughout — no spawning, no fs. `src/index.ts` executes the steps.
 *
 * @module @young1lin/dsh-ui-gitworkbench/discard-ops
 */

import { isSafePathArg, parseStatusLine } from './git-ops.js'

/** One thing the host does, in order. */
export type DiscardStep =
  /** Run git with this argv. */
  | { readonly kind: 'git'; readonly argv: readonly string[] }
  /** Remove this repo-relative path from disk. Tolerates an absent file. */
  | { readonly kind: 'delete'; readonly path: string }

/**
 * What the reader is about to lose, which is what the confirmation must say.
 * The client maps these to copy; keeping them as data means the wording can be
 * bilingual without this module knowing about locales.
 */
export type DiscardEffect =
  /** Tracked file returns to its committed content. Local edits are gone. */
  | 'restore'
  /** File leaves the disk. git never had it, so nothing can bring it back. */
  | 'delete'
  /** A deleted file comes back. Nothing is lost — no confirmation needed. */
  | 'recover'
  /** A rename is undone: the old path returns, the new one goes. */
  | 'unrename'

export interface DiscardPlan {
  readonly steps: readonly DiscardStep[]
  readonly effect: DiscardEffect
  /**
   * Whether carrying this out can lose work no git object holds. Drives
   * whether the client confirms at all: recovering a deleted file is pure
   * gain, and a dialog in front of it is noise that teaches people to click
   * through dialogs.
   */
  readonly irreversible: boolean
  /** The path the reader named, for the confirmation copy. */
  readonly path: string
  /** For `unrename`, the path the file is going back to. */
  readonly previousPath?: string
}

/**
 * Whether a path is safe to hand a filesystem delete.
 *
 * Stricter than {@link isSafePathArg}, which only has to keep git from reading
 * a path as an option: git will not step outside the repository whatever it is
 * given, so a pathspec needs no traversal check. A delete has no such backstop.
 * Rejected: absolute paths (POSIX and Windows), UNC prefixes, drive letters,
 * NUL bytes, and any `..` segment — including one buried mid-path, which is
 * how traversal is usually spelled.
 * @param path - repo-relative path from a plan step.
 */
export function isSafeRelativePath(path: string): boolean {
  if (!isSafePathArg(path)) return false
  if (path.includes('\0')) return false
  // Windows accepts both separators, so normalise before splitting or
  // `a\..\..\b` walks out through a check that only knew about `/`.
  const unified = path.replace(/\\/g, '/')
  if (unified.startsWith('/')) return false
  if (/^[A-Za-z]:/.test(unified)) return false
  if (unified.startsWith('//')) return false
  return !unified.split('/').includes('..')
}

/** Take one file back to HEAD in both the index and the working tree. */
function restoreBoth(path: string): DiscardStep {
  return { kind: 'git', argv: ['restore', '--source=HEAD', '--staged', '--worktree', '--', path] }
}

/** Drop a file's index entry, leaving the working tree untouched. */
function unstage(path: string): DiscardStep {
  return { kind: 'git', argv: ['restore', '--staged', '--', path] }
}

/**
 * The plan for one file, from git's own porcelain line.
 *
 * @param xy - the two porcelain status columns for this path, e.g. ` M`, `??`,
 *             `R `. Read by the host from `git status --porcelain`, never
 *             supplied by the client.
 * @param path - repo-relative path, as git printed it.
 * @param previousPath - for a rename, the path HEAD still knows the file by.
 * @returns the ordered plan, or null when the file has nothing to discard.
 * @throws if a path is not safe to pass on.
 */
export function planFor(xy: string, path: string, previousPath?: string): DiscardPlan | null {
  if (!isSafePathArg(path)) throw new Error(`unsafe path argument: ${JSON.stringify(path)}`)
  const index = xy[0] ?? ' '
  const worktree = xy[1] ?? ' '

  // Untracked and ignored: git has no copy, so the only way back is the
  // filesystem's, and there is none.
  if (xy === '??' || xy === '!!') {
    if (!isSafeRelativePath(path)) throw new Error(`unsafe path to delete: ${JSON.stringify(path)}`)
    return { steps: [{ kind: 'delete', path }], effect: 'delete', irreversible: true, path }
  }

  // A rename: HEAD holds `previousPath`, the index holds `path`. Bring the old
  // one back first, then retire the new one — doing it the other way round
  // would leave the tree with neither name for as long as the second step
  // takes, which a reader watching a file tree would see.
  if (index === 'R' || index === 'C') {
    if (previousPath === undefined || !isSafePathArg(previousPath)) {
      throw new Error(`rename without a usable previous path: ${JSON.stringify(path)}`)
    }
    if (!isSafeRelativePath(path)) throw new Error(`unsafe path to delete: ${JSON.stringify(path)}`)
    return {
      steps: [restoreBoth(previousPath), unstage(path), { kind: 'delete', path }],
      effect: 'unrename',
      irreversible: true,
      path,
      previousPath,
    }
  }

  // Added to the index but absent from HEAD: rolling back means the file was
  // never committed, so it leaves. Unstage first — otherwise the index would
  // still carry an entry for a path that no longer exists on disk.
  if (index === 'A') {
    if (!isSafeRelativePath(path)) throw new Error(`unsafe path to delete: ${JSON.stringify(path)}`)
    return {
      steps: [unstage(path), { kind: 'delete', path }],
      effect: 'delete',
      irreversible: true,
      path,
    }
  }

  // Deleted, either side. HEAD still has the content, so this is recovery:
  // nothing is lost and nothing needs confirming.
  if (index === 'D' || worktree === 'D') {
    return { steps: [restoreBoth(path)], effect: 'recover', irreversible: false, path }
  }

  // Everything else that git reported as changed — modified, type-changed,
  // staged, unstaged, or both — goes back to HEAD wholesale. Content only the
  // working tree ever held has no object behind it.
  if (index !== ' ' || worktree !== ' ') {
    return { steps: [restoreBoth(path)], effect: 'restore', irreversible: true, path }
  }

  // Clean: git reported the path with nothing to say about it.
  return null
}

/**
 * Find the file in a status report and plan for it.
 *
 * The report is the WHOLE tree's, not one narrowed by a pathspec: git detects
 * a rename by pairing a deletion with an addition, and a pathspec that admits
 * only one of the pair turns `R old -> new` into an unrelated `D` and `??`.
 * The plan for those two is delete-and-lose where the truth is un-rename.
 *
 * @param stdout - `git status --porcelain=v1` over the whole worktree.
 * @param path - the file the reader asked about, as the drawer lists it.
 * @returns the plan, or null when git does not report that path as changed —
 *          which is also what a stale tree looks like, and is not an error.
 */
export function planFromStatus(stdout: string, path: string): DiscardPlan | null {
  if (!isSafePathArg(path)) throw new Error(`unsafe path argument: ${JSON.stringify(path)}`)
  for (const line of stdout.split('\n')) {
    const parsed = parseStatusLine(line)
    if (parsed === null || parsed.path !== path) continue
    return planFor(parsed.xy, parsed.path, parsed.renamed ? parsed.previousPath : undefined)
  }
  return null
}
