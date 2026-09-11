/** Shared JSON-safe contracts between the panel, feature views, and RPC adapters. */

export type GitFileStatus = 'added' | 'deleted' | 'modified' | 'renamed' | 'untracked'

export interface GitFile {
  readonly path: string
  readonly status: GitFileStatus
  readonly addedLines: number
  readonly deletedLines: number
  readonly binary: boolean
  readonly previousPath?: string
  /**
   * Which side of the index this file's change is on. Both can be true — a file
   * staged and then edited again. Absent outside the working-tree view: a
   * commit's files were staged long ago and the question is meaningless.
   */
  readonly staged?: boolean
  readonly unstaged?: boolean
}

export interface GitCommit {
  readonly hash: string
  readonly subject: string
  readonly when: string
  /** Everything after the subject. Empty string when the commit has none. */
  readonly body: string
  /** Author name (`%an`). Optional only because a pre-0.1.4 host half sends none. */
  readonly authorName?: string
  /** Committer name (`%cn`); equals the author except on rebases and patches a maintainer applied. */
  readonly committerName?: string
  /** Committer date, strict ISO 8601 (`%cI`) — the exact moment `when` summarizes. */
  readonly dateIso?: string
  /** Abbreviated parent hashes, first parent first — the graph's edges. */
  readonly parents?: readonly string[]
  /** Branch and tag names pointing here, already stripped of git's decoration syntax. */
  readonly refs?: readonly string[]
}

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
  readonly diff: string
  /**
   * Commits this view is about: the single commit for a commit view, the range's
   * commits for a comparison. Empty for the working tree — the history list
   * loads its own pages so it can follow a ref of its own.
   */
  readonly commits: readonly GitCommit[]
  readonly error?: string
}

/** One worktree of the repository, as `git worktree list --porcelain` reports it. */
export interface WorktreeEntry {
  readonly path: string
  readonly head: string
  readonly branch: string
}

/** The session's worktree binding, as persisted by the worktree tools. */
export interface WorktreeBinding {
  readonly repoRoot: string
  readonly worktreePath: string
  readonly name: string
  readonly enteredAt: string
  readonly baseCommit?: string
}

/**
 * `gitWorkbench/worktreeStatus`: the session's binding (null when unbound) plus every
 * worktree of the surrounding repository. Git allows at most one worktree per
 * branch, so this one list is both the worktree picker and the branch picker.
 */
export interface WorktreeStatus {
  readonly binding: WorktreeBinding | null
  readonly worktrees: readonly WorktreeEntry[]
  /**
   * Every local branch, most-recently-committed first. Distinct from
   * {@link worktrees} on purpose: a branch without a worktree has no directory
   * to read, so it can be browsed or compared but not viewed as a working tree.
   */
  readonly branches: readonly string[]
  /** Whether the host cut {@link branches} short at its cap. */
  readonly branchesTruncated: boolean
}

/**
 * `gitWorkbench/syncStatus`: where the current branch stands against its upstream.
 *
 * `upstream: null` and "level with the upstream" are different states and the
 * drawer treats them differently — the first is what makes the first push pass
 * `--set-upstream`, and both otherwise read as zero ahead and zero behind.
 */
export interface SyncStatus {
  readonly branch: string
  readonly upstream: string | null
  readonly ahead: number
  readonly behind: number
  readonly detached: boolean
  /** Whether the repository has any remote at all. No remote, no sync bar. */
  readonly hasRemote: boolean
}

/** Why a write operation failed, in terms the drawer can explain. `stale` is
 *  a sha the host re-derived and refused; `invalid` an argument combination
 *  the host rejected before running anything. */
export type GitOpFailure =
  | 'auth' | 'network' | 'no-upstream' | 'diverged' | 'conflict'
  | 'nothing-to-commit' | 'dirty' | 'stale' | 'invalid' | 'unknown'

export interface GitOpResult {
  readonly ok: boolean
  readonly failure?: GitOpFailure
  /** git's own message on failure. Shown verbatim: a classification is a hint. */
  readonly error?: string
  readonly output?: string
}

/** The host endpoints under `gitWorkbench/` that change something. */
export type GitOpName = 'stage' | 'unstage' | 'commit' | 'fetch' | 'pull' | 'push' | 'discardFile' | 'applyBlocks'

