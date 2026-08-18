/**
 * Argument vectors and output readers for the drawer's WRITE operations —
 * stage, unstage, commit, fetch, pull, push.
 *
 * Everything here is a pure function over strings, kept apart from the RPC
 * methods in `index.ts` so the interesting half can be tested without spawning
 * git. What matters about `git push` is the argv it is handed and what the
 * plugin concludes from the exit code; the spawn between them has no branches.
 *
 * Two rules hold throughout, because both failures are silent:
 *
 *   - Every pathspec goes after `--`, and is checked for a leading dash on top
 *     of that. A file may legitimately be named `-f`, and passed positionally
 *     it becomes an option instead of a path.
 *   - Nothing here builds a destructive command. There is no `--force`, no
 *     `reset --hard`, no `clean`. The one action that does lose work — rolling
 *     one file back — lives in `discard-ops.ts` instead, behind the
 *     confirmation design this rule demanded: git's own reading of the file
 *     rather than the client's claim, `git restore` scoped to a single
 *     pathspec as the whole vocabulary, and a dialog that names the
 *     consequence. It is deliberately not a button adjacent to Push.
 *
 * @module
 */

/** How `pull` should integrate the upstream's commits. */
export type PullMode = 'ff-only' | 'rebase' | 'merge'

/**
 * Environment that makes git FAIL on a credential prompt instead of waiting for
 * one.
 *
 * The subprocess capability is spawned with `stdin: 'ignore'`, which does not
 * make an interactive prompt an error — it makes it a prompt nobody can answer,
 * and git waits. That wait is inside the host process, so a single push to a
 * repository whose token expired would hang the plugin for every session until
 * the 30s grace elapsed. Each variable below closes one prompt route: git's own
 * terminal prompt, Git Credential Manager's GUI, and the two askpass helpers.
 */
export const NON_INTERACTIVE_ENV: Readonly<Record<string, string>> = {
  GIT_TERMINAL_PROMPT: '0',
  GCM_INTERACTIVE: 'never',
  GIT_ASKPASS: '',
  SSH_ASKPASS: '',
}

/** Network operations wait on a remote, not on the disk. */
export const NETWORK_GRACE_MS = 120_000

/**
 * Whether a string is safe to hand git as a pathspec.
 * @param path - repository-relative path from the client.
 * @returns false for an empty string or anything git would read as an option.
 */
export function isSafePathArg(path: string): boolean {
  return typeof path === 'string' && path.length > 0 && !path.startsWith('-')
}

function checkedPaths(paths: readonly string[]): string[] {
  if (paths.length === 0) throw new Error('no paths given')
  for (const path of paths) {
    if (!isSafePathArg(path)) throw new Error(`unsafe path argument: ${JSON.stringify(path)}`)
  }
  return [...paths]
}

/**
 * @param paths - repository-relative paths to stage.
 * @returns argv for `git`, paths separated by `--`.
 */
export function stageArgv(paths: readonly string[]): string[] {
  return ['add', '--', ...checkedPaths(paths)]
}

/**
 * @param paths - repository-relative paths to remove from the index.
 * @returns argv for `git`. `restore --staged` leaves the working tree alone;
 *          `reset` would too, but `restore` cannot be confused with the
 *          destructive spellings of the same verb.
 */
export function unstageArgv(paths: readonly string[]): string[] {
  return ['restore', '--staged', '--', ...checkedPaths(paths)]
}

/**
 * @param message - the commit message, used verbatim.
 * @param amend - replace the previous commit instead of adding one.
 * @returns argv for `git`. Never `-a`: the drawer has a staging area, and
 *          sweeping the whole worktree in would make that split a lie.
 */
export function commitArgv(message: string, amend: boolean): string[] {
  if (typeof message !== 'string' || message.trim().length === 0) {
    throw new Error('a commit message is required')
  }
  // One argv element. No shell runs here, so quoting is not the hazard —
  // splitting on whitespace would be, and a multi-line body is normal.
  return amend ? ['commit', '--amend', '-m', message] : ['commit', '-m', message]
}

/**
 * @returns argv for `git`. `--prune` so a branch deleted on the remote stops
 *          being counted as something to pull.
 */
export function fetchArgv(): string[] {
  return ['fetch', '--prune']
}

/**
 * @param mode - how to integrate the upstream's commits.
 * @returns argv for `git`. The mode is always explicit, never the user's
 *          `pull.rebase` config: the button says what it will do.
 */
