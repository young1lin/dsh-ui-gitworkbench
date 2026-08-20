/**
 * Host half of @young1lin/dsh-ui-gitworkbench.
 *
 * A TypertRemoteService exposed at endpoints `gitWorkbench/stats` and
 * `gitWorkbench/fileDiff`. The Typert gateway discovers methods by source-marker
 * reflection (the @Remote decorator) — no generated descriptor, no monorepo
 * edit. The browser reaches them through the generic connection RPC channel.
 *
 * `stats` computes the working-tree change picture (vs HEAD) by spawning git
 * through the subprocess capability with PIPED stdio. Pipe capture is used
 * deliberately instead of `ctx.shell`: the shell executor can run commands
 * through a PTY whose scrollback drops the head of large outputs, which loses
 * the first files of a big `git diff`. Pipes deliver every byte.
 *
 * Untracked files are enumerated per-file (`--untracked-files=all`) and their
 * diff segments are synthesized host-side from a direct file read —
 * `git diff --no-index /dev/null <f>` is NOT used because on Windows git
 * resolves `/dev/null` as a repo-relative path ("Could not access ...nul").
 * Synthesis is also cheaper: one fs read per file, no spawn.
 *
 * `fileDiff` returns one file's diff on demand (tracked: `git diff HEAD --`;
 * untracked: synthesized), so the payload cap on `stats` never hides content.
 *
 * `commitStats` and the commit branch of `fileDiff` read immutable objects, so
 * both answer from a bounded per-process cache and both spawn their git reads
 * concurrently — a git spawn costs about 100ms on Windows and dominates the
 * work. `stats` reads the working tree and is never cached.
 *
 * Worktree emulation rides on the same service: `worktreeEnter` creates (or
 * reuses) `<repoRoot>/.agents/worktrees/<name>` as a real git worktree on
 * branch `wt/<name>` and binds the session to it in
 * `~/.dsh/gitworkbench-worktree-bindings.json`; `worktreeExit` unbinds (optionally
 * removing a clean worktree); `sessionWorktree`/`worktreeStatus` report the
 * binding. The session cwd itself is immutable in dsh, so the enter result
 * carries a hint telling the model how to address the worktree relatively.
 *
 * The same three operations are also registered as agent tools
 * (`worktree_enter`/`worktree_exit`/`worktree_status`) via `ctx.tools`, so the
 * model can drive them directly; each tool takes its sessionId/cwd from the
 * calling agent's session rather than model-supplied arguments.
 *
 * @module @young1lin/dsh-ui-gitworkbench
 */
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { runApplyBlocks, sha1Hex, type ApplyBlocksIo } from './apply-blocks.js'
import { saveJsonAtomic } from './atomic-json.js'
import { runWriteChecked, type WriteCheckedIo, type WriteResult } from './write-checked.js'
import { CommitPayloadCache, cacheKey } from './commit-cache.js'
import {
  NETWORK_GRACE_MS, NON_INTERACTIVE_ENV, capBranches, classifyFailure, clipDiff,
  commitArgv, countBufferLines, decodesAsUtf8, fetchArgv, isBinaryPrefix, isNoMergeBaseError,
  isSafePathArg, parseNameStatus, parseNumstat, parseStatus, parseTracking,
  pullArgv, pushArgv, stageArgv, stageStateOf, unstageArgv,
  type GitFile, type GitFileStatus, type MutableGitFile,
  type OpFailure, type PullMode, type Tracking,
} from './git-ops.js'
import {
  planFromStatus,
  type DiscardEffect, type DiscardPlan,
} from './discard-ops.js'
import { parseBlame, type BlameLine } from './blame.js'
import { removePathInside } from './fs-remove.js'
import { diffTooLarge, targetTooLarge, SIDE_BYTE_CAP, SIDE_LINE_CAP } from './side-guard.js'
import { IMAGE_BYTE_CAP, sniffImage } from './image-sniff.js'
import { LOG_FORMAT, parseLog, type GitCommit } from './git-log.js'
import { emptyLogFilter, logFilterArgs, type LogFilter } from './log-filter.js'
import { parseShortlog, type AuthorEntry } from './shortlog.js'
import {
  isBlankEntry, loadStyle, sanitizeEntry, stylePath,
  type StyleEntry, type StyleFile,
} from './style-store.js'
import {
  bindingsPath, findRegisteredWorktree, isRefName, loadBindings, parseWorktreeList, sanitizeName, saveBindings, worktreeDir,
  type BindingsFile, type WorktreeBinding, type WorktreeEntry, type WorktreeOpResult,
} from './worktree.js'

export type { WorktreeBinding, WorktreeOpResult }
export type { GitFile, GitFileStatus }
export type { DiscardEffect }
export type { StyleEntry }
export type { WriteResult }

/** Cap the bundled unified diff so a huge change cannot blow the RPC response. */
const DIFF_CHAR_CAP = 400_000
/** Untracked files larger than this are listed + counted but never diffed. */
const UNTRACKED_FILE_BYTE_CAP = 1_000_000

/** Files with a NUL byte in the first 8k are treated as binary. */
const BINARY_SNIFF_BYTES = 8_000
/** Context radius that makes `git diff` emit ONE hunk covering the whole file —
 *  the artifact the side-by-side view aligns its two columns on. */
const FULL_CONTEXT = 1_000_000
/** Untracked files measured at once. Enough to keep the disk busy, few enough
 *  that a repository with thousands of them cannot exhaust the file table. */
const UNTRACKED_READ_CONCURRENCY = 16
/** How many recent commits ride along in `stats` — the history tab's first page. */
const HISTORY_COMMITS = 20
/** How many further commits one `commits` page loads. */
const HISTORY_PAGE = 30
/** Upper bound on a caller-supplied page size. */
const HISTORY_PAGE_MAX = 200
/** Author roster cap: the busiest 500 — enough for any real project's people,
 *  and a list a popup can scroll without choking. */
const SHORTLOG_CAP = 500
/** Path list cap for the picker: a monorepo can outrun any popup; past this
 *  the tree is cut and the truncation reported, never silent. */
const TREE_PATH_CAP = 50_000
/**
 * Most branch names sent to the browser. `worktreeStatus` is polled, so an
 * unbounded list would repeat on the wire every few seconds; the picker reports
 * the cut rather than quietly showing a short list.
 */
const BRANCH_LIST_CAP = 500
/** Commit change sets held per host process before the least recently used is dropped. */
const COMMIT_CACHE_CAPACITY = 32
/** Per-file commit diffs held per host process — far more numerous, and far smaller, than a whole change set. */
const COMMIT_DIFF_CACHE_CAPACITY = 128
/** Abbreviated or full object name — rejects anything that could read as a git option. */
const COMMIT_HASH = /^[0-9a-fA-F]{4,40}$/

export type { GitCommit } from './git-log.js'

export interface WorkbenchStats {
  readonly worktreePath: string
  readonly branch: string
  readonly ahead: number
  readonly behind: number
  readonly detached: boolean
  readonly addedLines: number
  readonly deletedLines: number
  readonly addedFiles: number
  readonly deletedFiles: number
  readonly modifiedFiles: number
  readonly files: readonly GitFile[]
  /** Combined diff text: `git diff HEAD` plus synthesized untracked segments, capped. */
  readonly diff: string
  /**
   * Commits this view is about: the single commit for `commitStats`, the range's
   * commits for `compareRefs`. Empty for `stats` — the working tree is not a
   * log, and the history list loads its own pages through `commits` so it can
   * follow a ref of its own.
   */
  readonly commits: readonly GitCommit[]
  readonly error?: string
}

interface GitResult {
  readonly stdout: string
  readonly exitCode: number
  /** Last 300 chars of stderr, or the spawn exception message — for error reporting. */
  readonly stderr: string
}

/**
 * `fileSides`: one layer of one file, as the side-by-side diff pane reads it.
 *
 * `diff` is the layer's full-context unified diff (index→worktree for
 * `unstaged`, HEAD→index for `staged`) — one hunk covering the whole file,
 * which is simultaneously the pane's row alignment and, through `patch-model`,
 * the patch the block actions emit. `diffSha` is sha1 of exactly the string in
 * `diff`; the block mutations echo it back to prove the file has not changed
 * since the pane rendered it.
 */
export interface FileSides {
  /** Unified diff at full context; '' when the layer has no change. */
  readonly diff: string
  /** sha1 of `diff`, echoed back by mutations to prove the same snapshot. */
  readonly diffSha: string
  /** Whole right-hand text, the editor's initial buffer. */
  readonly targetText: string
  /** Blob sha of the right-hand side; '' when it does not exist. */
  readonly targetSha: string
  readonly binary: boolean
  /** True when the file is past the size guard; the client shows the old view. */
  readonly tooLarge: boolean
  /** True when the working-tree file is NOT valid UTF-8 — GBK, Shift JIS,
   *  Latin-1. `targetText` is then a lossy decode of it, so the pane shows the
   *  diff but withholds the editor: saving that text back would replace every
   *  non-ASCII byte in the file. `writeChecked` refuses such a save anyway. */
  readonly lossyEncoding: boolean
}

/**
 * `fileImage`: one working-tree file's bytes, when the bytes really are an
 * image a browser can draw.
 *
 * Every field is present in both outcomes rather than optional, because the
 * gateway's payloads must be JSON-safe and an absent key and a `undefined` one
 * are not the same thing over the wire. `reason` is '' exactly when `ok`.
 */
export interface FileImage {
  /** Whether `base64` holds a verified image. */
  readonly ok: boolean
  /** MIME type to label the blob with; '' when declined. */
  readonly mime: string
  /** Short label for the caption — 'PNG', 'WebP', 'SVG'; '' when declined. */
  readonly kind: string
  /** The whole file, base64. '' when declined. */
  readonly base64: string
  /** The file's size in bytes, reported either way: when the view declines,
   *  the size is usually the reason and always worth showing. */
  readonly bytes: number
  /** Why not: 'notImage', 'tooLarge', 'missing'. '' when ok. */
  readonly reason: string
}

/** A `fileImage` answer that carries no picture, only why. */
function declined(reason: string, bytes: number): FileImage {
  return { ok: false, mime: '', kind: '', base64: '', bytes, reason }
}

/** What every write operation reports back. */
export interface GitOpResult {
  readonly ok: boolean
  /** Present only on failure; `unknown` still carries `error` for the user to read. */
  readonly failure?: OpFailure
  /** git's own message on failure, trimmed to the tail. */
  readonly error?: string
  /** git's own message on success — `push` in particular says where it went. */
  readonly output?: string
}

/**
 * Narrow whatever the client sent to a list of path strings.
 *
 * This crosses the RPC boundary, so it is untyped on arrival; a non-array or a
 * list with a number in it must become an empty list and be refused by the argv
 * builder, not reach git as `[object Object]`.
 */