/** Extra arguments an operation needs beyond the worktree path. */
export interface GitOpPayload {
  readonly paths?: readonly string[]
  readonly message?: string
  readonly amend?: boolean
  /** `pull` picks how to integrate; `applyBlocks` which block mutation. One
   *  field serves both because the payload is a flat bag keyed by op — the
   *  host narrows and validates it per endpoint. */
  readonly mode?: 'ff-only' | 'rebase' | 'merge' | BlockMode
  /** `discardFile` and `applyBlocks`, and deliberately singular: the one
   *  irreversible thing the drawer does takes one file per call, so a mistaken
   *  click costs one file. */
  readonly path?: string
  /** `discardFile` only: the effect the confirmation stated. The host refuses
   *  if the file changed underneath the dialog and now means something else. */
  readonly expectedEffect?: string
  /** `applyBlocks` only: the layer whose diff the `diffSha` is over, and the
   *  block's hunk-line indices (`side-rows.blockLines`). The host re-fetches
   *  that layer's diff and refuses unless the sha still matches. */
  readonly layer?: SideLayer
  readonly diffSha?: string
  readonly lines?: readonly number[]
}

export type { DiscardAnswer, DiscardNext, DiscardPreview } from './discard-flow.ts'
export type { WriteResult } from './side-edit.ts'

/** Which side of the index a side-by-side pane shows: `unstaged` is
 *  index→worktree (the editable side), `staged` is HEAD→index (read-only). */
export type SideLayer = 'unstaged' | 'staged'

/** A block mutation the side pane's buttons request: `stage` and `discard` act
 *  on the unstaged layer, `unstage` on the staged one. The host enforces the
 *  same matrix. */
export type BlockMode = 'stage' | 'unstage' | 'discard'

/**
 * What one block action acts on, snapshotted from the diff the pane had
 * rendered when the click (or its confirmation) happened.
 *
 * The snapshot is the point: `diffSha` proves the file has not changed since
 * the pane rendered it, and `lines` — the block's hunk-line indices — only
 * mean anything against exactly that diff. A confirmed roll-back carries the
 * ask it opened with, so the answer cannot drift under the dialog.
 */
export interface BlockAsk {
  readonly path: string
  readonly layer: SideLayer
  readonly diffSha: string
  readonly lines: readonly number[]
  /** The block's line tallies, for the roll-back confirmation's wording. */
  readonly added: number
  readonly deleted: number
  /** Whether the block is the file's entire content — the untracked case,
   *  whose roll-back DELETES the file and whose confirmation says so. */
  readonly wholeFile: boolean
}

/**
 * `gitWorkbench/fileSides`: one layer of one file for the side-by-side pane.
 * Mirrors the host's `FileSides` (the client re-declares host shapes rather
 * than importing the host module, which pulls node and the RPC decorators).
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
  /** True when the working-tree file is not valid UTF-8; the pane shows the
   *  diff but withholds the editor. Optional so an older host half reads as
   *  "fine" rather than as a refusal this client cannot explain. */
  readonly lossyEncoding?: boolean
}

/**
 * `gitWorkbench/fileImage`: one working-tree file's bytes, when the host's
 * signature check confirms they are an image a browser can draw.
 * `gitWorkbench/revImage` answers in the same shape for a blob — the file at
 * a commit, at a ref, or in the index.
 *
 * Every field is present in both outcomes — an image and a refusal — because
 * the gateway's payloads carry no `undefined`. `reason` is '' exactly when
 * `ok`, and names the refusal otherwise: 'notImage', 'tooLarge', 'missing'.
 */
export interface FileImage {
  readonly ok: boolean
  /** MIME type to label the blob with; '' when declined. */
  readonly mime: string
  /** Short label for the caption — 'PNG', 'WebP', 'SVG'; '' when declined. */
  readonly kind: string
  /** The whole file, base64; '' when declined. */
  readonly base64: string
  /** The file's size in bytes, reported either way. */
  readonly bytes: number
  readonly reason: string
}

/** One line's provenance, as `gitWorkbench/blame` reports it. */
export interface BlameLine {
  /** Full commit sha; all zeros for a line not committed yet. */
  readonly hash: string
  readonly author: string
  /** Author time, unix seconds; 0 when git did not say. */
  readonly time: number
  readonly summary: string
  readonly uncommitted: boolean
}

/** `gitWorkbench/blame`'s answer. `error` is present only on failure. */
export interface BlameAnswer {
  readonly lines: readonly BlameLine[]
  /** Whether the file was longer than the gutter's cap. */
  readonly truncated: boolean
  readonly error?: string
}

/** Translate a key of this plugin's namespace, with optional `{name}` params. */
export type Translate = (key: string, params?: Record<string, string | number>) => string