export function pullArgv(mode: PullMode): string[] {
  if (mode === 'rebase') return ['pull', '--rebase']
  if (mode === 'merge') return ['pull', '--no-rebase']
  return ['pull', '--ff-only']
}

/**
 * @param branch - the current branch, needed only on its first push.
 * @param hasUpstream - whether the branch already tracks a remote branch.
 * @returns argv for `git`. With an upstream, bare `push` respects the user's
 *          own remote and refspec configuration; without one, the first push
 *          establishes `origin/<branch>`.
 */
export function pushArgv(branch: string, hasUpstream: boolean): string[] {
  if (hasUpstream) return ['push']
  if (!isSafePathArg(branch)) throw new Error(`unsafe branch name: ${JSON.stringify(branch)}`)
  return ['push', '--set-upstream', 'origin', branch]
}

/** What `git status --branch --porcelain=v1` says about where this branch sits. */
export interface Tracking {
  readonly branch: string
  /** `origin/main`, or null when the branch tracks nothing (or HEAD is detached). */
  readonly upstream: string | null
  readonly ahead: number
  readonly behind: number
  readonly detached: boolean
}

const NO_TRACKING: Tracking = { branch: '', upstream: null, ahead: 0, behind: 0, detached: false }

/**
 * Read the `##` header of porcelain status output.
 *
 * The distinction that matters is "no upstream" versus "an upstream we are level
 * with": the first means push must pass `--set-upstream`, and both otherwise
 * look like zero ahead and zero behind.
 * @param stdout - full `git status --porcelain=v1 --branch` output.
 */
export function parseTracking(stdout: string): Tracking {
  const header = stdout.split('\n').find(line => line.startsWith('## '))
  if (header === undefined) return NO_TRACKING

  const body = header.slice(3)
  if (body.startsWith('HEAD (no branch)')) return { ...NO_TRACKING, detached: true }

  // An unborn branch (fresh `git init`) reports "No commits yet on main" —
  // with the same optional upstream and bracket suffixes as a born header.
  // The sync bar wants the branch's NAME, not the English sentence around it.
  const UNBORN_PREFIX = 'No commits yet on '
  const born = body.startsWith(UNBORN_PREFIX) ? body.slice(UNBORN_PREFIX.length) : body

  // Divergence rides in a trailing bracket; strip it before splitting the refs.
  const bracket = born.indexOf(' [')
  const refs = bracket === -1 ? born : born.slice(0, bracket)
  const counts = bracket === -1 ? '' : born.slice(bracket)

  // `...` is the separator. Split on the LAST occurrence, not the first: a
  // branch may contain dots, and only the separator is three of them.
  const at = refs.lastIndexOf('...')
  const branch = at === -1 ? refs : refs.slice(0, at)
  const upstream = at === -1 ? null : refs.slice(at + 3)

  const ahead = /ahead (\d+)/.exec(counts)
  const behind = /behind (\d+)/.exec(counts)
  return {
    branch,
    upstream: upstream !== null && upstream.length > 0 ? upstream : null,
    ahead: ahead ? Number.parseInt(ahead[1]!, 10) : 0,
    behind: behind ? Number.parseInt(behind[1]!, 10) : 0,
    detached: false,
  }
}

/** Which side of the index a file's changes are on. */
export interface StageState {
  readonly staged: boolean
  readonly unstaged: boolean
}

/** Porcelain XY pairs that mean "unmerged", per git-status(1). */
const CONFLICT_XY = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'])

/**
 * Split a porcelain status pair into index and worktree state.
 *
 * A conflicted file reports content in the index (`UU`), so reading the X
 * column alone calls it staged — and the drawer would then offer to commit a
 * file with conflict markers still in it. Conflicts are reported as unstaged
 * work, which is what they are until somebody resolves them.
 * @param xy - the two status columns, e.g. ` M`, `MM`, `??`.
 */
export function stageStateOf(xy: string): StageState {
  if (xy === '??' || xy === '!!') return { staged: false, unstaged: true }
  if (CONFLICT_XY.has(xy)) return { staged: false, unstaged: true }
  const index = xy[0] ?? ' '
  const worktree = xy[1] ?? ' '
  return { staged: index !== ' ', unstaged: worktree !== ' ' }
}