function asPathList(paths: unknown): string[] {
  if (!Array.isArray(paths)) return []
  return paths.filter((path): path is string => typeof path === 'string')
}

/** Binding-file IO handle (injected dependencies, so tests can substitute readers/writers). */
interface BindingsFileIo {
  readonly path: string
  load(): Promise<BindingsFile>
  save(file: BindingsFile): Promise<void>
}

/** Style-file IO handle, on the same terms as {@link BindingsFileIo}. */
interface StyleFileIo {
  readonly path: string
  load(): Promise<StyleFile>
  save(file: StyleFile): Promise<void>
}

/** A TypertRemoteService registers itself under `ctx.gitWorkbench` and is found by the gateway. */
export class GitWorkbenchService extends TypertRemoteService {
  static inject = ['subprocess', 'tools']

  /** Whole commit change sets, keyed by worktree + hash. */
  private readonly commitStatsCache = new CommitPayloadCache<WorkbenchStats>(COMMIT_CACHE_CAPACITY)
  /** Single-file commit diffs, keyed by worktree + hash + path. */
  private readonly commitDiffCache = new CommitPayloadCache<string>(COMMIT_DIFF_CACHE_CAPACITY)

  /**
   * Bindings mirrored in memory, keyed by session id. The prompt-context
   * provider is synchronous and cannot read the bindings file, so every
   * mutation updates this inside the same critical section that writes it.
   */
  private readonly bindingMirror = new Map<string, WorktreeBinding>()

  constructor(ctx: Context) {
    super(ctx, 'gitWorkbench')
    this.registerWorktreeTools(ctx)
    this.registerWorktreePrompt(ctx)
    // Hydrate the mirror through the same queue as the mutations, so a binding
    // written before hydration finishes is not overwritten by the stale read.
    // A failed read leaves the mirror empty: sessions then get no standing
    // notice, while the tools keep working straight off the file.
    void this.withBindings(async (io) => {
      const file = await io.load()
      for (const [id, binding] of Object.entries(file.bindings)) this.bindingMirror.set(id, binding)
    }).catch(() => {})
  }

  /**
   * Contribute the session's worktree binding to every model request.
   *
   * The binding is a CONVENTION, not an enforced boundary: `session.header.cwd`
   * is immutable, so the filesystem and shell tools keep resolving against the
   * repository root whatever this session is bound to. A one-shot hint in the
   * `worktree_enter` result decays — compaction can prune it, and the `cwd`
   * prompt variable goes on naming the repo root every turn. A standing context
   * is what keeps the convention in front of the model.
   *
   * Registered as dynamic CONTEXT rather than a stable section: the value is
   * per-session and mutable, so it belongs in the per-request runtime snapshot
   * instead of the cached prompt prefix. Mounted through `ctx.inject` so an
   * assembly without a systemPrompt registry simply skips it.
   */
  private registerWorktreePrompt(ctx: Context): void {
    ctx.inject(['systemPrompt'], (scope: Context) => {
      scope.systemPrompt.context({
        name: 'worktree:binding',
        order: 115,
        text: (context) => {
          const sessionId = context.agent?.session.id
          const binding = sessionId === undefined ? undefined : this.bindingMirror.get(sessionId)
          if (binding === undefined) return ''
          const rel = `.agents/worktrees/${binding.name}`
          const branchNote = binding.branch === undefined ? '' : ` (branch ${binding.branch})`
          return `This session is bound to git worktree "${binding.name}"${branchNote}.\n`
            + 'The session working directory is still the repository root, so the binding is a convention you must apply yourself:\n'
            + `- shell commands: pass workdir "${rel}"\n`
            + `- file tools: prefix every path with ${rel}/\n`
            + 'A path without that prefix acts on the MAIN worktree, not the bound one. Call worktree_exit to unbind.'
        },
      })
    })
  }

  /**
   * Expose the worktree RPCs to the model as three agent tools. All of them
   * derive sessionId/cwd from the calling agent's session (`exec.agent.session`)
   * — the tools are session-scoped, so a call without a session is refused.
   *
   * Output schemas follow dsh-tools' enforced JSON-Schema subset: single type
   * strings only (a `['object', 'null']` array is rejected — hence the `oneOf`
   * for `binding`), and every object node declares `additionalProperties`
   * explicitly. The status schema keeps `ok`/`error` optional-but-declared so
   * its no-session early return still validates.
   */
  private registerWorktreeTools(ctx: Context): void {
    const output = (schema: Record<string, unknown>) => ({
      schema,
      render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }],
    })
    const OP_SCHEMA = {
      type: 'object', additionalProperties: false,
      properties: {
        ok: { type: 'boolean', required: true },
        worktreePath: { type: 'string' },
        branch: { type: 'string' },
        hint: { type: 'string' },
        error: { type: 'string' },
      },
    } as const
    const STATUS_SCHEMA = {
      type: 'object', additionalProperties: false,
      properties: {
        ok: { type: 'boolean' },
        error: { type: 'string' },
        binding: { oneOf: [{ type: 'null' }, { type: 'object', additionalProperties: true }] },
        worktrees: { type: 'array', items: { type: 'object', additionalProperties: true } },
        branches: { type: 'array', items: { type: 'string' } },
        branchesTruncated: { type: 'boolean' },
      },
    } as const

    ctx.tools.register(defineTool({
      name: 'worktree_enter',
      description: 'Enter (create or reuse) an isolated git worktree at .agents/worktrees/<name> — the directory is '
        + 'always derived from the name (there is no dir parameter), the branch is the name VERBATIM, '
        + 'and the session is bound to it. After entering, address the worktree relatively from the session cwd: '
        + 'for shell commands pass workdir ".agents/worktrees/<name>" (per-call workdir is supported and resolved '
        + 'against the session cwd); for file tools use paths prefixed with .agents/worktrees/<name>/. '
        + 'Call with no name to auto-generate one. Use worktree_exit to leave.',
      parameters: {
        name: { type: 'string', description: 'Optional worktree name: letters, digits, . _ - + (must start alphanumeric, max 64 chars; ".." and a trailing dot are refused). The name is used VERBATIM as the branch — no prefix is added. If the target directory already holds a registered worktree (e.g. one made by another tool), it is reused as-is with its own branch. Auto-generated when omitted or illegal.' },
      },
      output: output(OP_SCHEMA),
      execute: async (args: { name?: string }, exec: ToolRunContext) => {
        const session = exec.agent?.session
        if (session === undefined) return { ok: false, error: 'worktree tools require a calling session' }
        return this.worktreeEnter(session.id, session.header.cwd ?? '', args?.name, exec.signal)
      },
      presentCall: () => ({ card: 'generic', title: 'Enter worktree', kind: 'other' }),
    }))

    ctx.tools.register(defineTool({
      name: 'worktree_exit',
      description: 'Leave the session\'s bound worktree. Keeps the worktree directory on disk by default; '
        + 'pass remove: true to also delete it (refused while it has uncommitted changes).',
      parameters: {
        remove: { type: 'boolean', description: 'Also run git worktree remove (default false).' },
      },
      output: output(OP_SCHEMA),
      execute: async (args: { remove?: boolean }, exec: ToolRunContext) => {
        const session = exec.agent?.session
        if (session === undefined) return { ok: false, error: 'worktree tools require a calling session' }
        return this.worktreeExit(session.id, args?.remove, exec.signal)
      },
      presentCall: () => ({ card: 'generic', title: 'Exit worktree', kind: 'other' }),
    }))

    ctx.tools.register(defineTool({
      name: 'worktree_status',
      description: 'Show this session\'s bound worktree (if any) and the repository\'s existing worktrees with branches.',
      parameters: {},
      output: output(STATUS_SCHEMA),
      execute: async (_args: Record<string, never>, exec: ToolRunContext) => {
        const session = exec.agent?.session
        if (session === undefined) return { ok: false, error: 'worktree tools require a calling session' }
        return this.worktreeStatus(session.id, session.header.cwd ?? '', exec.signal)
      },
      presentCall: () => ({ card: 'generic', title: 'Worktree status', kind: 'read' }),
    }))
  }

  /** Working-tree change stats for a worktree (plain-identifier params; signal last — SRC requirements). */
  @Remote('stats')
  async stats(worktreePath: string | undefined, signal: AbortSignal): Promise<WorkbenchStats> {
    const cwd = typeof worktreePath === 'string' && worktreePath.length > 0 ? worktreePath : process.cwd()

    // Three independent reads of the same worktree. Running them together is
    // safe: git takes .git/index.lock only to write back a refreshed index and
    // skips that write when it cannot get the lock, so the reports stay correct.
    //
    // `git diff HEAD` is NOT among them any more. This call is polled — every
    // 3 seconds while an agent is running — and the full patch is the most
    // expensive thing in it by a wide margin: measured on a worktree with
    // 90,000 changed lines it took 595ms and produced 7.43MB, of which the
    // 400,000-character clip below then discarded 94.6% before it ever reached
    // the browser. The tree and the counters need only `status` and
    // `--numstat`, both of which stay around 110-140ms at that size, and the
    // pane already fetches the file it is actually showing through `fileDiff`.
    const [statusInfo, numstat, revInfo] = await Promise.all([
      this.git(cwd, ['status', '--porcelain=v1', '--branch', '--untracked-files=all'], signal),
      this.git(cwd, ['diff', 'HEAD', '--numstat'], signal),
      this.git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'], signal),
    ])
    if (statusInfo.exitCode !== 0) {
      const detail = statusInfo.stderr.length > 0 ? `: ${statusInfo.stderr}` : ''
      return { ...emptyStats(cwd), error: `git status failed (exit ${statusInfo.exitCode})${detail}` }
    }

    const counts = parseNumstat(numstat.stdout)
    const files = parseStatus(statusInfo.stdout, counts)

    // Every untracked file needs a line count and a binary flag for the tree,
    // and both come off the raw buffer with no utf8 decode. The second pass
    // that used to follow — decoding some of them and synthesizing new-file
    // segments into the payload — is gone with the payload itself; `fileDiff`
    // synthesizes the one segment the reader has actually opened.
    const untracked = files.filter(file => file.status === 'untracked')
    const measured = await mapPooled(untracked, UNTRACKED_READ_CONCURRENCY, file => measureUntracked(cwd, file.path))

    for (const [index, file] of untracked.entries()) {
      const measure = measured[index]
      file.addedLines = measure.lineCount
      file.binary = measure.binary
    }

    let addedLines = 0
    let deletedLines = 0
    let addedFiles = 0
    let deletedFiles = 0
    let modifiedFiles = 0
    for (const file of files) {
      addedLines += file.addedLines
      deletedLines += file.deletedLines
      if (file.status === 'added' || file.status === 'untracked') addedFiles += 1
      else if (file.status === 'deleted') deletedFiles += 1
      else modifiedFiles += 1
    }

    let branch = revInfo.stdout.trim()
    let detached = false
    if (branch === 'HEAD' || branch.length === 0) {
      // rev-parse names nothing before the first commit, but symbolic-ref
      // still resolves an unborn branch: a fresh `git init` shows its branch
      // name in the chip rather than a detached hash or a blank (TESTS.md I1).
      const sym = (await this.git(cwd, ['symbolic-ref', '--short', 'HEAD'], signal)).stdout.trim()
      if (sym.length > 0) {
        branch = sym
      } else {
        detached = true
        const short = (await this.git(cwd, ['rev-parse', '--short', 'HEAD'], signal)).stdout.trim()
        branch = short.length > 0 ? short : ''
      }
    }
    const { ahead, behind } = parseBranch(statusInfo.stdout)


    return {
      worktreePath: cwd, branch, ahead, behind, detached,
      addedLines, deletedLines, addedFiles, deletedFiles, modifiedFiles,
      // No bundled patch: every per-file diff is fetched on demand. See the
      // reads above for what that saves and why it is affordable.
      files, diff: '',
      // No log here: this call is polled every 15s, and the history list follows
      // a ref this one knows nothing about. `commits` serves it instead.
      commits: [],
    }
  }

  /**
   * One file's diff on demand, for whichever view is asking.
   *
   * Three questions, because the drawer's three tabs are asking three different
   * things about the same path and only the caller knows which:
   *
   *   - with `commit`, that commit's change to the file;
   *   - with `base` and `head`, what differs between two refs — the Compare
   *     tab, which until now had no way to ask at all and showed a file with no
   *     detail whenever the bundled payload did not carry it;
   *   - with neither, the working tree against HEAD.
   *
   * The range answer is deliberately NOT cached, for the same reason
   * `compareRefs` is not: a ref name is a moving pointer, unlike a commit hash.
   *
   * Plain-identifier params, signal last.
   */
  @Remote('fileDiff')
  async fileDiff(worktreePath: string, path: string, commit: string | undefined, base: string | undefined, head: string | undefined, signal: AbortSignal): Promise<{ readonly diff: string }> {
    const cwd = typeof worktreePath === 'string' && worktreePath.length > 0 ? worktreePath : process.cwd()
    if (typeof path !== 'string' || path.length === 0) return { diff: '' }
    if (typeof base === 'string' && base.length > 0 && typeof head === 'string' && head.length > 0) {
      if (!isRefName(base) || !isRefName(head)) return { diff: '' }
      const ranged = await this.git(cwd, ['diff', '--no-renames', `${base}...${head}`, '--', path], signal)
      if (ranged.exitCode === 0) return { diff: ranged.stdout }
      // Unrelated histories have no merge base for `A...B` to diff from; the
      // two-tip diff still answers what differs, exactly as `compareRefs` does.
      if (!isNoMergeBaseError(ranged.stderr)) return { diff: '' }
      const tips = await this.git(cwd, ['diff', '--no-renames', base, head, '--', path], signal)
      return { diff: tips.exitCode === 0 ? tips.stdout : '' }
    }
    if (typeof commit === 'string' && commit.length > 0) {
      if (!COMMIT_HASH.test(commit)) return { diff: '' }
      const key = cacheKey(cwd, commit, path)
      const cached = this.commitDiffCache.get(key)
      if (cached !== undefined) return { diff: cached }
      // `--first-parent` for the same reason as in `commitStats`: without it a
      // merge commit has no diff to show and the pane opens empty.
      const shown = await this.git(cwd, ['show', commit, '--first-parent', '--format=', '--no-renames', '--', path], signal)
      if (shown.exitCode !== 0) return { diff: '' }
      this.commitDiffCache.set(key, shown.stdout)
      return { diff: shown.stdout }
    }
    const tracked = await this.git(cwd, ['diff', 'HEAD', '--', path], signal)
    if (tracked.stdout.trim().length > 0) return { diff: tracked.stdout }
    return { diff: await untrackedSegment(cwd, path) ?? '' }
  }

  /**
   * One layer of one file for the side-by-side diff pane: the layer's
   * full-context diff, the right-hand text the editor starts from, and the
   * shas later mutations check against (plain-identifier params; signal last).
   *
   * The two layers answer different questions about the same file — `unstaged`
   * is index→worktree (the editable side), `staged` is HEAD→index (read-only:
   * editing the index would mean writing a blob with no file behind it) — so
   * the diff, the target text and the target sha each come from that layer's
   * own sources. Untracked files have no index entry, so `git diff` reports
   * nothing for them and the unstaged layer falls back to the synthesized
   * new-file segment `fileDiff` already uses.
   *
   * @param worktreePath - directory to run in; empty falls back to the host cwd.
   * @param path - repository-relative path, as the drawer lists it.
   * @param layer - `unstaged` (index→worktree) or `staged` (HEAD→index).
   * @param signal - abort signal.
   */
  @Remote('fileSides')
  async fileSides(worktreePath: string, path: string, layer: string, signal: AbortSignal): Promise<FileSides> {
    if (layer !== 'unstaged' && layer !== 'staged') {
      throw new Error(`unknown layer "${String(layer)}"; expected 'unstaged' or 'staged'`)
    }
    if (typeof path !== 'string' || !isSafePathArg(path)) {
      throw new Error(`unsafe path argument: ${JSON.stringify(path)}`)
    }
    const cwd = this.cwdOf(worktreePath)
    return layer === 'unstaged'
      ? await this.unstagedSides(cwd, path, signal)
      : await this.stagedSides(cwd, path, signal)
  }

  /** The unstaged layer: diff index→worktree, target = the working-tree file. */
  private async unstagedSides(cwd: string, path: string, signal: AbortSignal): Promise<FileSides> {
    // Size guard first, off the stat rather than a read: declining a file past
    // the cap must not mean loading a pathological one whole first. Bytes are
    // all a stat knows; the line half of the guard needs the read below.
    try {
      const info = await stat(join(cwd, path))
      if (info.isFile() && targetTooLarge(info.size, 0)) return { ...emptySides(), tooLarge: true }
    } catch {
      // Missing file: deleted in the working tree, which the diff below states.
    }
    let bytes: Buffer | null = null
    try {
      bytes = await readFile(join(cwd, path))
    } catch {
      bytes = null
    }
    if (bytes !== null && isBinaryPrefix(bytes, BINARY_SNIFF_BYTES)) {
      return { ...emptySides(), binary: true, targetSha: await this.worktreeBlobSha(cwd, path, signal) }
    }
    if (bytes !== null && targetTooLarge(bytes.length, countBufferLines(bytes))) {
      return { ...emptySides(), tooLarge: true }
    }
    const diff = await this.layerDiffText(cwd, path, 'unstaged', signal)
    if (binaryDiffOutput(diff)) {
      return { ...emptySides(), binary: true, targetSha: await this.worktreeBlobSha(cwd, path, signal) }
    }
    // The diff half of the guard, AFTER the artifact exists: the target-side
    // checks above cannot see a worktree-deleted large file (no target to
    // measure) or a huge left side behind a small target — but the patch text
    // carries both, and it is the payload being bounded.
    if (diffTooLarge(diff)) return { ...emptySides(), tooLarge: true }
    return {
      diff,
      diffSha: sha1Hex(diff),
      targetText: bytes === null ? '' : bytes.toString('utf8'),
      targetSha: bytes === null ? '' : await this.worktreeBlobSha(cwd, path, signal),
      binary: false,
      tooLarge: false,
      // Only the unstaged layer can report this, and only it needs to: the
      // editor edits the working tree, and the staged layer is read-only.
      lossyEncoding: bytes !== null && !decodesAsUtf8(bytes),
    }
  }

  /** The staged layer: diff HEAD→index, target = the index blob. */
  private async stagedSides(cwd: string, path: string, signal: AbortSignal): Promise<FileSides> {
    // `:path` resolves the stage-0 index entry: the target text when it exists,
    // and a failed resolution (no entry) is the empty target, not an error.
    const shown = await this.git(cwd, ['show', `:${path}`], signal)
    const sha = (await this.git(cwd, ['rev-parse', '--verify', '--quiet', `:${path}`], signal)).stdout.trim()
    const targetText = shown.exitCode === 0 ? shown.stdout : ''
    const targetBytes = Buffer.from(targetText, 'utf8')
    if (targetText.length > 0 && isBinaryPrefix(targetBytes, BINARY_SNIFF_BYTES)) {
      return { ...emptySides(), binary: true, targetSha: sha }
    }
    if (targetTooLarge(targetBytes.length, countBufferLines(targetBytes))) {
      return { ...emptySides(), tooLarge: true, targetSha: sha }
    }
    const diff = await this.layerDiffText(cwd, path, 'staged', signal)
    if (binaryDiffOutput(diff)) {
      return { ...emptySides(), binary: true, targetSha: sha }
    }
    // Same reasoning as the unstaged layer's post-diff check: a huge HEAD side
    // behind a small index target passes the target guard while the patch
    // still carries the whole old file.
    if (diffTooLarge(diff)) {
      return { ...emptySides(), tooLarge: true, targetSha: sha }
    }
    return {
      diff,
      diffSha: sha1Hex(diff),
      targetText,
      targetSha: sha,
      binary: false,
      tooLarge: false,
      lossyEncoding: false,
    }
  }

  /** Blob sha of the working-tree file, '' when git cannot hash it. */
  private async worktreeBlobSha(cwd: string, path: string, signal: AbortSignal): Promise<string> {
    const hashed = await this.git(cwd, ['hash-object', '--', path], signal)
    return hashed.exitCode === 0 ? hashed.stdout.trim() : ''
  }

  /**
   * The layer's full-context diff — the one artifact the side pane aligns its
   * rows on and `applyBlocks` re-checks its sha against.
   *
   * Both callers go through here by design: `fileSides` stamps the text it
   * returns with {@link sha1Hex} and `applyBlocks` re-derives the stamp over
   * its own fresh fetch, so the two ends of the stale comparison are over the
   * SAME text by construction, not by two fetch sites staying in step.
   */
  private async layerDiffText(cwd: string, path: string, layer: 'unstaged' | 'staged', signal: AbortSignal): Promise<string> {
    if (layer === 'staged') {
      return (await this.git(cwd, ['diff', '--cached', `-U${FULL_CONTEXT}`, '--', path], signal)).stdout
    }
    const diff = (await this.git(cwd, ['diff', `-U${FULL_CONTEXT}`, '--', path], signal)).stdout
    // Untracked files have no index entry, so `git diff` reports nothing for
    // them; the synthesized new-file segment is their unstaged diff. The
    // trailing newline is added here because every diff git prints carries
    // one: this text is what `applyBlocks` re-emits as a patch file, and a
    // patch whose last line has no LF is "corrupt patch" to `git apply` —
    // which is exactly what a real-git drive of the untracked path caught.
    if (diff.length === 0 && await this.isUntracked(cwd, path, signal)) {
      const segment = await untrackedSegment(cwd, path, SIDE_BYTE_CAP)
      return segment === null ? '' : `${segment}\n`
    }
    return diff
  }

  /**
   * Apply one change block of a side-by-side diff: stage it into the index,
   * unstage it back out, or roll it back out of the working tree
   * (plain-identifier params; signal last).
   *
   * The client sends a selection — `path`, `layer`, the `diffSha` of the diff
   * the pane rendered, and the block's hunk-line indices — never patch text.
   * The sequence itself (stale check, emission, `--check`, apply, tmpfile
   * cleanup) lives in `apply-blocks.ts`, where vitest can drive it against a
   * real git; this method only binds the host's git helper, the layer fetch
   * shared with `fileSides`, and the tmpfile pair. Every failure comes back as
   * a result — the method never throws across the RPC boundary.
   *
   * @param worktreePath - directory to run in; empty falls back to the host cwd.
   * @param path - repository-relative path, as the drawer lists it.
   * @param layer - the layer the block was selected on; the mode decides which
   *                one that may be.
   * @param diffSha - sha of the diff the pane rendered, re-derived and compared.
   * @param lines - hunk-line indices of the block, as `side-rows.blockLines`
   *                produced them client-side.
   * @param mode - `stage` | `unstage` | `discard`.
   * @param signal - abort signal.
   */
  @Remote('applyBlocks')
  async applyBlocks(worktreePath: string, path: string, layer: string, diffSha: string, lines: readonly number[], mode: string, signal: AbortSignal): Promise<GitOpResult> {
    const cwd = this.cwdOf(worktreePath)
    const io: ApplyBlocksIo = {
      git: (dir, argv) => this.git(dir, argv, signal),
      layerDiff: (file, which) => this.layerDiffText(cwd, file, which === 'staged' ? 'staged' : 'unstaged', signal),
      writePatch: writeTmpPatch,
      dropPatch: dropTmpPatch,
    }
    return runApplyBlocks(io, cwd, path, layer, String(diffSha ?? ''), lines, mode)
  }

  /**
   * Save the side-by-side editor's buffer over the working-tree file it was
   * opened from — the editable diff's one write (plain-identifier params;
   * signal last).
   *
   * The buffer travels with the blob sha the editor opened with, and the host
   * re-derives that sha from git at the moment of the write: a file that moved
   * underneath the editor — an agent's write, another session's save — makes
   * the save refuse with `failure: 'stale'` and NOTHING is written. The whole
   * sequence (path lock, sha refusal, atomic temp+rename write, the fresh sha
   * the next save checks against) lives in `write-checked.ts`, where vitest
   * drives it against a real git; this method binds the host's git helper and
   * the filesystem calls, plus the stat that keeps "file absent" from being
   * read off a hash spawn's failure. Never throws across the RPC boundary.
   *
   * This is deliberately NOT a `writeFile(path, content)` primitive: the sha
   * check and this method are one thing, and no unchecked write RPC exists or
   * may be added in this plugin.
   *
   * @param worktreePath - directory to run in; empty falls back to the host cwd.
   * @param path - repository-relative path, as the drawer lists it.
   * @param text - the editor buffer, verbatim; written as bytes (LF as given).
   * @param expectedSha - the `targetSha` the buffer was opened with ('' when
   *                     the file did not exist then), or the sha a successful
   *                     save last returned.
   * @param signal - abort signal.
   */
  @Remote('writeChecked')
  async writeChecked(worktreePath: string, path: string, text: string, expectedSha: string, signal: AbortSignal): Promise<WriteResult> {
    const cwd = this.cwdOf(worktreePath)
    const io: WriteCheckedIo = {
      git: (dir, argv) => this.git(dir, argv, signal),
      exists: async p => {
        try {
          await stat(p)
          return true
        } catch {
          return false
        }
      },
      readBytes: p => readFile(p),
      writeBytes: async (p, bytes) => { await writeFile(p, bytes) },
      rename: async (from, to) => { await rename(from, to) },
      remove: async p => { await rm(p, { force: true }) },
      delay: ms => new Promise(resolve => { setTimeout(resolve, ms) }),
    }
    return runWriteChecked(io, cwd, path, typeof text === 'string' ? text : '', typeof expectedSha === 'string' ? expectedSha : '')
  }

  /**
   * One file's provenance, line by line — the side pane's blame gutter
   * (plain-identifier params; signal last).
   *
   * Blames the WORKING TREE file, which is what the reader is looking at and
   * what IDEA annotates: lines the reader has not committed come back flagged
   * rather than missing. Read-only, no index or worktree is touched, so this
   * needs none of the confirmation machinery the write paths carry.
   *
   * @param worktreePath - directory to run in; empty falls back to the host cwd.
   * @param path - repository-relative path, as the drawer lists it.
   * @param signal - abort signal.
   */
  @Remote('blame')
  async blame(worktreePath: string, path: string, signal: AbortSignal): Promise<{ lines: BlameLine[]; truncated: boolean; error?: string }> {
    if (typeof path !== 'string' || !isSafePathArg(path)) {
      return { lines: [], truncated: false, error: `unsafe path argument: ${JSON.stringify(path)}` }
    }
    const cwd = this.cwdOf(worktreePath)
    // `--` keeps a path that looks like a revision from being read as one, as
    // every other pathspec in this plugin does.
    const run = await this.git(cwd, ['blame', '--line-porcelain', '--', path], signal)
    if (run.exitCode !== 0) {
      // An untracked file has no blame, and git says so; that message is the
      // honest thing to show rather than an empty gutter.
      return { lines: [], truncated: false, error: (run.stderr || run.stdout).trim().slice(-500) }
    }
    const all = parseBlame(run.stdout)
    // The same line cap the side pane declines a file at: past it the gutter
    // is a payload nobody reads to the end of.
    if (all.length > SIDE_LINE_CAP) return { lines: all.slice(0, SIDE_LINE_CAP), truncated: true }
    return { lines: all, truncated: false }
  }

  /**
   * One working-tree file's bytes, when those bytes really are an image.
   *
   * The Files tab's fallback for a picture used to be "binary file — no text
   * diff", which is true and useless: a repository's icons and screenshots are
   * content, and a browser is already the best image viewer on the machine.
   *
   * The EXTENSION does not decide. It cannot: a `.png` is a filename, and a
   * view that trusted it would hand the browser whatever bytes happened to be
   * under that name. {@link sniffImage} reads the signature the format's own
   * specification mandates, and a file that fails it comes back `notImage` so
   * the client falls back to the ordinary text path — a mislabelled file still
   * opens, as itself.
   *
   * The size check runs off the stat rather than the read, the same way
   * `fileSides` does it: declining an oversized file must not mean loading it
   * whole first. Base64 rather than a binary frame because the RPC channel is
   * JSON; the third it adds is why {@link IMAGE_BYTE_CAP} sits where it does.
   *
   * Read-only — nothing is spawned, nothing is written.
   *
   * @param worktreePath - directory to run in; empty falls back to the host cwd.
   * @param path - repository-relative path, as the drawer lists it.
   * @param signal - abort signal.
   */
  @Remote('fileImage')
  async fileImage(worktreePath: string, path: string, signal: AbortSignal): Promise<FileImage> {
    if (typeof path !== 'string' || !isSafePathArg(path)) {
      throw new Error(`unsafe path argument: ${JSON.stringify(path)}`)
    }
    const full = join(this.cwdOf(worktreePath), path)
    let size = 0
    try {
      const info = await stat(full)
      if (!info.isFile()) return declined('missing', 0)
      size = info.size
    } catch {
      return declined('missing', 0)
    }
    if (size > IMAGE_BYTE_CAP) return declined('tooLarge', size)
    let bytes: Buffer
    try {
      bytes = await readFile(full)
    } catch {
      return declined('missing', 0)
    }
    // Re-checked against the bytes actually read: the stat above is a separate
    // syscall, and the file can have grown between the two.
    if (bytes.length > IMAGE_BYTE_CAP) return declined('tooLarge', bytes.length)
    const found = sniffImage(bytes)
    if (found === null) return declined('notImage', bytes.length)
    return {
      ok: true,
      mime: found.mime,
      kind: found.kind,
      base64: bytes.toString('base64'),
      bytes: bytes.length,
      reason: '',
    }
  }

  /**
   * Whether git has never seen this path: no index entry and no HEAD entry.
   * Those are the files whose diff has to be synthesized rather than asked of
   * `git diff`, which reports nothing for them.
   */
  private async isUntracked(cwd: string, path: string, signal: AbortSignal): Promise<boolean> {
    const listed = await this.git(cwd, ['ls-files', '--', path], signal)
    if (listed.exitCode !== 0 || listed.stdout.trim().length > 0) return false
    const head = await this.git(cwd, ['rev-parse', '--verify', '--quiet', `HEAD:${path}`], signal)
    return head.exitCode !== 0
  }

  /**
   * One commit's change set, in the SAME {@link WorkbenchStats} shape as the working-tree
   * view so the drawer's tree and diff panes render it with no separate code path.
   * `branch` carries the short hash (there is no branch to name) and `commits` the
   * single commit's metadata.
   *
   * Rename detection is off: with `--no-renames` the paths from `--numstat` and
   * `--name-status` agree exactly and match the patch text, at the cost of showing
   * a rename as a delete plus an add.
   */
  @Remote('commitStats')
  async commitStats(worktreePath: string, hash: string, signal: AbortSignal): Promise<WorkbenchStats> {
    const cwd = typeof worktreePath === 'string' && worktreePath.length > 0 ? worktreePath : process.cwd()
    if (typeof hash !== 'string' || !COMMIT_HASH.test(hash)) {
      return { ...emptyStats(cwd), error: 'not a commit hash' }
    }
    const key = cacheKey(cwd, hash)
    const cached = this.commitStatsCache.get(key)
    if (cached !== undefined) return cached

    // Four independent reads of one immutable commit, so they run concurrently.
    // A git spawn costs ~100ms on Windows and dominates the work itself, which
    // made the sequential chain roughly four times slower than the data
    // required. The cost is that a well-formed hash naming no object now spends
    // four failed spawns where it used to stop after one.
    // `--first-parent` is what makes a MERGE show anything at all. Plain
    // `git show` prints no diff for a commit with two parents — there is no
    // single "before" to compare against — so selecting a merge used to open an
    // empty pane. Against the first parent the answer is well defined and is the
    // useful one: what this merge brought into the branch it landed on. On a
    // single-parent commit the flag is a no-op, byte for byte.
    const [meta, numstat, nameStatus, patch] = await Promise.all([
      this.git(cwd, ['show', hash, '--no-patch', `--format=${LOG_FORMAT}`], signal),
      this.git(cwd, ['show', hash, '--first-parent', '--numstat', '--format=', '--no-renames'], signal),
      this.git(cwd, ['show', hash, '--first-parent', '--name-status', '--format=', '--no-renames'], signal),
      this.git(cwd, ['show', hash, '--first-parent', '--format=', '--no-renames'], signal),
    ])
    if (meta.exitCode !== 0) {
      const detail = meta.stderr.length > 0 ? `: ${meta.stderr}` : ''
      return { ...emptyStats(cwd), error: `git show failed (exit ${meta.exitCode})${detail}` }
    }
    const commits = parseLog(meta.stdout)
    const files = parseNameStatus(nameStatus.stdout, parseNumstat(numstat.stdout))

    let addedLines = 0
    let deletedLines = 0
    let addedFiles = 0
    let deletedFiles = 0
    let modifiedFiles = 0
    for (const file of files) {
      addedLines += file.addedLines
      deletedLines += file.deletedLines
      if (file.status === 'added') addedFiles += 1
      else if (file.status === 'deleted') deletedFiles += 1
      else modifiedFiles += 1
    }

    let diff = patch.stdout
    diff = clipDiff(diff, DIFF_CHAR_CAP, '…[diff truncated]')

    const value: WorkbenchStats = {
      worktreePath: cwd,
      branch: commits[0]?.hash ?? hash.slice(0, 7),
      ahead: 0, behind: 0, detached: false,
      addedLines, deletedLines, addedFiles, deletedFiles, modifiedFiles,
      files, diff, commits,
    }
    // Only a successful read is stored. Caching the error payloads above would
    // pin a transient condition — an aborted signal, a repository mid-fetch —
    // for the rest of the process.
    this.commitStatsCache.set(key, value)
    return value
  }

  /**
   * A page of some ref's commit log.
   *
   * The ref is a parameter because a log needs no working tree: a branch with no
   * worktree cannot be viewed as files, but its history reads exactly like any
   * other. The worktree argument only says which object store resolves the ref.
   * @param worktreePath - worktree whose object store resolves the ref; empty falls back to the host cwd.
   * @param ref - ref to walk; empty means the worktree's own HEAD.
   * @param skip - commits to skip, counting back from the ref.
   * @param limit - page size; out-of-range values fall back to the default page.
   * @param filter - history filter compiled into git log arguments (IDEA-style
   *   pushdown: matching runs over ALL history, not the loaded pages). Absent
   *   from older clients — treated as "no filter".
   * @param signal - abort signal.
   * @returns the page, and whether the log continues past it.
   */
  @Remote('commits')
  async commits(worktreePath: string, ref: string, skip: number, limit: number, filter: LogFilter, signal: AbortSignal): Promise<{ commits: GitCommit[]; hasMore: boolean; error?: string }> {
    const cwd = typeof worktreePath === 'string' && worktreePath.length > 0 ? worktreePath : process.cwd()
    // '--all' is the ALL-BRANCHES sentinel (a ref cannot begin with a dash, so
    // it collides with nothing): "who did what" must not require knowing which
    // branch holds it — IDEA's All branches, same idea.
    const target = ref === '--all' ? '--all' : (typeof ref === 'string' && ref.length > 0 ? ref : 'HEAD')
    if (target !== '--all' && !isRefName(target)) return { commits: [], hasMore: false }
    const from = Number.isInteger(skip) && skip >= 0 ? skip : 0
    const size = Number.isInteger(limit) && limit > 0 && limit <= HISTORY_PAGE_MAX ? limit : HISTORY_PAGE
    const effective = filter ?? emptyLogFilter()
    // Reading one row beyond the page answers "is there more" without a second
    // traversal of the log.
    //
    // `--topo-order` is what makes the commit graph legible, and it is why the
    // list is not in date order. Default (chronological) ordering interleaves
    // commits from concurrent branches, so a branch's lane opens, sits idle for
    // a dozen unrelated rows, and closes far from where it started. Topological
    // order keeps a branch's commits contiguous — it is what `git log --graph`
    // turns on for itself, for the same reason.
    //
    // Filter args go LAST: their segment ends with `--` + pathspecs, and
    // nothing after that separator may be parsed as a flag.
    const log = await this.git(
      cwd,
      ['log', target, '--topo-order', `--skip=${from}`, `-${size + 1}`, `--pretty=format:${LOG_FORMAT}`, ...logFilterArgs(effective)],
      signal,
    )
    // A bad filter (unparsable regex, invalid date) dies here, and an empty
    // page is indistinguishable from "no match" unless the failure speaks —
    // §6.13: the exit code + stderr tail is the only honest answer.
    if (log.exitCode !== 0) {
      const detail = log.stderr.length > 0 ? `: ${log.stderr.slice(-160)}` : ''
      return { commits: [], hasMore: false, error: `git log failed (exit ${log.exitCode})${detail}` }
    }
    const page = parseLog(log.stdout)
    return { commits: page.slice(0, size), hasMore: page.length > size }
  }

  /**
   * Every author with commits reachable from a ref, busiest first — the
   * history filter popup's user picker.
   *
   * The roster walks the SAME ref the history list walks (`git shortlog -sne
   * <ref>`), not `--all`: a picker entry is a promise that ticking it yields
   * commits in the list below. `--all` once listed authors whose commits live
   * only on other refs — visible in the menu, invisible to every search.
   * @param worktreePath - worktree whose object store resolves the ref; empty falls back to the host cwd.
   * @param ref - ref whose history the roster counts; empty means HEAD.
   * @param signal - abort signal.
   */
  @Remote('authors')
  async authors(worktreePath: string, ref: string, signal: AbortSignal): Promise<{ authors: AuthorEntry[]; truncated: boolean }> {
    const cwd = typeof worktreePath === 'string' && worktreePath.length > 0 ? worktreePath : process.cwd()
    // Same '--all' sentinel as `commits`: when the list walks every ref, the
    // roster counts every ref — the picker and the list stay one claim.
    const target = ref === '--all' ? '--all' : (typeof ref === 'string' && ref.length > 0 ? ref : 'HEAD')
    if (target !== '--all' && !isRefName(target)) return { authors: [], truncated: false }
    const res = await this.git(cwd, ['shortlog', '-sne', target], signal)
    return parseShortlog(res.stdout, SHORTLOG_CAP)
  }

  /**
   * Every file path on HEAD — the filter popup's path picker, aggregated into
   * a directory tree client-side.
   *
   * `-z` is load-bearing: NUL-separated output is UNQUOTED, while the default
   * would render non-ASCII names as quoted octal escapes under
   * `core.quotepath` and hand the picker garbage.
   * @param worktreePath - worktree whose HEAD is listed; empty falls back to the host cwd.
   * @param signal - abort signal.
   */
  @Remote('repoTree')
  async repoTree(worktreePath: string, signal: AbortSignal): Promise<{ paths: string[]; truncated: boolean }> {
    const cwd = typeof worktreePath === 'string' && worktreePath.length > 0 ? worktreePath : process.cwd()
    const res = await this.git(cwd, ['ls-tree', '-r', '-z', '--name-only', 'HEAD'], signal)
    const all = res.stdout.split('\0').filter(path => path.length > 0)
    const truncated = all.length > TREE_PATH_CAP
    return { paths: truncated ? all.slice(0, TREE_PATH_CAP) : all, truncated }
  }

  /**
   * Compare two refs, in the same {@link WorkbenchStats} shape as every other view.
   *
   * The diff uses `base...head`: what `head` changed since the two diverged,
   * which is what "the difference between these branches" normally means and
   * what a forge's compare view shows. A plain two-dot diff would additionally
   * report everything `base` gained in the meantime as if `head` had removed it.
   * `commits` carries the commits unique to `head` (`base..head`).
   *
   * Deliberately NOT cached: a ref name is a moving pointer, unlike the commit
   * hash {@link commitStats} is keyed by.
   * @param worktreePath - worktree whose object store resolves the refs.
   * @param base - ref the comparison starts from.
   * @param head - ref whose changes are reported.
   * @param signal - abort signal.
   * @returns the change set between the refs, or an error payload.
   */
  @Remote('compareRefs')
  async compareRefs(worktreePath: string, base: string, head: string, signal: AbortSignal): Promise<WorkbenchStats> {
    const cwd = typeof worktreePath === 'string' && worktreePath.length > 0 ? worktreePath : process.cwd()
    if (!isRefName(base) || !isRefName(head)) return { ...emptyStats(cwd), error: 'not a ref name' }
    const range = `${base}...${head}`
    const diffNumstat = (args: readonly string[]) => this.git(cwd, ['diff', '--numstat', '--no-renames', ...args], signal)
    const diffNameStatus = (args: readonly string[]) => this.git(cwd, ['diff', '--name-status', '--no-renames', ...args], signal)
    const diffPatch = (args: readonly string[]) => this.git(cwd, ['diff', '--no-renames', ...args], signal)
    let [numstat, nameStatus, patch, log] = await Promise.all([
      diffNumstat([range]),
      diffNameStatus([range]),
      diffPatch([range]),
      this.git(cwd, ['log', `-${HISTORY_COMMITS}`, `--pretty=format:${LOG_FORMAT}`, `${base}..${head}`], signal),
    ])
    if (numstat.exitCode !== 0 && isNoMergeBaseError(numstat.stderr)) {
      // Unrelated histories have no merge base for `A...B` to diff from. A
      // two-tip diff still answers "what differs between these branches" with
      // the full tree — which is what the compare tab is for (TESTS.md C3).
      ;[numstat, nameStatus, patch] = await Promise.all([
        diffNumstat([base, head]),
        diffNameStatus([base, head]),
        diffPatch([base, head]),
      ])
    }
    if (numstat.exitCode !== 0) {
      const detail = numstat.stderr.length > 0 ? `: ${numstat.stderr}` : ''
      return { ...emptyStats(cwd), error: `git diff failed (exit ${numstat.exitCode})${detail}` }
    }
    const files = parseNameStatus(nameStatus.stdout, parseNumstat(numstat.stdout))

    let addedLines = 0
    let deletedLines = 0
    let addedFiles = 0
    let deletedFiles = 0
    let modifiedFiles = 0
    for (const file of files) {
      addedLines += file.addedLines
      deletedLines += file.deletedLines
      if (file.status === 'added') addedFiles += 1
      else if (file.status === 'deleted') deletedFiles += 1
      else modifiedFiles += 1
    }

    let diff = patch.stdout
    diff = clipDiff(diff, DIFF_CHAR_CAP, '…[diff truncated]')

    return {
      worktreePath: cwd, branch: range,
      ahead: 0, behind: 0, detached: false,
      addedLines, deletedLines, addedFiles, deletedFiles, modifiedFiles,
      files, diff, commits: parseLog(log.stdout),
    }
  }

  /** The session's worktree binding, or nulls when unbound (plain-identifier params; signal last). */
  @Remote('sessionWorktree')
  async sessionWorktree(sessionId: string, signal: AbortSignal): Promise<{ worktreePath: string | null; name: string | null }> {
    if (typeof sessionId !== 'string' || sessionId.length === 0) return { worktreePath: null, name: null }
    const file = await this.bindingsIo().load()
    const binding = file.bindings[sessionId]
    return binding === undefined ? { worktreePath: null, name: null } : { worktreePath: binding.worktreePath, name: binding.name }
  }

  /** Create (or reuse) a git worktree under `<repoRoot>/.agents/worktrees/` and bind the session to it. */
  @Remote('worktreeEnter')
  async worktreeEnter(sessionId: string, repoPath: string, name: string | undefined, signal: AbortSignal): Promise<WorktreeOpResult> {
    if (typeof sessionId !== 'string' || sessionId.length === 0) return { ok: false, error: 'sessionId is required' }
    const cwd = typeof repoPath === 'string' && repoPath.length > 0 ? repoPath.replace(/\\/g, '/') : process.cwd()
    const repoRoot = await this.repoRootOf(cwd, signal)
    if (repoRoot === null) {
      const probe = await this.git(cwd, ['rev-parse', '--show-toplevel'], signal)
      return { ok: false, error: `not a git repository${probe.stderr.length > 0 ? `: ${probe.stderr}` : ''}` }
    }
    const wtName = sanitizeName(name, () => randomHex(6))
    const dir = worktreeDir(repoRoot, wtName)
    // A cancelled `add`, a crashed host, or a worktree directory deleted by hand all
    // leave a registration git keeps reporting (flagged `prunable`, which the list
    // parser does not read). Prune FIRST so the list below describes what is really
    // on disk — otherwise a stale entry passes for a reusable worktree and the
    // session binds to a directory that no longer exists.
    await this.git(repoRoot, ['worktree', 'prune'], signal)
    // A registered worktree already lives at the target directory -> reuse it,
    // whatever made it. The match is on real paths, not strings: junctions
    // (`.agents/worktrees` pointing at `.claude/worktrees`) and the spelling a
    // foreign tool registered under all collapse to the same directory, and
    // the worktree keeps ITS OWN branch — only the binding is new.
    const existing = await findRegisteredWorktree(
      parseWorktreeList((await this.git(repoRoot, ['worktree', 'list', '--porcelain'], signal)).stdout),
      dir,
      realpath,
    )
    // Branch point, read BEFORE `add` so a fresh worktree records exactly where it
    // started. Reuse paths recover it with merge-base instead (theirs is historical).
    const headBefore = (await this.git(repoRoot, ['rev-parse', 'HEAD'], signal)).stdout.trim()
    // The branch the session actually lands on: the reused worktree's own branch,
    // or the name VERBATIM for a fresh create — no forced prefix.
    let branch = existing?.branch ?? wtName
    let reusedWorktree = false
    let reusedBranch = false
    let baseCommit: string | undefined
    if (existing === undefined) {
      const add = await this.git(repoRoot, ['worktree', 'add', '-b', wtName, dir], signal)
      if (add.exitCode === 0) {
        baseCommit = headBefore.length > 0 ? headBefore : undefined
      } else {
        // `git worktree remove` keeps the branch (it may carry unmerged
        // commits), so a re-enter after remove finds the name present as a
        // branch: verify the ref and check the existing branch out instead
        // of failing on `-b`.
        const verified = await this.git(repoRoot, ['rev-parse', '--verify', '--quiet', `refs/heads/${wtName}`], signal)
        if (verified.exitCode !== 0) {
          return { ok: false, error: `git worktree add failed (exit ${add.exitCode})${add.stderr.length > 0 ? `: ${add.stderr}` : ''}` }
        }
        const retry = await this.git(repoRoot, ['worktree', 'add', dir, wtName], signal)
        if (retry.exitCode !== 0) {
          return { ok: false, error: `git worktree add failed (exit ${retry.exitCode})${retry.stderr.length > 0 ? `: ${retry.stderr}` : ''}` }
        }
        reusedBranch = true
      }
    } else {
      reusedWorktree = true
    }
    if (baseCommit === undefined) {
      // Reused worktree or branch: its real branch point is historical, so take the
      // merge base with the repo's current HEAD. A failure leaves the field absent.
      const merged = await this.git(repoRoot, ['merge-base', branch, 'HEAD'], signal)
      if (merged.exitCode === 0) baseCommit = merged.stdout.trim() || undefined
    }
    await this.withBindings(async io => {
      const file = await io.load()
      const binding: WorktreeBinding = {
        repoRoot, worktreePath: dir, name: wtName, enteredAt: new Date().toISOString(),
        branch,
        ...baseCommit === undefined ? {} : { baseCommit },
      }
      file.bindings[sessionId] = binding
      await io.save(file)
      this.bindingMirror.set(sessionId, binding)
    })
    const rel = `.agents/worktrees/${wtName}`
    return {
      ok: true, worktreePath: dir, branch,
      hint: `Session bound to worktree "${wtName}" (branch ${branch}) at ${rel}/. For shell commands pass workdir "${rel}" (per-call workdir is supported and resolved against the session cwd); for file tools use paths relative to the session cwd prefixed with ${rel}/. Call worktree_exit to unbind.${reusedWorktree ? ` Note: reused the worktree already registered there; its branch ${branch} was kept.` : ''}${reusedBranch ? ` Note: reused existing branch ${branch} (carries its prior commits).` : ''}`,
    }
  }

  /** Unbind the session's worktree; with remove=true, delete a clean worktree from disk. */
  @Remote('worktreeExit')
  async worktreeExit(sessionId: string, remove: boolean | undefined, signal: AbortSignal): Promise<WorktreeOpResult> {
    if (typeof sessionId !== 'string' || sessionId.length === 0) return { ok: false, error: 'sessionId is required' }
    // The whole load→save span runs under the binding mutex: a concurrent enter
    // must not save a file that still contains this session's binding.
    return this.withBindings(async io => {
      const file = await io.load()
      const binding = file.bindings[sessionId]
      if (binding === undefined) return { ok: false, error: 'no worktree binding for this session' }
      if (remove === true) {
        const status = await this.git(binding.worktreePath, ['status', '--porcelain'], signal)
        if (status.exitCode !== 0) {
          return { ok: false, error: `cannot inspect worktree (exit ${status.exitCode})${status.stderr.length > 0 ? `: ${status.stderr}` : ''}` }
        }
        if (status.stdout.trim().length > 0) {
          return { ok: false, error: 'worktree has uncommitted changes; commit or stash first, or call worktree_exit without remove to keep it' }
        }
        const rm = await this.git(binding.repoRoot, ['worktree', 'remove', binding.worktreePath], signal)
        if (rm.exitCode !== 0) {
          return { ok: false, error: `git worktree remove failed (exit ${rm.exitCode})${rm.stderr.length > 0 ? `: ${rm.stderr}` : ''}` }
        }
      }
      delete file.bindings[sessionId]
      await io.save(file)
      this.bindingMirror.delete(sessionId)
      return { ok: true, worktreePath: binding.worktreePath, hint: remove === true ? 'Worktree removed and binding cleared.' : 'Binding cleared; worktree kept on disk.' }
    })
  }

  /**
   * The session's binding, every worktree of the surrounding repo, and every
   * local branch (all empty when unbound and outside a repo).
   *
   * Worktrees and branches are BOTH reported because they answer different
   * questions: a worktree can be viewed as a working tree, while a branch with
   * no worktree has no directory to read and can only be browsed or compared.
   *
   * Branches come back most-recently-committed first. With hundreds of them the
   * order is what makes the list usable — the handful anyone is working on sit
   * at the top, so the picker is useful before a single character is typed.
   * @param sessionId - session whose binding is looked up.
   * @param repoPath - caller's directory, used when the session is unbound.
   * @param signal - abort signal.
   * @returns the binding, the repository's worktrees, and its local branches.
   */
  @Remote('worktreeStatus')
  async worktreeStatus(sessionId: string, repoPath: string, signal: AbortSignal): Promise<{ binding: WorktreeBinding | null; worktrees: WorktreeEntry[]; branches: string[]; branchesTruncated: boolean }> {
    const file = await this.bindingsIo().load()
    const binding = typeof sessionId === 'string' && sessionId.length > 0 ? file.bindings[sessionId] ?? null : null
    // Unbound: list the CALLER's repo. Falling back to the host's launch directory
    // would answer about whatever directory dsh was started in, not this session's.
    const caller = typeof repoPath === 'string' && repoPath.length > 0 ? repoPath.replace(/\\/g, '/') : process.cwd()
    const cwd = binding?.repoRoot ?? caller
    const root = await this.repoRootOf(cwd, signal)
    if (root === null) return { binding, worktrees: [], branches: [], branchesTruncated: false }
    const [listed, named] = await Promise.all([
      this.git(root, ['worktree', 'list', '--porcelain'], signal),
      this.git(root, ['branch', '--sort=-committerdate', '--format=%(refname:short)'], signal),
    ])
    const all = named.stdout.split('\n').map(line => line.trim()).filter(line => line.length > 0)
    const { branches, branchesTruncated } = capBranches(all, BRANCH_LIST_CAP)
    return {
      binding,
      worktrees: parseWorktreeList(listed.stdout),
      branches,
      branchesTruncated,
    }
  }

  /**
   * The styling that applies to a directory: its project's, and the global one.
   *
   * Both are returned rather than one resolved entry, because the menu edits
   * each scope separately and has to show what each currently holds. Resolution
   * — project wins — belongs to the client that renders it.
   * @param worktreePath - directory whose repository identifies the project.
   * @param signal - abort signal.
   * @returns the two scopes' entries (null when unset) and the resolved repo root.
   */
  @Remote('styleGet')
  async styleGet(worktreePath: string, signal: AbortSignal): Promise<{ project: StyleEntry | null; global: StyleEntry | null; repoRoot: string | null }> {
    const file = await this.styleIo().load()
    const root = await this.repoRootFor(worktreePath, signal)
    return {
      project: root === null ? null : file.projects[root] ?? null,
      global: isBlankEntry(file.global) ? null : file.global,
      repoRoot: root,
    }
  }

  /**
   * Replace one scope's styling.
   *
   * A blank entry deletes the scope's record instead of storing an empty one: a
   * stored blank project entry is indistinguishable from "cleared" to a reader,
   * but it would still shadow the global scope.
   * @param worktreePath - directory whose repository identifies the project.
   * @param scope - `project` or `global`.
   * @param entry - the styling to store; anything invalid in it is dropped.
   * @param signal - abort signal.
   * @returns whether it was stored, with the reason when it was not.
   */
  @Remote('styleSet')
  async styleSet(worktreePath: string, scope: string, entry: unknown, signal: AbortSignal): Promise<{ ok: boolean; error?: string }> {
    if (scope !== 'project' && scope !== 'global') return { ok: false, error: `unknown scope "${String(scope)}"` }
    const clean = sanitizeEntry(entry)
    const root = scope === 'project' ? await this.repoRootFor(worktreePath, signal) : null
    if (scope === 'project' && root === null) return { ok: false, error: 'not inside a git repository' }
    return this.withStyle(async io => {
      const file = await io.load()
      const projects = { ...file.projects }
      if (scope === 'project' && root !== null) {
        if (isBlankEntry(clean)) delete projects[root]
        else projects[root] = clean
      }
      await io.save({ v: 1, global: scope === 'global' ? clean : file.global, projects })
      return { ok: true }
    })
  }

  /* ------------------------------- write ops ------------------------------- */

  /**
   * Where the current branch stands against its upstream.
   *
   * Read from `git status` rather than `rev-list --count`, because the drawer
   * needs the same call to tell "tracks nothing" apart from "tracks origin and
   * is level with it" — the first is what makes push pass `--set-upstream`, and
   * a count query answers zero for both.
   * @param worktreePath - directory to read; empty falls back to the host cwd.
   * @param signal - abort signal.
   * @returns the branch, its upstream, and the divergence in commits.
   */
  @Remote('syncStatus')
  async syncStatus(worktreePath: string, signal: AbortSignal): Promise<Tracking & { hasRemote: boolean }> {
    const cwd = this.cwdOf(worktreePath)
    const [status, remotes] = await Promise.all([
      this.git(cwd, ['status', '--porcelain=v1', '--branch'], signal),
      this.git(cwd, ['remote'], signal),
    ])
    return { ...parseTracking(status.stdout), hasRemote: remotes.stdout.trim().length > 0 }
  }

  /**
   * Add paths to the index.
   * @param worktreePath - directory to run in.
   * @param paths - repository-relative paths; an empty list is refused rather
   *                than turned into a whole-tree `git add`.
   * @param signal - abort signal.
   */
  @Remote('stage')
  async stage(worktreePath: string, paths: readonly string[], signal: AbortSignal): Promise<GitOpResult> {
    return this.writeOp(worktreePath, () => stageArgv(asPathList(paths)), signal)
  }

  /**
   * Remove paths from the index, leaving the working tree untouched.
   * @param worktreePath - directory to run in.
   * @param paths - repository-relative paths.
   * @param signal - abort signal.
   */
  @Remote('unstage')
  async unstage(worktreePath: string, paths: readonly string[], signal: AbortSignal): Promise<GitOpResult> {
    return this.writeOp(worktreePath, () => unstageArgv(asPathList(paths)), signal)
  }

  /**
   * What discarding this file WOULD do, without doing it.
   *
   * The confirmation has to state the real consequence, and only git knows it:
   * the drawer's own file list is a poll old, and the difference between "this
   * goes back to its committed content" and "this file leaves the disk and
   * cannot come back" is exactly the difference the reader is being asked
   * about. So the dialog is built from this, read fresh, rather than from the
   * row that was clicked.
   * @param worktreePath - directory to run in.
   * @param path - repository-relative path, as the drawer lists it.
   * @param signal - abort signal.
   * @returns the effect and whether it is irreversible; `effect` is absent when
   *          git reports nothing to discard for that path.
   */
  @Remote('discardPlan')
  async discardPlan(worktreePath: string, path: string, signal: AbortSignal): Promise<{
    effect?: DiscardEffect
    irreversible?: boolean
    previousPath?: string
    error?: string
  }> {
    let plan: DiscardPlan | null
    try {
      plan = await this.planDiscard(worktreePath, path, signal)
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
    if (plan === null) return {}
    // JSON-safe: an absent previousPath is an omitted key, never `undefined`.
    return plan.previousPath !== undefined
      ? { effect: plan.effect, irreversible: plan.irreversible, previousPath: plan.previousPath }
      : { effect: plan.effect, irreversible: plan.irreversible }
  }

  /**
   * Take one file back to its committed state — IntelliJ's Rollback.
   *
   * One path per call, never a list. Discarding is the only thing the drawer
   * does that cannot be undone, and a batch entry point is the shape that
   * turns one mistaken click into a lost afternoon; a caller that wants two
   * files asks twice, and gets asked twice.
   *
   * The plan is re-derived here from a fresh `git status`, so a client that
   * mislabels a tracked file as untracked cannot talk the host into deleting
   * it. `expectedEffect` is what the reader was shown and agreed to: if the
   * file changed underneath the dialog — staged, edited, reverted by someone
   * else — the freshly derived effect no longer matches and nothing is done.
   * @param worktreePath - directory to run in.
   * @param path - repository-relative path, as the drawer lists it.
   * @param expectedEffect - the effect the confirmation stated; blank skips
   *                         the agreement check, which only the reversible
   *                         `recover` path takes (it shows no dialog).
   * @param signal - abort signal.
   * @returns the operation result, with the effect actually carried out.
   */
  @Remote('discardFile')
  async discardFile(worktreePath: string, path: string, expectedEffect: string | undefined, signal: AbortSignal): Promise<GitOpResult & { effect?: DiscardEffect }> {
    let plan: DiscardPlan | null
    try {
      plan = await this.planDiscard(worktreePath, path, signal)
    } catch (error) {
      return { ok: false, failure: 'unknown', error: error instanceof Error ? error.message : String(error) }
    }
    // Nothing to discard is not a failure: the row was stale, and the tree the
    // client refreshes onto will simply no longer carry it.
    if (plan === null) return { ok: true }
    if (typeof expectedEffect === 'string' && expectedEffect.length > 0 && expectedEffect !== plan.effect) {
      return {
        ok: false,
        failure: 'unknown',
        error: `this file changed since you were asked (now: ${plan.effect}); nothing was done`,
      }
    }

    const cwd = this.cwdOf(worktreePath)
    for (const step of plan.steps) {
      if (step.kind === 'git') {
        const result = await this.git(cwd, step.argv, signal)
        const failure = classifyFailure(result.exitCode, result.stderr, result.stdout)
        if (failure !== null) {
          return { ok: false, failure, error: (result.stderr || result.stdout).trim().slice(-1000) }
        }
        continue
      }
      try {
        await removePathInside(cwd, step.path)
      } catch (error) {
        return { ok: false, failure: 'unknown', error: error instanceof Error ? error.message : String(error) }
      }
    }
    return { ok: true, effect: plan.effect }
  }

  /**
   * Read the worktree's status and plan for one path.
   *
   * The status is the WHOLE tree's, deliberately: git pairs a deletion with an
   * addition to see a rename, and a pathspec that admits only one of the pair
   * reports `D` plus `??` instead — which plans as "restore one, DELETE the
   * other" where the truth is "undo the rename".
   */
  private async planDiscard(worktreePath: string, path: string, signal: AbortSignal): Promise<DiscardPlan | null> {
    if (typeof path !== 'string' || !isSafePathArg(path)) {
      throw new Error(`unsafe path argument: ${JSON.stringify(path)}`)
    }
    const cwd = this.cwdOf(worktreePath)
    const status = await this.git(cwd, ['status', '--porcelain=v1', '--untracked-files=all'], signal)
    if (status.exitCode !== 0) {
      throw new Error((status.stderr || status.stdout).trim().slice(-1000) || 'git status failed')
    }
    return planFromStatus(status.stdout, path)
  }

  /**
   * Commit what is in the index.
   * @param worktreePath - directory to run in.
   * @param message - commit message, used verbatim; blank is refused.
   * @param amend - replace the previous commit rather than adding one.
   * @param signal - abort signal.
   */
  @Remote('commit')
  async commit(worktreePath: string, message: string, amend: boolean | undefined, signal: AbortSignal): Promise<GitOpResult> {
    return this.writeOp(worktreePath, () => commitArgv(String(message ?? ''), amend === true), signal)
  }

  /**
   * Update remote-tracking refs without touching the working tree.
   * @param worktreePath - directory to run in.
   * @param signal - abort signal.
   * @returns the operation result, plus the divergence the fetch revealed.
   */
  @Remote('fetch')
  async fetch(worktreePath: string, signal: AbortSignal): Promise<GitOpResult & { tracking?: Tracking }> {
    const result = await this.writeOp(worktreePath, () => fetchArgv(), signal, NETWORK_GRACE_MS)
    if (!result.ok) return result
    // The point of fetching is the count it produces, so report it in the same
    // round trip rather than making the client ask again.
    const status = await this.git(this.cwdOf(worktreePath), ['status', '--porcelain=v1', '--branch'], signal)
    return { ...result, tracking: parseTracking(status.stdout) }
  }

  /**
   * Integrate the upstream's commits.
   * @param worktreePath - directory to run in.
   * @param mode - `ff-only` (default), `rebase`, or `merge`. Always explicit, so
   *               the button's label is what actually runs.
   * @param signal - abort signal.
   */
  @Remote('pull')
  async pull(worktreePath: string, mode: string | undefined, signal: AbortSignal): Promise<GitOpResult> {
    const chosen: PullMode = mode === 'rebase' || mode === 'merge' ? mode : 'ff-only'
    return this.writeOp(worktreePath, () => pullArgv(chosen), signal, NETWORK_GRACE_MS)
  }

  /**
   * Publish the current branch.
   *
   * Never forces. A rejected push means the remote holds commits this branch
   * does not, and the answer to that is to pull, not to overwrite somebody's
   * work — the failure is classified as `diverged` so the drawer can say so.
   * @param worktreePath - directory to run in.
   * @param signal - abort signal.
   */
  @Remote('push')
  async push(worktreePath: string, signal: AbortSignal): Promise<GitOpResult> {
    const cwd = this.cwdOf(worktreePath)
    const status = await this.git(cwd, ['status', '--porcelain=v1', '--branch'], signal)
    const tracking = parseTracking(status.stdout)
    if (tracking.detached) return { ok: false, failure: 'unknown', error: 'HEAD is detached; nothing to push' }
    if (tracking.branch.length === 0) return { ok: false, failure: 'unknown', error: 'no branch to push' }
    return this.writeOp(worktreePath, () => pushArgv(tracking.branch, tracking.upstream !== null), signal, NETWORK_GRACE_MS)
  }

  /** Shared shape for every write op: run it, classify what went wrong. */
  private async writeOp(
    worktreePath: string,
    build: () => readonly string[],
    signal: AbortSignal,
    graceMs?: number,
  ): Promise<GitOpResult> {
    let argv: readonly string[]
    try {
      argv = build()
    } catch (error) {
      // A rejected argument never reaches git. This is the path an empty path
      // list or a blank commit message takes.
      return { ok: false, failure: 'unknown', error: error instanceof Error ? error.message : String(error) }
    }
    const result = await this.git(this.cwdOf(worktreePath), argv, signal, graceMs)
    const failure = classifyFailure(result.exitCode, result.stderr, result.stdout)
    if (failure === null) return { ok: true, output: result.stdout.trim().slice(-1000) }
    // The classification is a hint; the real text rides along beside it, because
    // "unknown" has to stay actionable.
    return { ok: false, failure, error: (result.stderr || result.stdout).trim().slice(-1000) }
  }

  /** A directory argument, falling back to the host's own cwd. */
  private cwdOf(worktreePath: string | undefined): string {
    return typeof worktreePath === 'string' && worktreePath.length > 0 ? worktreePath : process.cwd()
  }

  /**
   * @param worktreePath - a directory, or an empty value for the host's cwd.
   * @param signal - abort signal.
   * @returns the enclosing repository root, or null outside a repository.
   */
  private repoRootFor(worktreePath: string, signal: AbortSignal): Promise<string | null> {
    const cwd = typeof worktreePath === 'string' && worktreePath.length > 0 ? worktreePath.replace(/\\/g, '/') : process.cwd()
    return this.repoRootOf(cwd, signal)
  }

  /** Style-file IO, mirroring {@link bindingsIo}. */
  private styleIo(): StyleFileIo {
    const path = stylePath(homedir())
    return {
      path,
      load: (): Promise<StyleFile> => loadStyle(async p => readFile(p, 'utf8'), path),
      save: (file: StyleFile): Promise<void> =>
        saveJsonAtomic(async d => { await mkdir(d, { recursive: true }) }, async (p, s) => { await writeFile(p, s, 'utf8') }, async (from, to) => { await rename(from, to) }, path, file),
    }
  }

  /** Tail of the promise chain that serializes style-file critical sections. */
  private styleQueue: Promise<unknown> = Promise.resolve()

  /** Run a style load→save section to completion before the next starts, so two
   *  scopes saved at once cannot overwrite each other. */
  private withStyle<T>(section: (io: StyleFileIo) => Promise<T>): Promise<T> {
    const run = this.styleQueue.then(() => section(this.styleIo()))
    this.styleQueue = run.then(() => undefined, () => undefined)
    return run
  }

  /** Binding-file IO as injected dependencies, so tests can substitute readers/writers later. */
  private bindingsIo(): BindingsFileIo {
    const path = bindingsPath(homedir())
    return {
      path,
      load: (): Promise<BindingsFile> =>
        loadBindings(async p => readFile(p, 'utf8'), path),
      save: (file: BindingsFile): Promise<void> =>
        saveBindings(async d => { await mkdir(d, { recursive: true }) }, async (p, s) => { await writeFile(p, s, 'utf8') }, async (from, to) => { await rename(from, to) }, path, file),
    }
  }

  /** Tail of the promise chain that serializes binding-file critical sections. */
  private bindingsQueue: Promise<unknown> = Promise.resolve()

  /** Run a load→save critical section to completion before the next one starts (single host
   *  process); a failing section rejects to its caller without breaking the chain. */
  private withBindings<T>(section: (io: BindingsFileIo) => Promise<T>): Promise<T> {
    const run = this.bindingsQueue.then(() => section(this.bindingsIo()))
    this.bindingsQueue = run.then(() => undefined, () => undefined)
    return run
  }

  /** Resolve the repo root for a directory (null when not a git repo). Always forward slashes. */
  private async repoRootOf(cwd: string, signal: AbortSignal): Promise<string | null> {
    const out = await this.git(cwd, ['rev-parse', '--show-toplevel'], signal)
    if (out.exitCode !== 0) return null
    return out.stdout.trim().replace(/\\/g, '/') || null
  }

  /**
   * Spawn `git <args>` in cwd with piped stdio; drains both streams and returns
   * full stdout. Never throws.
   *
   * Every call runs with credential prompting disabled, reads included. stdin is
   * ignored, which does not turn a prompt into an error — it turns it into a
   * wait nobody can end, inside the host process. A read never needs a prompt,
   * so switching them off costs nothing and closes the hang for fetch and push.
   * @param graceMs - override for network operations, which wait on a remote
   *                  rather than on the disk.
   */
  private async git(cwd: string, argv: readonly string[], signal: AbortSignal, graceMs = 30_000): Promise<GitResult> {
    try {
      const handle = this.ctx.subprocess.spawn({
        // core.quotepath=false on EVERY call: with the default on, git octal-
        // escapes non-ASCII paths, which JSON unescaping cannot decode (JSON
        // has no octal escapes) — and status and numstat would then key the
        // same file under different strings, so counts silently vanish and
        // CJK paths render escaped (TESTS.md A12).
        argv: ['git', '-c', 'core.quotepath=false', ...argv],
        cwd,
        stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
        graceMs,
        signal,
        env: { ...NON_INTERACTIVE_ENV },
      })
      const [stdout, stderr, outcome] = await Promise.all([
        readAll(handle.stdout),
        readAll(handle.stderr), // drain so a chatty stderr cannot deadlock the pipe
        handle.done,
      ])
      return { stdout, exitCode: outcome.exitCode ?? 0, stderr: stderr.slice(-300).trim() }
    } catch (error) {
      return { stdout: '', exitCode: 1, stderr: error instanceof Error ? error.message : String(error) }
    }
  }
}