/**
 * Why an operation failed, in terms the drawer can explain to a person.
 *
 * The last two are caller-derived, which is why {@link classifyFailure} never
 * returns them: `stale` is a sha mismatch the caller compared before running
 * git at all, and `invalid` an argument combination the caller refused before
 * anything spawned. They ride the same union so a `GitOpResult` needs no
 * parallel classification for the operations that produce them.
 */
export type OpFailure =
  | 'auth'
  | 'network'
  | 'no-upstream'
  | 'diverged'
  | 'conflict'
  | 'nothing-to-commit'
  | 'dirty'
  | 'stale'
  | 'invalid'
  | 'unknown'

/**
 * Turn git's exit into a reason the UI can act on.
 *
 * Matching on message text is fragile in general, but the alternative is
 * showing raw stderr and letting the user work out that "Updates were rejected"
 * means "fetch first". Anything unrecognised becomes `unknown`, and the caller
 * still carries the real stderr alongside — the classification adds a hint, it
 * never replaces the evidence.
 * @param exitCode - git's exit status.
 * @param stderr - captured stderr.
 * @param stdout - captured stdout; `nothing to commit` arrives here, not stderr.
 * @returns null when the command succeeded.
 */
export function classifyFailure(exitCode: number, stderr: string, stdout: string): OpFailure | null {
  if (exitCode === 0) return null
  const text = `${stderr}\n${stdout}`.toLowerCase()

  if (text.includes('nothing to commit')
    || text.includes('no changes added to commit')
    || text.includes('nothing added to commit')) return 'nothing-to-commit'

  if (text.includes('authentication failed')
    || text.includes('could not read username')
    || text.includes('could not read password')
    || text.includes('permission denied (publickey)')
    || text.includes('terminal prompts disabled')) return 'auth'

  // A network failure is worth its own class: "offline" and "bad remote URL"
  // are fixable in different places, and neither is git's fault (TESTS.md D5).
  if (text.includes('could not resolve host')
    || text.includes('network is unreachable')
    || text.includes('failed to connect')
    || text.includes('connection timed out')) return 'network'

  if (text.includes('no upstream configured')
    || text.includes('has no upstream branch')) return 'no-upstream'

  if (text.includes('conflict (')
    || text.includes('merge conflict')
    || text.includes('fix conflicts')) return 'conflict'

  if (text.includes('[rejected]')
    || text.includes('updates were rejected')
    || text.includes('not possible to fast-forward')
    || text.includes('need to specify how to reconcile divergent branches')) return 'diverged'

  if (text.includes('would be overwritten')
    || text.includes('local changes')) return 'dirty'

  return 'unknown'
}

// ---- Porcelain readers for the READ side (stats / commits / compare) ----
//
// These parsers lived in index.ts until the fixture catalog demanded unit
// coverage. index.ts imports its dsh peers as VALUES (it extends
// TypertRemoteService), so vitest cannot load that module without a web
// profile — pure parsing belongs here, the same split this file already
// makes for the write side.

/** The five change kinds the drawer distinguishes. */
export type GitFileStatus = 'added' | 'deleted' | 'modified' | 'renamed' | 'untracked'

/** One file of a change set, as `stats` / `commitStats` / `compareRefs` report it. */
export interface GitFile {
  readonly path: string
  readonly status: GitFileStatus
  readonly addedLines: number
  readonly deletedLines: number
  readonly binary: boolean
  /** Present only for renames/copies: the path this file moved from. Omitted otherwise. */
  readonly previousPath?: string
  /**
   * Whether the file has content in the index, and whether it has content in
   * the working tree that the index does not have. Both can be true at once —
   * a file staged and then edited again. Only meaningful for the working-tree
   * view; a commit's or a range's files are neither.
   *
   * A conflicted file reports `unstaged` even though its index entry is
   * populated, so the drawer cannot offer to commit unresolved markers.
   */
  readonly staged?: boolean
  readonly unstaged?: boolean
}

/** The mutable half of {@link GitFile}: untracked entries get their counts
 * and binary flag filled in by the synthesis pass in `stats`. */
export interface MutableGitFile {
  path: string
  status: GitFileStatus
  addedLines: number
  deletedLines: number
  binary: boolean
  previousPath?: string
  staged?: boolean
  unstaged?: boolean
}

interface NumstatEntry { added: number; deleted: number; binary: boolean }

/**
 * Read `git diff --numstat` output into a path-keyed map.
 *
 * A `-` in either count column means git could not (or would not — a `-diff`
 * gitattributes marker does it too) count the file: binary. Rename entries
 * print `old => new` in the path column; the NEW path is what the porcelain
 * status list also keys on, so that is the key kept here.
 * @param stdout - full `--numstat` output.
 */
export function parseNumstat(stdout: string): Map<string, NumstatEntry> {
  const out = new Map<string, NumstatEntry>()
  for (const line of stdout.split('\n')) {
    if (line.length === 0) continue
    const parts = line.split('\t')
    if (parts.length < 3) continue
    const binary = parts[0] === '-' || parts[1] === '-'
    const added = parts[0] === '-' ? 0 : Number.parseInt(parts[0]!, 10)
    const deleted = parts[1] === '-' ? 0 : Number.parseInt(parts[1]!, 10)
    const path = stripRenameTarget(parts.slice(2).join('\t'))
    if (path.length > 0) out.set(path, { added: Number.isFinite(added) ? added : 0, deleted: Number.isFinite(deleted) ? deleted : 0, binary })
  }
  return out
}

/** One porcelain line, split into the parts a caller can act on. */
export interface StatusLine {
  /** The two status columns, e.g. ` M`, `??`, `R `. */
  readonly xy: string
  /** The path git reports the file under NOW — the rename target, if renamed. */
  readonly path: string
  /** For a rename, the path HEAD still knows the file by; '' otherwise. */
  readonly previousPath: string
  readonly renamed: boolean
}

/**
 * Split one `git status --porcelain=v1` line.
 *
 * Exported because more than the file list needs it: `discard-ops` plans from
 * the RAW XY pair, which {@link parseStatus} folds away into a
 * {@link GitFileStatus}. Sharing this keeps the quoting and `old -> new`
 * handling in one place — a second implementation of it is how a path with a
 * non-ASCII name ends up being acted on unescaped.
 * @param line - one output line, branch header and blanks included.
 * @returns the split, or null for a line that names no file.
 */
export function parseStatusLine(line: string): StatusLine | null {
  if (line.length === 0 || line.startsWith('##')) return null
  if (line.length < 3) return null
  const { path, previousPath, renamed } = parsePath(line.slice(3))
  if (path.length === 0) return null
  return { xy: line.slice(0, 2), path, previousPath, renamed }
}

/** Parse porcelain lines into a MUTABLE file list — untracked entries get their
 * counts filled in by the synthesis pass afterwards. */
export function parseStatus(stdout: string, numstat: Map<string, NumstatEntry>): MutableGitFile[] {
  const files: MutableGitFile[] = []
  for (const line of stdout.split('\n')) {
    const parsed = parseStatusLine(line)
    if (parsed === null) continue
    const { xy, path, previousPath, renamed } = parsed
    const counts = numstat.get(path) ?? { added: 0, deleted: 0, binary: false }
    const { staged, unstaged } = stageStateOf(xy)
    const base: MutableGitFile = {
      path, status: statusFromXY(xy, renamed),
      addedLines: counts.added, deletedLines: counts.deleted, binary: counts.binary,
      staged, unstaged,
    }
    files.push(renamed && previousPath.length > 0 ? { ...base, previousPath } : base)
  }
  return files
}

/**
 * Parse `git show --name-status --no-renames` into the mutable file list, taking
 * line counts from the matching `--numstat` entry.
 * @param stdout - name-status output (`<status>\t<path>` per line).
 * @param numstat - per-path counts from {@link parseNumstat}.
 * @returns one entry per file the commit touched.
 */
export function parseNameStatus(stdout: string, numstat: Map<string, NumstatEntry>): MutableGitFile[] {
  const files: MutableGitFile[] = []
  for (const line of stdout.split('\n')) {
    if (line.length === 0) continue
    const tab = line.indexOf('\t')
    if (tab < 0) continue
    const code = line.slice(0, tab)
    const path = line.slice(tab + 1).trim()
    if (path.length === 0) continue
    const counts = numstat.get(path) ?? { added: 0, deleted: 0, binary: false }
    files.push({
      path,
      status: code.startsWith('A') ? 'added' : code.startsWith('D') ? 'deleted' : 'modified',
      addedLines: counts.added,
      deletedLines: counts.deleted,
      binary: counts.binary,
    })
  }
  return files
}