export default GitWorkbenchService

/**
 * Run `task` over every item with at most `limit` of them in flight.
 *
 * @param items - inputs; results come back index-aligned with these.
 * @param limit - how many tasks may run at once.
 * @param task - work to run per item.
 * @returns each item's result, in the input's order.
 */
async function mapPooled<T, R>(items: readonly T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    for (let index = next++; index < items.length; index = next++) {
      results[index] = await task(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/** What every untracked file must report, whether or not its diff ships. */
interface UntrackedMeasure {
  readonly lineCount: number
  readonly binary: boolean
  /** False when the file is missing, binary, or past the per-file byte cap. */
  readonly diffable: boolean
}

/**
 * Count an untracked file's lines and decide whether it is binary.
 *
 * Both answers come off the raw buffer: decoding a megabyte to utf8 only to
 * count newlines is the expensive half of this pass, and most untracked files
 * never reach the bundled diff. Never throws; an unreadable file reports zero
 * lines and nothing to diff.
 * @param cwd - worktree the path is relative to.
 * @param path - repository-relative file path.
 * @returns the file's line count, binary flag, and whether a diff may be built.
 */
async function measureUntracked(cwd: string, path: string): Promise<UntrackedMeasure> {
  let bytes: Buffer
  try {
    bytes = await readFile(join(cwd, path))
  } catch {
    return { lineCount: 0, binary: false, diffable: false }
  }
  if (isBinaryPrefix(bytes, BINARY_SNIFF_BYTES)) return { lineCount: 0, binary: true, diffable: false }
  return {
    lineCount: countBufferLines(bytes),
    binary: false,
    diffable: bytes.length <= UNTRACKED_FILE_BYTE_CAP,
  }
}

/**
 * Synthesize the unified-diff "new file" segment for an untracked file.
 *
 * `git diff --no-index /dev/null <f>` is NOT used: on Windows git resolves
 * `/dev/null` as a repo-relative path. Never throws.
 * @param cwd - worktree the path is relative to.
 * @param path - repository-relative file path.
 * @param byteCap - refuse files larger than this; defaults to the stats
 *                  payload's budget, which `fileSides` raises to its own.
 * @returns the segment, or null when the file is missing, binary, or oversized.
 */
async function untrackedSegment(cwd: string, path: string, byteCap: number = UNTRACKED_FILE_BYTE_CAP): Promise<string | null> {
  let bytes: Buffer
  try {
    bytes = await readFile(join(cwd, path))
  } catch {
    return null
  }
  if (isBinaryPrefix(bytes, BINARY_SNIFF_BYTES)) return null
  if (bytes.length > byteCap) return null
  const lines = countBufferLines(bytes)
  const text = bytes.toString('utf8')
  const body = text.endsWith('\n') ? text.slice(0, -1) : text
  return [
    `diff --git a/${path} b/${path}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${path}`,
    `@@ -0,0 +1,${lines} @@`,
    ...body.split('\n').map(line => `+${line}`),
  ].join('\n')
}

async function readAll(stream: Readable | undefined): Promise<string> {
  if (stream === undefined) return ''
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array))
  return Buffer.concat(chunks).toString('utf8')
}

/** Random hex string for generated worktree names (`wt-<hex>`). */
function randomHex(digits: number): string {
  const bytes = randomBytes(Math.ceil(digits / 2))
  return bytes.toString('hex').slice(0, digits)
}

/**
 * Park patch text where git can read it: a uniquely named file under the OS
 * temp dir, passed to `git apply` as its last argument.
 *
 * `git()` spawns with `stdin: 'ignore'`, so a tmpfile — not a pipe — is how a
 * patch reaches git without changing that helper, and the temp dir keeps patch
 * text (which can be a whole file's worth of context) out of the repository.
 * `apply-blocks.ts` deletes what this wrote from a `finally`, whichever way
 * the apply ended.
 */
async function writeTmpPatch(text: string): Promise<string> {
  const file = join(tmpdir(), `gw-apply-${process.pid}-${randomHex(8)}.patch`)
  await writeFile(file, text, 'utf8')
  return file
}

/** Remove a tmpfile `writeTmpPatch` made; a file already gone is a success. */
async function dropTmpPatch(file: string): Promise<void> {
  await rm(file, { force: true })
}

/** The `fileSides` payload for a file with nothing to show: no diff, no target. */
function emptySides(): FileSides {
  return { diff: '', diffSha: sha1Hex(''), targetText: '', targetSha: '', binary: false, tooLarge: false, lossyEncoding: false }
}

/**
 * Whether a diff git printed says `Binary files … differ` instead of hunks.
 * The line starts at column 0 — inside a hunk every body line carries a
 * marker, so a text file that mentions "Binary files" cannot match.
 */
function binaryDiffOutput(diff: string): boolean {
  return /^Binary files /m.test(diff)
}

function emptyStats(worktreePath: string): WorkbenchStats {
  return {
    worktreePath, branch: '', ahead: 0, behind: 0, detached: false,
    addedLines: 0, deletedLines: 0, addedFiles: 0, deletedFiles: 0, modifiedFiles: 0,
    files: [], diff: '', commits: [],
  }
}

function parseBranch(stdout: string): { ahead: number; behind: number } {
  const header = stdout.split('\n').find(line => line.startsWith('##'))
  if (header === undefined) return { ahead: 0, behind: 0 }
  const ahead = /ahead (\d+)/.exec(header)
  const behind = /behind (\d+)/.exec(header)
  return { ahead: ahead ? Number.parseInt(ahead[1], 10) : 0, behind: behind ? Number.parseInt(behind[1], 10) : 0 }
}