/**
 * Split a porcelain path field into the file's path and, for a rename, the
 * path it moved from.
 *
 * With `core.quotepath=false` (this plugin sets it on every git call) CJK and
 * accented paths arrive as raw UTF-8, unquoted. Git still quotes a path that
 * contains control characters or a quote, using C escapes — which is exactly
 * JSON's escape alphabet, so `JSON.parse` un-escapes it. Octal escapes from
 * the default quotepath mode are NOT JSON and stay raw; that is why the
 * config, not smarter unescaping, is the fix.
 * @param rest - the porcelain line past the two status columns.
 */
function parsePath(rest: string): { path: string; previousPath: string; renamed: boolean } {
  let value = rest
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    value = value.slice(1, -1)
    try { value = JSON.parse(`"${value}"`) } catch { /* keep raw */ }
  }
  const arrow = value.indexOf(' -> ')
  if (arrow >= 0) return { path: value.slice(arrow + 4), previousPath: value.slice(0, arrow), renamed: true }
  return { path: value, previousPath: '', renamed: false }
}

function stripRenameTarget(path: string): string {
  const arrow = path.indexOf(' -> ')
  return arrow >= 0 ? path.slice(arrow + 4) : path
}

function statusFromXY(xy: string, renamed: boolean): GitFileStatus {
  if (xy === '??') return 'untracked'
  if (renamed || xy[0] === 'R' || xy[1] === 'R' || xy[0] === 'C' || xy[1] === 'C') return 'renamed'
  if (xy[0] === 'A' || xy[1] === 'A') return 'added'
  if (xy[0] === 'D' || xy[1] === 'D') return 'deleted'
  return 'modified'
}

/** ASCII line feed. Safe to count in raw UTF-8 bytes: no multi-byte sequence
 * can contain it, so a byte scan and a decoded scan agree exactly. */
const NEWLINE = 0x0a

/**
 * Count lines in a UTF-8 buffer without decoding it.
 * @param bytes - file contents.
 * @returns the line count, counting a final unterminated line.
 */
export function countBufferLines(bytes: Buffer): number {
  if (bytes.length === 0) return 0
  let lines = 0
  for (let at = bytes.indexOf(NEWLINE); at !== -1; at = bytes.indexOf(NEWLINE, at + 1)) lines += 1
  return bytes[bytes.length - 1] === NEWLINE ? lines : lines + 1
}

/**
 * Whether a raw file buffer smells binary: a NUL byte inside the sniff window.
 *
 * UTF-16 text is the trap this exists for — it is text, but every other byte
 * is NUL, so an 8 KB prefix catches it without reading a 200 MB blob. A NUL
 * PAST the window does not decide anything: a text file may legitimately
 * contain one deep in its body (TESTS.md A9).
 * @param bytes - the file's contents, however much of them is cheap to read.
 * @param windowBytes - how many leading bytes may decide.
 */
export function isBinaryPrefix(bytes: Buffer, windowBytes: number): boolean {
  return bytes.subarray(0, windowBytes).includes(0)
}

/**
 * Clip a diff to a character cap, and SAY so when the clip happened — a
 * silently shortened diff reads as a complete one (TESTS.md H1).
 * @param text - the diff.
 * @param cap - most characters to keep.
 * @param marker - the truncation note appended when clipping.
 */
export function clipDiff(text: string, cap: number, marker: string): string {
  return text.length > cap ? `${text.slice(0, cap)}\n${marker}` : text
}

/**
 * Cap the branch list the picker shows, and REPORT the cut: `branchesTruncated`
 * is what lets the picker say "showing the first 500" instead of quietly
 * looking like the repository only has 500 branches (TESTS.md F5).
 * @param names - branch names, newest-commit-first.
 * @param cap - how many to send.
 */
export function capBranches(names: readonly string[], cap: number): { branches: string[]; branchesTruncated: boolean } {
  return { branches: names.slice(0, cap), branchesTruncated: names.length > cap }
}

/**
 * Whether stderr is the "no merge base" refusal `git diff A...B` gives for
 * histories with no common ancestor — the cue to retry the comparison as a
 * plain two-tip diff instead of failing outright (TESTS.md C3).
 * @param stderr - stderr of the failed three-dot diff.
 */
export function isNoMergeBaseError(stderr: string): boolean {
  return stderr.includes('no merge base')
}
