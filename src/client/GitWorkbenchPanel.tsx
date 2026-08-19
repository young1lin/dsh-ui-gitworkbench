/**
 * Session-header environment card + Codex-style changes drawer.
 *
 * The header shows a compact environment card — branch (or detached-HEAD sha),
 * ahead/behind against upstream, and +adds/−dels/file count. Clicking opens a
 * right-side drawer holding a collapsible DIRECTORY TREE (aggregated
 * per-directory counts, status-badged files with dim-directory paths) and a
 * per-file diff beside it — word-level highlights inside +/- line tints, over a
 * light per-extension syntax pass. Files whose diff did not fit the bundled
 * payload (or untracked files beyond the budget) fetch theirs on demand through
 * `fetchFileDiff`. Binary files and renames get dedicated presentation. Polls
 * every 15s while open.
 *
 * The drawer has three peer tabs. Changes is the working tree. History
 * puts a commit list left of the same tree and diff panes — three peers, each
 * scrolling on its own, which is what GitHub Desktop and the JetBrains git log
 * do; it pages by scroll sentinel rather than by a button. Compare fills
 * those panes from `base...head` between any two branches.
 *
 * A commit hash addresses content that cannot change, so a visited commit is
 * kept and re-shown with neither a round trip nor a loading flash; the working
 * tree is never cached, and selecting a commit does not refetch it.
 *
 * Source: a session is not confined to one worktree. The picker lists every
 * worktree of the repository (git allows at most one per branch, so that list is
 * also the branch list) and opens on the session's own — the bound worktree when
 * the agent entered one, else the session cwd. Expansion/selection state is NOT
 * reset on switch.
 *
 * Shell: the drawer is a card inset from every viewport edge, with a maximize
 * toggle for full bleed. Three edges drag — the card's own leading edge and the
 * dividers between the panes — each clamped so the diff keeps a readable width.
 *
 * Theme: a colour mode plus a palette family ({@link ./themes.ts}). The mode
 * defaults to `system`, which follows dsh's resolved palette
 * (`body[data-ds-dark-theme]`), not the computer's `prefers-color-scheme`.
 * Both, and the dragged widths, are browser-local preferences and live in
 * localStorage.
 *
 * Styling: a background image and a custom stylesheet, each settable for this
 * project or globally with the project winning. Those are NOT browser-local —
 * a project setting belongs to the project, so the host stores them and the
 * panel reads them per source through `fetchStyle`. The stylesheet is injected
 * as a document-level element, which is why `data-gs-part` attributes exist:
 * CSS-module class names are hashed per build and cannot be targeted.
 *
 * All copy resolves through the app's locale runtime (`t`), so the panel follows
 * the user's language preference.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type Dispatch, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type Ref, type SetStateAction } from 'react'
import { createPortal } from 'react-dom'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  COLOR_MODES, DEFAULT_APPEARANCE, EMPTY_SETTINGS, STYLE_BLUR_MAX, STYLE_SCOPES, THEME_FAMILIES,
  DSH_DARK_ATTR, effectiveBackground, effectiveCss, entryFor, hostSchemeDark, isAppearance, resolveTheme, withScope,
  type Appearance, type ColorMode, type StyleEntry, type StyleScope, type StyleSettings, type ThemeFamily,
} from './themes.ts'
import { attachWordRanges, gutterSides, overlayRanges, parseRows, type Row, type RowWithRanges } from './diff-model.ts'
import { parsePatch } from '../patch-model.ts'
import { alignRows, blockIsWholeFile, blockLines, blockTally, sideBodyState, type SideCell, type SideRow } from './side-rows.ts'
import {
  applySaveOk, applySides, armEdit, armRefusal, DISARMED, editableSides, gateLeave, isDirty,
  LEAVE_GUARD_CLEAR, leaveAnswered, leaveAsked, markConflict, paneDirtyReport, reloadSides, resetSides,
  type EditState, type LeaveGuard, type WriteResult,
} from './side-edit.ts'
import { FileBrowser } from './FileBrowser.tsx'
import { NO_PLACE, type FilesPlace } from './files-place.ts'
import { HIGHLIGHT_IDLE_MS, HIGHLIGHT_LINE_CAP, useIdleValue } from './idle-value.ts'
import { PathDirGlyph, PathFileGlyph } from './glyphs.tsx'
import { detectIndent } from './indent.ts'
import { CodeEditor } from './CodeEditor.tsx'
import { layoutGraph, type GraphRow } from './commit-graph.ts'
import { formatCommitDate } from './commit-filter.ts'
import { chipsFromFilter, emptyQueryFilter, parseLogQuery, removeChip, serializeLogQuery } from './log-filter-query.ts'
import { buildDirTree, searchPaths, type DirEntry } from './dir-tree.ts'
import { nextAfterPlan, type DiscardAnswer, type DiscardPreview } from './discard-flow.ts'
import { filterFiles } from './file-filter.ts'
import { addPath, buildIndex, checkedState, isCovered, removePath } from './path-select.ts'
import { inCalRange, localTodayIso, monthGrid, weekdayLabels } from './calendar.ts'
import { NO_PATHS, preferredFile } from './active-file.ts'
import type { LogFilter } from '../log-filter.ts'
import type { AuthorEntry } from '../shortlog.ts'
import {
  fileCheckState, nextAction, nextBatch, pathsFor, rollUp, settledTicks, withPendingTicks,
  type CheckState, type Tick, type TickAction,
} from './stage-tree.ts'
import { grammarLoadCount, highlightFile, highlightForRows, highlightWholeFile, shikiLangOf, shikiThemeOf, subscribeGrammarLoaded, type HighlightRun } from './highlight.ts'
import { badgeRepeatsBranch, bindingChanged, branchOfWorktree, probesClosedBinding, samePath, showsPending, splitPath, turnSettled, viewedPath } from './worktree-view.ts'
import { BUSY_DELAY_MS, BUSY_HOLD_MS, holdRemaining, quietlyDisabled } from './op-feedback.ts'
import type { WorkbenchKey } from './locales.ts'
import css from './GitWorkbenchPanel.module.css'

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

type Props = PropsRuntime<'conversation.session.header.actions'> & {
  readonly t: Translate
  readonly fetchStats: (worktreePath: string | undefined, signal: AbortSignal) => Promise<WorkbenchStats | null>
  readonly fetchFileDiff: (worktreePath: string | undefined, path: string, commit: string | undefined, signal: AbortSignal) => Promise<string>
  /** One layer of one file for the side-by-side diff pane. */
  readonly fetchFileSides: (worktreePath: string | undefined, path: string, layer: SideLayer, signal: AbortSignal) => Promise<FileSides | null>
  /** Save the editor buffer, checked against the sha it opened with. */
  readonly writeChecked: (worktreePath: string | undefined, path: string, text: string, expectedSha: string, signal: AbortSignal) => Promise<WriteResult | null>
  readonly fetchBlame: (worktreePath: string | undefined, path: string, signal: AbortSignal) => Promise<BlameAnswer | null>
  readonly fetchWorktreeStatus: (sessionId: string, repoPath: string | undefined, signal: AbortSignal) => Promise<WorktreeStatus | null>
  /** Binding only, no git — the probe the shut chip can afford to poll. */
  readonly fetchSessionBinding: (sessionId: string, signal: AbortSignal) => Promise<{ worktreePath: string | null; name: string | null } | null>
  readonly fetchCommitStats: (worktreePath: string | undefined, hash: string, signal: AbortSignal) => Promise<WorkbenchStats | null>
  readonly fetchCommits: (worktreePath: string | undefined, ref: string, skip: number, limit: number, filter: LogFilter, signal: AbortSignal) => Promise<{ commits: GitCommit[]; hasMore: boolean; error?: string } | null>
  /** Author roster for the filter popup's user picker, busiest first — for the
   *  ref the history walks, so every listed author actually has commits there. */
  readonly fetchAuthors: (worktreePath: string | undefined, ref: string, signal: AbortSignal) => Promise<{ authors: readonly AuthorEntry[]; truncated: boolean } | null>
  /** Every path on HEAD — the path picker's raw material. */
  readonly fetchRepoTree: (worktreePath: string | undefined, signal: AbortSignal) => Promise<{ paths: string[]; truncated: boolean } | null>
  readonly fetchCompare: (worktreePath: string | undefined, base: string, head: string, signal: AbortSignal) => Promise<WorkbenchStats | null>
  readonly fetchStyle: (worktreePath: string | undefined, signal: AbortSignal) => Promise<StyleSettings | null>
  readonly saveStyle: (worktreePath: string | undefined, scope: StyleScope, entry: StyleEntry, signal: AbortSignal) => Promise<{ ok: boolean; error?: string }>
  readonly fetchSync: (worktreePath: string | undefined, signal: AbortSignal) => Promise<SyncStatus | null>
  readonly runGitOp: (op: GitOpName, worktreePath: string | undefined, payload: GitOpPayload, signal: AbortSignal) => Promise<GitOpResult>
  /** What rolling this file back WOULD do, read fresh so the confirmation
   *  states the real consequence rather than one derived from a polled row. */
  readonly fetchDiscardPlan: (worktreePath: string | undefined, path: string, signal: AbortSignal) => Promise<DiscardAnswer>
}

/**
 * Drawer tab. `changes` is the working tree, `history` a commit picked from the
 * log, `compare` two refs diffed against each other — peer surfaces rather than
 * modes with a back action, so returning to the working tree is always one click
 * (the pattern GitHub Desktop, VS Code and the JetBrains git tooling converge on).
 */
type Tab = 'changes' | 'history' | 'compare' | 'files'

/** How many further commits one page request loads. */
const HISTORY_PAGE = 30

/** Narrowest the drawer may be dragged: three panes at their minimums, plus a
 *  diff column still wide enough to read code in. */
const MIN_DRAWER_WIDTH = 760
/** Pane minimums. The diff's is enforced against the drawer rather than on the
 *  pane itself: it is the pane with no fallback, since code cannot reflow. */
const MIN_COMMITS_WIDTH = 190
const MIN_TREE_WIDTH = 170
const MIN_DIFF_WIDTH = 300

/** Longest edge a chosen background image is resampled to before storage. Past
 *  this the file grows fast while a blurred backdrop gains nothing. */
const IMAGE_MAX_EDGE = 2560
/** JPEG quality for that resample. */
const IMAGE_QUALITY = 0.82
/** Refuse an image whose encoded data URL exceeds this; matches the host's cap. */
const IMAGE_MAX_BYTES = 3_000_000

/** Element carrying the user's custom stylesheet. One per document. */
const CUSTOM_STYLE_ID = 'dsh-ui-gitworkbench-custom-css'

/** localStorage keys. Namespaced, since the whole app shares one origin.
 *  Layout and palette live here; the background image and custom CSS do not —
 *  they are per-project state the host owns, see `styleGet`/`styleSet`. */
const STORE_APPEARANCE = 'dsh-ui-gitworkbench:appearance'
const STORE_WIDTH = 'dsh-ui-gitworkbench:width'
const STORE_PANES = 'dsh-ui-gitworkbench:panes'

/** Dragged pane widths in px; null on either side keeps that pane's CSS default. */
interface PaneWidths {
  readonly commits: number | null
  readonly tree: number | null
}

const DEFAULT_PANES: PaneWidths = { commits: null, tree: null }

/**
 * @param value - value read back from storage.
 * @returns whether it is a pane-width pair this build can use.
 */
function isPaneWidths(value: unknown): value is PaneWidths {
  if (typeof value !== 'object' || value === null) return false
  const { commits, tree } = value as Partial<PaneWidths>
  const ok = (v: unknown): boolean => v === null || (typeof v === 'number' && Number.isFinite(v))
  return ok(commits) && ok(tree)
}

/**
 * Read a persisted preference.
 *
 * Storage is a durable boundary holding values an older build wrote, so every
 * read is validated and anything unrecognized falls back rather than propagating.
 * @param key - storage key.
 * @param accept - narrows a parsed value to the expected type.
 * @param fallback - used when the key is absent, unparsable, or rejected.
 * @returns the stored value, or the fallback.
 */
function readStored<T>(key: string, accept: (value: unknown) => value is T, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    const parsed: unknown = JSON.parse(raw)
    return accept(parsed) ? parsed : fallback
  } catch {
    // Storage can be disabled outright, and a half-written value can fail to
    // parse; a preference is never worth failing a render over.
    return fallback
  }
}

/**
 * Persist a preference, ignoring a storage that refuses writes.
 * @param key - storage key.
 * @param value - JSON-serializable value.
 */
function writeStored(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Private mode and a full quota both throw here. The session keeps the
    // choice in memory; only its durability is lost.
  }
}

/**
 * One pointer-captured horizontal drag, shared by the drawer's leading edge and
 * both pane dividers.
 *
 * Pointer capture is what keeps a drag alive over every pane and past the window
 * edge; a plain mousemove listener on the handle loses it as soon as the pointer
 * crosses a child that stops propagation.
 * @returns the active flag for styling, and the pointerdown handler to attach.
 */
function useHorizontalDrag(): {
  dragging: boolean
  start: (event: ReactPointerEvent<HTMLElement>, onDrag: (clientX: number, done: boolean) => void) => void
} {
  const [dragging, setDragging] = useState(false)
  const start = (event: ReactPointerEvent<HTMLElement>, onDrag: (clientX: number, done: boolean) => void): void => {
    event.preventDefault()
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    setDragging(true)
    const onMove = (move: PointerEvent): void => { onDrag(move.clientX, false) }
    // `pointercancel` ends a drag the browser took over (a touch became a
    // gesture, the window lost focus). It releases capture itself, so only the
    // pointerup path releases — and both must detach, or the next drag stacks a
    // second set of listeners on the same handle.
    const finish = (end: PointerEvent): void => {
      if (end.type === 'pointerup') {
        onDrag(end.clientX, true)
        handle.releasePointerCapture(end.pointerId)
      }
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', finish)
      handle.removeEventListener('pointercancel', finish)
      setDragging(false)
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', finish)
    handle.addEventListener('pointercancel', finish)
  }
  return { dragging, start }
}

/**
 * Drag handle between two panes.
 * @param label - accessible name.
 * @param onDrag - receives the pointer's x and whether the drag just ended.
 * @returns the divider element.
 */
function PaneDivider({ label, onDrag }: {
  label: string
  onDrag: (clientX: number, done: boolean) => void
}): ReactNode {
  const { dragging, start } = useHorizontalDrag()
  return (
    <div
      className={dragging ? `${css.paneDivider} ${css.paneDividerActive}` : css.paneDivider}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      onPointerDown={event => start(event, onDrag)}
    />
  )
}

/** How narrow either side-by-side column may be dragged. A column pulled to
 *  nothing reads as a broken pane, and nothing on screen offers to pull it
 *  back out. */
const SPLIT_MIN = 0.15
const SPLIT_MAX = 0.85

/** Commit change sets kept in the browser before the least recently used is dropped. */
const COMMIT_CACHE_CAPACITY = 24

/** Stand-in while a commit's change set is in flight — every pane renders empty. */
const EMPTY_STATS: WorkbenchStats = {
  worktreePath: '', branch: '', ahead: 0, behind: 0, detached: false,
  addedLines: 0, deletedLines: 0, addedFiles: 0, deletedFiles: 0, modifiedFiles: 0,
  files: [], diff: '', commits: [],
}

/** The overlay with nothing on it — one instance, so an empty overlay never
 *  re-renders the tree that receives it. */
const EMPTY_TICKS: ReadonlyMap<string, TickAction> = new Map()

/** How often a queued tick batch re-checks whether a heavy operation has
 *  released the git lock. Short: ticks are clicks someone is watching. */
const TICK_RETRY_MS = 25

/** How often the shut chip re-reads the session's binding while the agent is
 *  running. Matched to the open drawer's busy rate — the probe is a JSON read
 *  with no git behind it, so the cost that set the 15s idle rate is absent. */
const BINDING_PROBE_MS = 3_000

/**
 * Pick the ref a comparison starts from.
 *
 * The integration branch is what one almost always compares against, so it wins
 * when it exists and is not already the other side; otherwise any other branch
 * beats an empty picker.
 * @param branches - the repository's local branches.
 * @param head - the ref being compared, which must not also be the base.
 * @returns the default base ref, or an empty string when there is no candidate.
 */
function defaultBase(branches: readonly string[], head: string): string {
  for (const preferred of ['main', 'master']) {
    if (branches.includes(preferred) && preferred !== head) return preferred
  }
  return branches.find(branch => branch !== head) ?? ''
}

const STATUS_BADGE: Record<GitFileStatus, string> = {
  added: css.stAdded, untracked: css.stUntracked, modified: css.stModified,
  renamed: css.stRenamed, deleted: css.stDeleted,
}

export function GitWorkbenchPanel({ sessionId, useSessions, t, fetchStats, fetchFileDiff, fetchFileSides, writeChecked, fetchBlame, fetchWorktreeStatus, fetchSessionBinding, fetchCommitStats, fetchCommits, fetchAuthors, fetchRepoTree, fetchCompare, fetchStyle, saveStyle, fetchSync, runGitOp, fetchDiscardPlan }: Props) {
  const worktreePath = useSessions((state: { byId?: Record<string, { cwd?: string } | undefined> }) =>
    state?.byId?.[sessionId]?.cwd) as string | undefined
  /** Whether the session's agent has a turn in flight — the store mirrors it
   *  live, so it is the signal for polling faster while there is something to
   *  watch (the agent may be staging, committing, or entering worktrees). */
  const agentRunning = useSessions((state: { byId?: Record<string, { running?: boolean } | undefined> }) =>
    state?.byId?.[sessionId]?.running) as boolean | undefined

  const [stats, setStats] = useState<WorkbenchStats | null>(null)
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  /** Generation counter — bumped on drawer open, manual refresh and source switch:
   *  the events after which working-tree content can genuinely differ. Tab and
   *  commit selection do NOT bump it (they change which view is shown, not the
   *  working tree), and background polls never touch it. */
  const [gen, setGen] = useState(0)
  /** Tree expansion state, session-lifetime: survives polls, source switches and drawer close/reopen. */
  const [collapsed, setCollapsed] = useState<Set<string> | undefined>(undefined)
  // The Files tab's place and its last file list. Held here rather than in the
  // browser because the browser unmounts whenever another tab is looked at:
  // without this, coming back lost the selection and every expanded folder,
  // which is the difference between a tab you return to and one you start
  // over in. The cached list is what makes the return render instead of blank.
  const [filesPlace, setFilesPlace] = useState<FilesPlace>(NO_PLACE)
  const [filesTree, setFilesTree] = useState<{ paths: readonly string[]; truncated: boolean }>(
    () => ({ paths: [], truncated: false }),
  )
  /** Binding + the repository's worktrees, null until the first successful fetch. */
  const [wtStatus, setWtStatus] = useState<WorktreeStatus | null>(null)
  /** Worktree the drawer reads, by absolute path. null = follow the session's own
   *  (the bound worktree when one exists, else the session cwd); reset on open. */
  const [sourcePath, setSourcePath] = useState<string | null>(null)
  /** Active drawer tab; the drawer always opens on the working tree. */
  const [tab, setTab] = useState<Tab>('changes')
  /** Commit selected in the history tab; null until one is picked. */
  const [commitHash, setCommitHash] = useState<string | null>(null)
  /** That commit's change set, or null while its fetch is in flight. */
  const [commitStats, setCommitStats] = useState<WorkbenchStats | null>(null)
  /**
   * Change sets already fetched, keyed by worktree + hash. A commit hash
   * addresses content that cannot change, so a hit is served with no round trip
   * AND without the null pass that blanks the panes — re-selecting a commit is
   * immediate rather than a second loading flash. Bounded; a Map's insertion
   * order is its recency order.
   */
  const commitCache = useRef(new Map<string, WorkbenchStats>())
  /** Ref the history tab walks; null follows the active worktree's own branch.
   *  A branch needs no worktree to have a log, so this is how a branch that is
   *  checked out nowhere still becomes browsable. */
  const [historyRef, setHistoryRef] = useState<string | null>(null)
  /** Every history page loaded for the current worktree + ref. */
  const [historyCommits, setHistoryCommits] = useState<readonly GitCommit[]>([])
  const [historyHasMore, setHistoryHasMore] = useState(false)
  /** First page of the history list in flight — the pane says "loading", not
   *  "no commit history", which is a claim about the repository. */
  const [historyLoading, setHistoryLoading] = useState(false)
  /** Why the history list is empty when it is git's word, not the log's: a
   *  bad filter pattern or date, with the stderr tail to say so. */
  const [historyError, setHistoryError] = useState<string | null>(null)
  /** The history filter box's raw text. Parsed into the LogFilter the host
   *  compiles into git log arguments — the funnel popup writes here too: one
   *  grammar, one filter, however the criterion arrived. */
  const [historyQuery, setHistoryQuery] = useState('')
  const historyFilterKey = serializeLogQuery(parseLogQuery(historyQuery))
  /** Debounced by KEY, not by text: "liam " and "liam" are the same query and
   *  must not refetch. 300ms is a keystroke's pause, not a page's wait. */
  const [liveFilterKey, setLiveFilterKey] = useState('')
  useEffect(() => {
    const id = window.setTimeout(() => setLiveFilterKey(historyFilterKey), 300)
    return () => window.clearTimeout(id)
  }, [historyFilterKey])
  const liveFilter = useMemo(
    () => (liveFilterKey.length === 0 ? emptyQueryFilter() : parseLogQuery(liveFilterKey)),
    [liveFilterKey],
  )
  const [loadingMore, setLoadingMore] = useState(false)
  /** In-flight marker for paging, read synchronously — see {@link loadMoreCommits}. */
  const loadingRef = useRef(false)
  /** Drawer occupies the whole viewport. Panel-level state, so the choice holds
   *  across tab switches and reopens rather than resetting under the user. */
  const [maximized, setMaximized] = useState(false)
  /** Dragged width in px; null keeps the responsive default. */
  const [width, setWidth] = useState<number | null>(
    () => readStored(STORE_WIDTH, (value): value is number => typeof value === 'number' && Number.isFinite(value), null as number | null),
  )
  const [mode, setMode] = useState<ColorMode>(
    () => readStored(STORE_APPEARANCE, isAppearance, DEFAULT_APPEARANCE).mode,
  )
  const [family, setFamily] = useState<ThemeFamily>(
    () => readStored(STORE_APPEARANCE, isAppearance, DEFAULT_APPEARANCE).family,
  )
  /** Dragged pane widths, persisted so a layout survives a reload. */
  const [panes, setPanes] = useState<PaneWidths>(
    () => readStored(STORE_PANES, isPaneWidths, DEFAULT_PANES),
  )
  /** Per-project and global styling; both scopes, unresolved. */
  const [style, setStyle] = useState<StyleSettings>(EMPTY_SETTINGS)
  /** Whether dsh's resolved palette is currently dark. */
  const [hostDark, setHostDark] = useState(
    () => typeof document !== 'undefined' && hostSchemeDark(document.body),
  )

  // dsh can flip light/dark from Settings without remounting this panel, so
  // watch the attribute ThemePresenter toggles. A one-time read would leave
  // the drawer stranded in whichever scheme it happened to mount in.
  useEffect(() => {
    const sync = (): void => { setHostDark(hostSchemeDark(document.body)) }
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.body, { attributes: true, attributeFilter: [DSH_DARK_ATTR] })
    return () => observer.disconnect()
  }, [])
  /** Compare tab refs; null follows the computed default rather than pinning one,
   *  so switching worktree moves the comparison with it. */
  const [compareBase, setCompareBase] = useState<string | null>(null)
  const [compareHead, setCompareHead] = useState<string | null>(null)
  /** The comparison's change set, or null while its fetch is in flight. */
  const [compareStats, setCompareStats] = useState<WorkbenchStats | null>(null)
  /** Divergence from the upstream; null until the first read, or outside a repo. */
  const [sync, setSync] = useState<SyncStatus | null>(null)
  /** The write operation currently running, or null. One at a time on purpose:
   *  git takes an index lock, so a second concurrent op fails on the lock rather
   *  than queueing, and a disabled button explains that better than an error. */
  const [busy, setBusy] = useState<GitOpName | null>(null)
  /** Outcome of the last write operation, shown until the next one starts. */
  const [opResult, setOpResult] = useState<{ op: GitOpName; result: GitOpResult } | null>(null)
  /** Ticks clicked but not yet confirmed by a payload — the optimistic layer
   *  between a click and the git call it queues. Keyed by path; the newest
   *  click for a path wins. */
  const [pendingTicks, setPendingTicks] = useState<ReadonlyMap<string, TickAction>>(EMPTY_TICKS)
  /** Clicks waiting for their git call, in the order they arrived. */
  const tickQueueRef = useRef<readonly Tick[]>([])
  /** Whether a drain loop is running — one at a time, so ticks queue up behind
   *  a batch in flight instead of racing it for the git lock. */
  const drainingRef = useRef(false)
  /** Bumped when the drawer's source changes: ticks belong to the worktree
   *  they were clicked in, and a loop started under one source must not run
   *  batches queued under the next. */
  const tickEpochRef = useRef(0)
  /** The newest render's drain loop. A loop outlives the render it started
   *  in; everything it must see fresh it reads through a ref, and this is how
   *  a retired loop hands the queue to a current one. */
  const drainRef = useRef((): Promise<void> => Promise.resolve())
  /** The git lock, as a ref. `busy` above is state and stays for display; a
   *  drain loop issuing calls from one long-lived closure would never see a
   *  state value change under it. */
  const busyRef = useRef<GitOpName | null>(null)
  /**
   * The commit message being written, and whether it amends.
   *
   * Held here rather than in the commit box, because the box unmounts whenever
   * the drawer leaves the Changes tab — a glance at the history would otherwise
   * throw away a message the user had already typed, with no way to get it back.
   */
  const [commitDraft, setCommitDraft] = useState('')
  const [commitAmend, setCommitAmend] = useState(false)

  const binding = wtStatus?.binding ?? null
  const worktrees = wtStatus?.worktrees ?? []
  const branches = wtStatus?.branches ?? []
  const branchesTruncated = wtStatus?.branchesTruncated ?? false
  /** Branches that have a worktree — what the pickers group to the top. */
  const worktreeBranches = worktrees.map(entry => entry.branch).filter(branch => branch.length > 0)
  /** The session's own worktree: the bound one, else its cwd. The default view. */
  const sessionPath = binding?.worktreePath ?? worktreePath
  /** What everything here is about. The drawer's pin only counts while the
   *  drawer is open — see {@link viewedPath} for why that is a rule and not a
   *  reset in the close handler. */
  const statsPath = viewedPath(open, sourcePath, sessionPath)
  /** The latest `statsPath`, readable by a response that started under an older
   *  one. The 15s poll's in-flight fetch survives a source switch (clearing the
   *  interval does not abort it), and without this check it would repaint the
   *  tree with the worktree the user just left. */
  const statsPathRef = useRef(statsPath)
  statsPathRef.current = statsPath
  /** Whether the KEYED stats fetch (source switch, refresh, open) is in flight.
   *  The tree must say "loading", not render the empty placeholder as "no
   *  changes" — those are different sentences and the wrong one reads as data. */
  const [statsLoading, setStatsLoading] = useState(true)

  // Binding and worktree list keep up with the agent's enter/exit and with
  // worktrees created outside dsh: mount + every drawer open/close.
  useEffect(() => {
    const ctrl = new AbortController()
    fetchWorktreeStatus(sessionId, worktreePath, ctrl.signal)
      .then(value => { if (value !== null) setWtStatus(value) })
      .catch(() => {})
    return () => ctrl.abort()
  }, [sessionId, worktreePath, fetchWorktreeStatus, open])

  /** The binding on screen, readable by a probe loop that outlives its render.
   *  The full status arrives on a timer, so a loop that closed over one would
   *  keep comparing the probe against whatever was true when it started. */
  const wtStatusRef = useRef(wtStatus)
  wtStatusRef.current = wtStatus

  /**
   * Keep the SHUT chip's binding honest while the agent works.
   *
   * The effect above is the only thing that reads the binding, and none of its
   * deps move when `worktree_enter` runs: dsh's `session.header.cwd` is
   * immutable, so the sessions store says nothing, and the 3-15s poll below
   * starts at `if (!open) return`. The chip therefore sat on `main` after the
   * agent had entered a worktree until someone opened the drawer — the one act
   * that flips `open` — which is exactly the wrong thing for an indicator to do.
   *
   * What runs here is a probe, not a fetch: `sessionWorktree` reads the bindings
   * JSON and spawns no git, so the quiet case costs one file read. Only when it
   * disagrees with the chip does one full `worktreeStatus` follow, and that one
   * brings the worktree list and branches the badge and picker need.
   *
   * The window is narrow by construction ({@link probesClosedBinding}): a
   * binding moves only inside a turn, and this panel is mounted in every session
   * header, so an idle session opens no timer at all. The unconditional probe on
   * entry is the backstop for a turn shorter than one interval — the deps carry
   * `agentRunning`, so the end of every turn re-runs this and asks once.
   */
  useEffect(() => {
    if (open) return
    let alive = true
    const probe = (): void => {
      // Nothing to disagree with until the first full status has landed; the
      // mount fetch above is still in flight and will answer this itself.
      if (wtStatusRef.current === null) return
      const ctrl = new AbortController()
      fetchSessionBinding(sessionId, ctrl.signal)
        .then(value => {
          if (!alive || value === null) return
          if (!bindingChanged(value, wtStatusRef.current?.binding ?? null)) return
          const full = new AbortController()
          fetchWorktreeStatus(sessionId, worktreePath, full.signal)
            .then(status => { if (alive && status !== null) setWtStatus(status) })
            .catch(() => {})
        })
        .catch(() => {})
    }
    probe()
    if (!probesClosedBinding(open, agentRunning)) return () => { alive = false }
    const id = setInterval(probe, BINDING_PROBE_MS)
    return () => { alive = false; clearInterval(id) }
  }, [open, agentRunning, sessionId, worktreePath, fetchSessionBinding, fetchWorktreeStatus])

  /** The agent's `running` on the previous render. The flag itself says
   *  whether a turn is in flight; only the EDGE of it says the turn has
   *  ended, and the edge is what the effect below keys on. */
  const wasRunningRef = useRef<boolean | undefined>(undefined)

  /**
   * Refresh the SHUT chip's stats when a turn ends.
   *
   * The keyed fetch below runs on mount, on source switches and on gen bumps,
   * and the 3-15s poll starts at `if (!open) return` — so while the drawer was
   * shut, an agent that wrote files all turn left the header counting the tree
   * as it stood before the turn. Opening the drawer was the only thing that
   * refreshed it, and an indicator you must open to read is not an indicator.
   *
   * `running` is mirrored live by the sessions store, and a turn boundary is
   * when agent-caused side effects have settled ({@link turnSettled}), so one
   * fetch per turn buys the chip the numbers the turn just made true — ahead
   * counts included, which ride along in the same payload. The write follows
   * the poll's discipline exactly: guarded on the source so a retired worktree
   * cannot repaint the tree, touching neither `gen` (which would reset tree
   * expansion) nor `statsLoading` (which would swap the header totals for a
   * `—` while a good answer is still on screen).
   *
   * An open drawer skips it — the poll is running there and the open itself
   * bumped gen. Like the probe's full refetch above, the fetch is left to land
   * guarded rather than aborted: a cleanup fired for an unrelated dep (the
   * drawer opening mid-flight) must not cancel the only fetch this turn gets.
   */
  useEffect(() => {
    const settled = turnSettled(wasRunningRef.current, agentRunning)
    wasRunningRef.current = agentRunning
    if (!settled || open) return
    fetchStats(statsPath, new AbortController().signal)
      .then(value => { if (value !== null && statsPathRef.current === statsPath) setStats(value) })
      .catch(() => {})
  }, [agentRunning, open, statsPath, fetchStats])

  // Stats for the active source: on mount, on source change and on gen bumps
  // (manual refresh / source switch). Cleanup aborts a superseded in-flight fetch.
  useEffect(() => {
    const ctrl = new AbortController()
    let alive = true
    setStatsLoading(true)
    fetchStats(statsPath, ctrl.signal)
      .then(value => {
        if (!alive) return
        setStatsLoading(false)
        if (value !== null && statsPathRef.current === statsPath) setStats(value)
      })
      .catch(() => { if (alive) setStatsLoading(false) })
    return () => { alive = false; ctrl.abort() }
  }, [statsPath, fetchStats, gen])

  // Divergence from the upstream, refetched with the stats. Cheap (two git
  // reads, no diff), and it has to move in step with the file list: committing
  // changes both, and a stale ahead count beside a fresh tree is worse than none.
  useEffect(() => {
    if (!open) return
    const ctrl = new AbortController()
    fetchSync(statsPath, ctrl.signal).then(value => { if (value !== null) setSync(value) }).catch(() => {})
    return () => ctrl.abort()
  }, [statsPath, fetchSync, gen, open])

  // Styling follows the source, since the project scope is keyed by repository:
  // switching to a worktree of another repo must bring that repo's background.
  // Not polled — nothing else writes this file while the drawer is open.
  useEffect(() => {
    const ctrl = new AbortController()
    fetchStyle(statsPath, ctrl.signal).then(value => { if (value !== null) setStyle(value) }).catch(() => {})
    return () => ctrl.abort()
  }, [statsPath, fetchStyle, open])

  const background = effectiveBackground(style)
  const customCss = effectiveCss(style)

  // The custom stylesheet is a document-level element rather than a <style> in
  // the tree: it must be able to reach the overlay, which React portals aside,
  // and it has to survive the drawer closing so a reopen does not reflow.
  useEffect(() => {
    if (customCss.length === 0) {
      document.getElementById(CUSTOM_STYLE_ID)?.remove()
      return
    }
    let element = document.getElementById(CUSTOM_STYLE_ID)
    if (element === null) {
      element = document.createElement('style')
      element.id = CUSTOM_STYLE_ID
      document.head.append(element)
    }
    element.textContent = customCss
  }, [customCss])

  // Background poll. A working tree changes under the plugin's feet — an editor
  // saves, a build writes, another shell commits — and none of that reaches the
  // session log, so it cannot be pushed and freshness is bought with polling.
  // (dsh does offer a push channel, `ctx.sessionProjections`, but a projection
  // is a fold over committed session events, which is a different question from
  // "what does `git status` say".) Two rates: while the session's agent is
  // running it may stage, commit or enter worktrees at any moment, and a drawer
  // that claims to show the working tree should keep up with it; idle, 15s is
  // plenty. The stats write is guarded so an in-flight response from a retired
  // source can never repaint the tree.
  const pollMs = agentRunning === true ? 3_000 : 15_000
  useEffect(() => {
    if (!open) return
    const id = setInterval(() => {
      const ctrl = new AbortController()
      fetchStats(statsPath, ctrl.signal)
        .then(value => { if (value !== null && statsPathRef.current === statsPath) setStats(value) })
        .catch(() => {})
      const bctrl = new AbortController()
      fetchWorktreeStatus(sessionId, worktreePath, bctrl.signal).then(value => { if (value !== null) setWtStatus(value) }).catch(() => {})
    }, pollMs)
    return () => clearInterval(id)
  }, [open, pollMs, statsPath, fetchStats, sessionId, worktreePath, fetchWorktreeStatus])

  /** Ref the history list actually walks. Empty asks the host for the worktree's
   *  own HEAD, which is right for a detached checkout too. */
  const effectiveHistoryRef = historyRef ?? stats?.branch ?? ''

  /** The worktree list, readable by the switch effect below without joining its
   *  deps. The poll hands back a fresh array every 3-15s, so a dependency here
   *  would blank the tree on a timer. */
  const worktreesRef = useRef(worktrees)
  worktreesRef.current = worktrees

  // A source switch drops everything that names the worktree the user just
  // left: the ref override, the selection, the divergence, and the file list
  // itself. The list is the one correctness rides on — until the new stats land
  // there is no tree to trust, and a tick clicked in that window would hand
  // paths from the old worktree to `git` in the new one ("pathspec did not
  // match any file(s)"). The placeholder keeps `stats` non-null on purpose: the
  // panel renders nothing at all when it is null, and unmounting the drawer
  // mid-switch would be a bigger disruption than the blank tree.
  //
  // The branch, though, is already known: it came with the worktree list the
  // user just picked from. Leaving it empty made the header claim `(no branch)`
  // for the length of a `git status` — not a slower answer but a wrong one, and
  // on a large repository it sat there for seconds.
  useEffect(() => {
    setHistoryRef(null)
    setSelected(null)
    // The old worktree's ahead/behind would otherwise ride out the switch above
    // a file list that has already been emptied.
    setSync(null)
    // Ticks belong to the worktree they were clicked in. The queue goes with
    // them; the epoch bump retires any drain loop still working through it, so
    // a queued batch can never run `git add` in the worktree the user just
    // left — the pathspec error the switch effect above already guards the
    // click itself against.
    tickQueueRef.current = []
    tickEpochRef.current += 1
    setPendingTicks(EMPTY_TICKS)
    setStats({
      ...EMPTY_STATS,
      // No source pinned and no session binding yet: the empty path is what
      // EMPTY_STATS already means by "nowhere", not a missing value.
      worktreePath: statsPath ?? '',
      branch: branchOfWorktree(statsPath, worktreesRef.current) ?? '',
    })
  }, [statsPath])

  // Follow the agent across worktree_enter/exit. When the session's binding
  // moves, the work the drawer exists to show moved with it — a drawer still
  // pointed at the worktree the session just left is describing the past, and
  // the reader has no way to know without clicking the chip themselves. A
  // source the user pinned to some THIRD worktree is a deliberate choice and
  // survives; only the view of the place the session used to be follows.
  const bindingPath = binding?.worktreePath ?? null
  const lastBindingRef = useRef(bindingPath)
  useEffect(() => {
    const prevBinding = lastBindingRef.current
    lastBindingRef.current = bindingPath
    if (prevBinding === bindingPath) return
    const prevSource = prevBinding ?? worktreePath ?? null
    if (sourcePath !== null && prevSource !== null && prevSource.replace(/\\/g, '/') === sourcePath.replace(/\\/g, '/')) {
      setSourcePath(null)
    }
  }, [bindingPath, sourcePath, worktreePath])

  // First page of the history list, reloaded whenever the worktree or the ref
  // changes. The selection is dropped with it — a hash from another ref's log
  // has no place in this one.
  //
  // Gated on the drawer being open: this panel is mounted in every session
  // header, and a log nobody is looking at is a git spawn nobody asked for.
  useEffect(() => {
    if (!open) return
    const ctrl = new AbortController()
    let alive = true
    setHistoryCommits([])
    setHistoryHasMore(false)
    setCommitHash(null)
    setCommitStats(null)
    setHistoryLoading(true)
    setHistoryError(null)
    fetchCommits(statsPath, effectiveHistoryRef, 0, HISTORY_PAGE, liveFilter, ctrl.signal)
      .then(page => {
        if (!alive) return
        setHistoryLoading(false)
        if (page === null) return
        setHistoryCommits(page.commits)
        setHistoryHasMore(page.hasMore)
        setHistoryError(page.error ?? null)
      })
      .catch(() => { if (alive) setHistoryLoading(false) })
    return () => { alive = false; ctrl.abort() }
  }, [open, statsPath, effectiveHistoryRef, fetchCommits, gen, liveFilter])

  // Never leave the history pane empty: with a list loaded and nothing picked,
  // the newest commit is the selection.
  useEffect(() => {
    if (tab !== 'history' || commitHash !== null) return
    const newest = historyCommits[0]
    if (newest !== undefined) setCommitHash(newest.hash)
  }, [tab, commitHash, historyCommits])

  useEffect(() => {
    if (commitHash === null) return
    const key = `${statsPath ?? ''}\x1f${commitHash}`
    const hit = commitCache.current.get(key)
    if (hit !== undefined) { setCommitStats(hit); return }
    const ctrl = new AbortController()
    setCommitStats(null)
    fetchCommitStats(statsPath, commitHash, ctrl.signal)
      .then(value => {
        if (value === null) return
        const cache = commitCache.current
        cache.delete(key)
        cache.set(key, value)
        if (cache.size > COMMIT_CACHE_CAPACITY) {
          const oldest = cache.keys().next()
          if (!oldest.done) cache.delete(oldest.value)
        }
        setCommitStats(value)
      })
      .catch(() => {})
    return () => ctrl.abort()
  }, [commitHash, statsPath, fetchCommitStats])

  /** Refs the compare tab reads. An explicit pick wins; otherwise the session's
   *  own branch is compared against the integration branch. */
  const headRef = compareHead ?? stats?.branch ?? ''
  const baseRef = compareBase ?? defaultBase(branches, headRef)
  /** A comparison needs two distinct, named refs; anything else has nothing to show. */
  const comparable = baseRef.length > 0 && headRef.length > 0 && baseRef !== headRef

  useEffect(() => {
    if (tab !== 'compare' || !comparable) return
    const ctrl = new AbortController()
    setCompareStats(null)
    fetchCompare(statsPath, baseRef, headRef, ctrl.signal)
      .then(value => { if (value !== null) setCompareStats(value) })
      .catch(() => {})
    return () => ctrl.abort()
  }, [tab, comparable, baseRef, headRef, statsPath, fetchCompare])

  // A tick stays on the overlay only until a payload confirms it. The first
  // fetch after the git call is exactly that confirmation; without this the
  // optimistic layer would sit over the real flags forever. The functional
  // update keeps an all-settled payload from re-rendering the tree for nothing.
  useEffect(() => {
    setPendingTicks(prev => {
      if (prev.size === 0) return prev
      const settled = settledTicks(stats?.files ?? [], prev)
      if (settled.size === 0) return prev
      const next = new Map(prev)
      for (const path of settled.keys()) next.delete(path)
      return next
    })
  }, [stats?.files])

  /** What the drawer's tree, diff and totals describe. */
  const shown = tab === 'history' ? commitStats : tab === 'compare' ? compareStats : stats
  const segments = useMemo(() => splitDiff(shown?.diff ?? ''), [shown?.diff])
  /** Names the view the per-file diff cache belongs to: one path means different
   *  content in the working tree, in each commit, and in each comparison. */
  const viewKey = tab === 'history'
    ? `commit:${commitHash ?? ''}`
    : tab === 'compare' ? `compare:${baseRef}...${headRef}` : 'worktree'
  /** Per-file diff fetcher bound to the active view. Stable per view, so the
   *  drawer's on-demand effect stops re-running on every render. */
  const fetchDiffForView = useCallback(
    (path: string, signal: AbortSignal): Promise<string> => {
      // A comparison's per-file diff would need the ref range, which `fileDiff`
      // does not take. Answering with the working tree's diff for that path
      // would be plainly wrong, so a file past the payload cap simply has no
      // detail on this tab.
      if (tab === 'compare') return Promise.resolve('')
      return fetchFileDiff(statsPath, path, tab === 'history' ? commitHash ?? undefined : undefined, signal)
    },
    [fetchFileDiff, statsPath, tab, commitHash],
  )

  // First stats fetch still in flight: render nothing. The cheap binding RPC
  // often resolves before the heavy stats one — without this guard a persisted
  // binding would paint the chip with stats === null and crash EnvCard.
  if (stats === null) return null

  // Chip discipline: the environment card is the session's branch indicator —
  // it renders whenever the directory is a git repo, clean tree included
  // (branch + ahead/behind + 0-count totals). Only a stats error (not a repo /
  // git unavailable) hides the card. An OPEN drawer always stays mounted, so an
  // empty source can be switched away from.
  if (stats.error !== undefined && !open) return null

  const refresh = (): void => {
    setGen(g => g + 1)
    const ctrl = new AbortController()
    fetchWorktreeStatus(sessionId, worktreePath, ctrl.signal).then(value => { if (value !== null) setWtStatus(value) }).catch(() => {})
  }

  /**
   * Run one write operation, then refresh whatever it could have changed.
   *
   * The refresh is unconditional — a FAILED operation can still have changed the
   * tree. A pull that stops on a conflict has already written conflict markers
   * into the files, and a drawer still showing the pre-pull list would be
   * describing a working tree that no longer exists.
   */
  const runOp = async (op: GitOpName, payload: GitOpPayload = {}): Promise<GitOpResult> => {
    // The lock is the ref, not the `busy` state: a drain loop issues its calls
    // from one long-lived closure, and the state value captured at render
    // never changes under it. `busy` is set below for display only.
    if (busyRef.current !== null) return { ok: false, failure: 'unknown', error: 'another git operation is running' }
    busyRef.current = op
    setBusy(op)
    try {
      const result = await runGitOp(op, statsPath, payload, new AbortController().signal)
      // The banner lives above the body, so every change to it moves the whole
      // pane. Clearing it at the start of an op and re-showing it ~100ms later
      // made the drawer shake on every tick — and a tick's outcome is already
      // visible in place, in the box the user just clicked. So: the old banner
      // stays while the op runs (it still describes the last outcome), a
      // successful stage/unstage — tick or block — clears it rather than
      // replacing it (the block visibly leaves its layer on the refetch), and
      // only heavy operations and failures announce themselves at all.
      if (result.ok && (op === 'stage' || op === 'unstage' || op === 'applyBlocks')) setOpResult(null)
      else setOpResult({ op, result })
      return result
    } finally {
      busyRef.current = null
      setBusy(null)
      refresh()
    }
  }

  /**
   * Put a failure the drawer produced itself into the same banner git failures
   * use.
   *
   * Roll-back is the caller: it asks the host what a file's roll-back would do
   * before it does anything, and that question can fail on its own, with no
   * `runOp` behind it to report through. Everything else the drawer does is
   * either a git call or has a visible result of its own.
   */
  const reportOpError = (op: GitOpName, error: string): void => {
    setOpResult({ op, result: { ok: false, failure: 'unknown', error } })
  }

  /** Wait for the git lock, so a queued tick batch waits out a heavy
   *  operation instead of being refused by it. */
  const waitNotBusy = async (): Promise<void> => {
    while (busyRef.current !== null) await new Promise(resolve => { setTimeout(resolve, TICK_RETRY_MS) })
  }

  /**
   * Hand queued ticks to git, one action-homogeneous batch at a time.
   *
   * One call at a time is what keeps a click from being dropped: two ticks
   * 120ms apart used to race for the lock and the loser vanished without even
   * an error. Now the second queues behind the first, and clicks arriving
   * while a batch runs join the next batch as one `git add a b c`.
   *
   * Everything the loop must see fresh it reads through a ref; the queue
   * itself is a ref because clicks arrive between the loop's awaits.
   */
  const drainTicks = async (): Promise<void> => {
    if (drainingRef.current) return
    drainingRef.current = true
    const epoch = tickEpochRef.current
    try {
      while (tickEpochRef.current === epoch) {
        // Wait for the lock before batching, not after: ticks that arrived
        // while a heavy operation held it then join one batch instead of
        // forming one per click.
        await waitNotBusy()
        if (tickEpochRef.current !== epoch) break
        const batch = nextBatch(tickQueueRef.current)
        if (batch === null) break
        tickQueueRef.current = tickQueueRef.current.filter(
          tick => tick.action !== batch.action || !batch.paths.includes(tick.path),
        )
        const result = await runOp(batch.action, { paths: batch.paths })
        if (!result.ok) {
          // The git call refused or failed. Take the paths back off the
          // overlay so the box shows what git actually did — the banner runOp
          // raised says why — but only where the overlay still carries this
          // action: a later click may already have re-ticked the path.
          setPendingTicks(prev => {
            const next = new Map(prev)
            for (const path of batch.paths) {
              if (next.get(path) === batch.action) next.delete(path)
            }
            return next
          })
        }
      }
    } finally {
      drainingRef.current = false
      // A click that arrived during the last batch found `draining` set and
      // trusted this loop to come back for it; a source switch retires this
      // loop with the next source's clicks already queued. Either way the
      // queue decides: empty means done, anything else is handed to the
      // current render's loop.
      if (nextBatch(tickQueueRef.current) !== null) void drainRef.current()
    }
  }
  drainRef.current = drainTicks

  /**
   * Record ticks the moment they are clicked and hand their git calls to the
   * queue.
   *
   * The overlay update is the part the click is felt by: the box and the "N
   * ticked" counter move in the same frame as the click, and the refetch that
   * used to be the click's whole latency becomes a confirmation nobody waits
   * for.
   */
  const queueTicks = (action: TickAction, paths: readonly string[]): void => {
    if (paths.length === 0) return
    setPendingTicks(prev => {
      const next = new Map(prev)
      for (const path of paths) next.set(path, action)
      return next
    })
    tickQueueRef.current = [...tickQueueRef.current, ...paths.map(path => ({ path, action }))]
    void drainRef.current()
  }

  /** Drawer source switch: the new path flips `statsPath` (the stats effect
   *  refetches); the gen bump clears on-demand diff caches, whose content is
   *  per-source. Picking the session's own worktree clears the override rather
   *  than pinning it, so a later agent enter/exit still moves the default. */
  const switchSource = (next: string): void => {
    setSourcePath(next === sessionPath ? null : next)
    setGen(g => g + 1)
  }

  const appearance: Appearance = { mode, family }
  const theme = resolveTheme(appearance, hostDark)

  /** Persist alongside the state update, so the choice survives a reload. */
  const applyMode = (next: ColorMode): void => {
    setMode(next)
    writeStored(STORE_APPEARANCE, { mode: next, family })
  }
  const applyFamily = (next: ThemeFamily): void => {
    setFamily(next)
    writeStored(STORE_APPEARANCE, { mode, family: next })
  }

  /**
   * Apply one scope's styling, and optionally store it.
   *
   * The local update always happens first: a background is judged by looking at
   * it, and a round trip between the control and the change makes that
   * impossible. `persist` is false while a slider is being dragged — each store
   * is a file write on the host, and a range input emits one event per pixel.
   * @param scope - which scope to write.
   * @param entry - its new value.
   * @param persist - whether to send it to the host.
   * @returns the host's verdict, or a bare success when nothing was sent.
   */
  const applyStyle = async (scope: StyleScope, entry: StyleEntry, persist: boolean): Promise<{ ok: boolean; error?: string }> => {
    setStyle(prev => withScope(prev, scope, entry))
    if (!persist) return { ok: true }
    // A refusal leaves the optimistic value on screen but unsaved; re-reading
    // would silently discard what the user is looking at, so the menu says so.
    return saveStyle(statsPath, scope, entry, new AbortController().signal)
  }

  /**
   * Drag a pane divider.
   *
   * The upper bound is what keeps the diff readable: a pane may grow only into
   * space the other two do not need, so it is derived from the drawer's measured
   * width minus the neighbour's current width and the diff's minimum.
   * @param which - the pane being resized.
   * @param next - width in px the pointer implies.
   * @param measured - the drawer's inner width and the panes' current widths.
   * @param persist - whether to store it; false for intermediate drag frames.
   */
  const applyPane = (which: keyof PaneWidths, next: number, measured: { drawer: number; commits: number; tree: number }, persist: boolean): void => {
    const min = which === 'commits' ? MIN_COMMITS_WIDTH : MIN_TREE_WIDTH
    const other = which === 'commits' ? measured.tree : measured.commits
    const max = Math.max(min, measured.drawer - other - MIN_DIFF_WIDTH)
    const clamped = Math.min(Math.max(next, min), max)
    setPanes(prev => {
      const updated = { ...prev, [which]: clamped }
      if (persist) writeStored(STORE_PANES, updated)
      return updated
    })
  }

  /**
   * Drag the leading edge. Clamped at both ends — below the minimum the three
   * panes stop fitting, and past the viewport there is nothing to reveal. The
   * drag itself measures from the card's own right edge, so the upper clamp
   * lands on the inset card width without restating the inset here.
   * Dragging ends maximization, since the user just chose a width.
   * @param next - width in px the pointer implies.
   * @param persist - whether to store it. False for every intermediate frame of
   *   a drag: `localStorage` writes synchronously, and one per pointermove would
   *   put a disk write in the middle of the resize.
   */
  const applyWidth = (next: number, persist: boolean): void => {
    const clamped = Math.min(Math.max(next, MIN_DRAWER_WIDTH), window.innerWidth)
    setWidth(clamped)
    setMaximized(false)
    if (persist) writeStored(STORE_WIDTH, clamped)
  }

  /** Tab switch. No direction refetches the working tree: `viewKey` already
   *  separates the tabs' per-file diff caches, so bumping `gen` here only cost a
   *  redundant round trip. */
  const switchTab = (next: Tab): void => {
    setTab(next)
  }

  /** Append the next page of the log.
   *
   *  The guard is a ref, not the `loadingMore` state: the scroll sentinel can
   *  fire again before React has re-rendered with the state set, and two calls
   *  at the same offset would append the same page twice. */
  const loadMoreCommits = (): void => {
    if (loadingRef.current || !historyHasMore) return
    loadingRef.current = true
    setLoadingMore(true)
    const ctrl = new AbortController()
    fetchCommits(statsPath, effectiveHistoryRef, historyCommits.length, HISTORY_PAGE, liveFilter, ctrl.signal)
      .then(page => {
        if (page === null) return
        setHistoryCommits(prev => [...prev, ...page.commits])
        setHistoryHasMore(page.hasMore)
      })
      .catch(() => {})
      .finally(() => { loadingRef.current = false; setLoadingMore(false) })
  }

  /** Selecting a commit changes which view is rendered; the working tree it is
   *  shown beside has not moved, so nothing about `stats` is refetched. */
  const selectCommit = (hash: string): void => {
    setCommitHash(hash)
  }

  return (
    <>
      <EnvCard
        stats={stats}
        t={t}
        wtName={binding?.name ?? null}
        title={stats.worktreePath}
        onClick={() => { setOpen(true); setSourcePath(null); setTab('changes'); setGen(g => g + 1) }}
      />
      {open ? (
        <Drawer
          stats={stats}
          shown={shown}
          /** Per-tab in-flight flags, so an empty pane can say "loading" instead
           *  of claiming the repository has nothing in it. */
          treeLoading={tab === 'changes' ? statsLoading
            : tab === 'history' ? historyLoading || (commitHash !== null && commitStats === null)
            : comparable && compareStats === null}
          historyLoading={historyLoading}
          tab={tab}
          onSwitchTab={switchTab}
          commits={historyCommits}
          commitHash={commitHash}
          onSelectCommit={selectCommit}
          hasMoreCommits={historyHasMore}
          loadingMore={loadingMore}
          onLoadMoreCommits={loadMoreCommits}
          historyRef={effectiveHistoryRef}
          onHistoryRef={setHistoryRef}
          historyQuery={historyQuery}
          onHistoryQuery={setHistoryQuery}
          historyError={historyError}
          fetchAuthors={fetchAuthors}
          fetchRepoTree={fetchRepoTree}
          branches={branches}
          worktreeBranches={worktreeBranches}
          branchesTruncated={branchesTruncated}
          baseRef={baseRef}
          headRef={headRef}
          onBaseRef={setCompareBase}
          onHeadRef={setCompareHead}
          comparable={comparable}
          t={t}
          binding={binding}
          worktrees={worktrees}
          sessionPath={sessionPath}
          statsPath={statsPath}
          onSwitchSource={switchSource}
          segments={segments}
          selected={selected}
          onSelect={setSelected}
          maximized={maximized}
          onToggleMaximized={() => setMaximized(value => !value)}
          theme={theme}
          mode={mode}
          family={family}
          onMode={applyMode}
          onFamily={applyFamily}
          style={style}
          background={background}
          onStyle={applyStyle}
          width={width}
          onWidth={applyWidth}
          panes={panes}
          onPane={applyPane}
          onClose={() => setOpen(false)}
          onRefresh={refresh}
          commitDraft={commitDraft}
          onCommitDraft={setCommitDraft}
          commitAmend={commitAmend}
          onCommitAmend={setCommitAmend}
          sync={sync}
          busy={busy}
          opResult={opResult}
          runOp={runOp}
          fetchDiscardPlan={fetchDiscardPlan}
          onOpError={reportOpError}
          pendingTicks={pendingTicks}
          onTick={queueTicks}
          fetchFileDiff={fetchDiffForView}
          fetchFileSides={fetchFileSides}
          writeChecked={writeChecked}
          fetchBlame={fetchBlame}
          viewKey={viewKey}
          gen={gen}
          collapsed={collapsed}
          filesPlace={filesPlace}
          onFilesPlace={setFilesPlace}
          filesTree={filesTree}
          onFilesTree={setFilesTree}
          onCollapsedChange={setCollapsed}
        />
      ) : null}
    </>
  )
}

/* ---------- header environment card ---------- */

/**
 * The drawer's window controls, as glyphs.
 *
 * Four words in four identical pills read as a paragraph, not as controls — and
 * three of these four are the actions every window on the machine already spells
 * with a picture. Bootstrap Icons (MIT), one 16 viewBox, one fill, so the row
 * reads as a set rather than four drawings that happen to sit together.
 */
const CHROME_GLYPH = {
  settings: 'M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492zM5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0z M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52l-.094-.319zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 0 0 2.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 0 0 1.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 0 0-1.115 2.693l.16.291c.415.764-.42 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 0 0-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 0 0-2.692-1.115l-.292.16c-.764.415-1.6-.42-1.184-1.185l.159-.291A1.873 1.873 0 0 0 1.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 0 0 3.06 4.377l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 0 0 2.692-1.115l.094-.319z',
  maximize: 'M1.5 1a.5.5 0 0 0-.5.5v4a.5.5 0 0 1-1 0v-4A1.5 1.5 0 0 1 1.5 0h4a.5.5 0 0 1 0 1h-4zM10 .5a.5.5 0 0 1 .5-.5h4A1.5 1.5 0 0 1 16 1.5v4a.5.5 0 0 1-1 0v-4a.5.5 0 0 0-.5-.5h-4a.5.5 0 0 1-.5-.5zM.5 10a.5.5 0 0 1 .5.5v4a.5.5 0 0 0 .5.5h4a.5.5 0 0 1 0 1h-4A1.5 1.5 0 0 1 0 14.5v-4a.5.5 0 0 1 .5-.5zm15 0a.5.5 0 0 1 .5.5v4a1.5 1.5 0 0 1-1.5 1.5h-4a.5.5 0 0 1 0-1h4a.5.5 0 0 0 .5-.5v-4a.5.5 0 0 1 .5-.5z',
  restore: 'M5.5 0a.5.5 0 0 1 .5.5v4A1.5 1.5 0 0 1 4.5 6h-4a.5.5 0 0 1 0-1h4a.5.5 0 0 0 .5-.5v-4a.5.5 0 0 1 .5-.5zm5 0a.5.5 0 0 1 .5.5v4a.5.5 0 0 0 .5.5h4a.5.5 0 0 1 0 1h-4A1.5 1.5 0 0 1 10 4.5v-4a.5.5 0 0 1 .5-.5zM0 10.5a.5.5 0 0 1 .5-.5h4A1.5 1.5 0 0 1 6 11.5v4a.5.5 0 0 1-1 0v-4a.5.5 0 0 0-.5-.5h-4a.5.5 0 0 1-.5-.5zm10 1a1.5 1.5 0 0 1 1.5-1.5h4a.5.5 0 0 1 0 1h-4a.5.5 0 0 0-.5.5v4a.5.5 0 0 1-1 0v-4z',
  // Single arrow, deliberately: the sync bar's Fetch is the two-arrow circle,
  // and at 14px the only thing telling them apart is the arrow count.
  refresh: 'M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z',
  close: 'M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8 2.146 2.854Z',
} as const

function ChromeGlyph({ of }: { of: keyof typeof CHROME_GLYPH }): ReactNode {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d={CHROME_GLYPH[of]} />
    </svg>
  )
}

/**
 * Tree glyph: a root with two working copies hanging off it.
 *
 * This was git's fork glyph — the three-dot branch symbol — which named the
 * wrong thing. A worktree is not a branch; the picker beside it is already full
 * of branch names, and the two ideas need to stay tellable apart at 12px. A
 * hierarchy reads as "one repository, several directories", which is what a
 * worktree list is.
 */
function WorktreeGlyph(): ReactNode {
  return (
    <svg className={css.cardGlyph} width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      {/* Trunk down from the root, and the two limbs it puts out. */}
      <path d="M2.25 2.75h1.5v10.5h-1.5zM3 6.75h7.25v1.5H3zM3 11.75h7.25v1.5H3z" />
      {/* The root, then the worktrees. */}
      <circle cx="3" cy="2.75" r="1.75" />
      <circle cx="12" cy="7.5" r="1.75" />
      <circle cx="12" cy="12.5" r="1.75" />
    </svg>
  )
}

interface EnvCardProps { stats: WorkbenchStats; t: Translate; wtName: string | null; title: string; onClick: () => void }

function EnvCard({ stats, t, wtName, title, onClick }: EnvCardProps): ReactNode {
  /* dsh derives the branch from the worktree's name, so for anything it created
     the badge was a second printing of the chip beside it — `wt/fixture-03`
     next to `fixture-03`. The glyph still says "this session is in a worktree";
     only the repeated word goes. Where the two names are independent (a
     worktree made outside dsh) the badge is the only thing naming the
     directory, so it stays — and its presence then means something. */
  const repeats = wtName !== null && badgeRepeatsBranch(stats.branch, wtName)
  return (
    <button type="button" className={css.card} title={title} onClick={onClick}>
      <span className={css.cardBranch}>
        {repeats ? <WorktreeGlyph /> : null}
        <Elided text={branchLabel(stats.branch, t('noBranch'))} className={css.cardBranchName} />
      </span>
      {wtName !== null && !repeats ? <span className={css.cardWt}><WorktreeGlyph />{wtName}</span> : null}
      {stats.detached ? <span className={css.cardDetached}>detached</span> : null}
      {stats.ahead > 0 ? <span className={css.cardAhead} title={t('aheadTitle', { count: stats.ahead })}>↑{stats.ahead}</span> : null}
      {stats.behind > 0 ? <span className={css.cardBehind} title={t('behindTitle', { count: stats.behind })}>↓{stats.behind}</span> : null}
      {stats.files.length > 0 ? (
        <>
          <span className={css.cardSep} />
          <span className={css.cardAdded}>+{stats.addedLines}</span>
          <span className={css.cardDeleted}>−{stats.deletedLines}</span>
          <span className={css.cardFiles}>{t('files', { count: stats.files.length })}</span>
        </>
      ) : null}
    </button>
  )
}

/* ---------- drawer ---------- */

interface DrawerProps {
  /** The working tree — always the commit-list source and the header's branch. */
  stats: WorkbenchStats
  /** What the tree/diff/totals describe: the working tree, or the picked commit
   *  (null while its fetch is in flight). */
  shown: WorkbenchStats | null
  tab: Tab
  onSwitchTab: (next: Tab) => void
  /** The whole history list: the bundled first page plus every page loaded since. */
  commits: readonly GitCommit[]
  commitHash: string | null
  onSelectCommit: (hash: string) => void
  hasMoreCommits: boolean
  loadingMore: boolean
  onLoadMoreCommits: () => void
  /** Ref the history list walks. */
  historyRef: string
  onHistoryRef: (ref: string) => void
  /** The history filter box's text — the single source of the LogFilter both
   *  the box's grammar and the funnel popup write into. */
  historyQuery: string
  onHistoryQuery: (query: string) => void
  /** git's complaint when the log failed (bad pattern/date), verbatim. */
  historyError: string | null
  /** Author roster for the funnel popup's user picker. */
  fetchAuthors: (worktreePath: string | undefined, ref: string, signal: AbortSignal) => Promise<{ authors: readonly AuthorEntry[]; truncated: boolean } | null>
  /** Every path on HEAD — the path picker's raw material. */
  fetchRepoTree: (worktreePath: string | undefined, signal: AbortSignal) => Promise<{ paths: string[]; truncated: boolean } | null>
  /** Every local branch — the ref pickers' options, worktree or not. */
  branches: readonly string[]
  /** Branches that have a worktree, grouped to the top of every picker. */
  worktreeBranches: readonly string[]
  /** Whether the host cut the branch list short. */
  branchesTruncated: boolean
  baseRef: string
  headRef: string
  onBaseRef: (ref: string) => void
  onHeadRef: (ref: string) => void
  /** False when the two refs are missing or identical, which has nothing to show. */
  comparable: boolean
  t: Translate
  binding: WorktreeBinding | null
  /** Every worktree of the repository — the source picker's options. */
  worktrees: readonly WorktreeEntry[]
  /** The session's own worktree (bound one, else its cwd): the default option. */
  sessionPath: string | undefined
  /** Worktree currently read; kept at the panel (it owns the fetch path). */
  statsPath: string | undefined
  onSwitchSource: (next: string) => void
  segments: Map<string, string>
  selected: string | null
  onSelect: (path: string | null) => void
  /** Whether the drawer fills the viewport. */
  maximized: boolean
  onToggleMaximized: () => void
  /** Resolved palette name for `data-gs-theme`. */
  theme: string
  mode: ColorMode
  family: ThemeFamily
  onMode: (next: ColorMode) => void
  onFamily: (next: ThemeFamily) => void
  /** Both styling scopes, unresolved — the menu edits them separately. */
  style: StyleSettings
  /** The background actually shown, already resolved; null for none. */
  background: StyleEntry | null
  /** Applies a styling change; `persist` is false for intermediate slider frames. */
  onStyle: (scope: StyleScope, entry: StyleEntry, persist: boolean) => Promise<{ ok: boolean; error?: string }>
  /** Dragged width in px; null keeps the responsive default. */
  width: number | null
  /** Applies a dragged width; `persist` is true only for the frame that ends the drag. */
  onWidth: (next: number, persist: boolean) => void
  /** Dragged pane widths; null on either side keeps that pane's CSS default. */
  panes: PaneWidths
  onPane: (which: keyof PaneWidths, next: number, measured: { drawer: number; commits: number; tree: number }, persist: boolean) => void
  onClose: () => void
  onRefresh: () => void
  /** Commit draft, lifted so a tab switch cannot discard it. */
  commitDraft: string
  onCommitDraft: (next: string) => void
  commitAmend: boolean
  onCommitAmend: (next: boolean) => void
  /** Divergence from the upstream; null outside a repo or before the first read. */
  sync: SyncStatus | null
  /** Whether the tree's file list is still in flight for the view on screen.
   *  The pane says "loading" rather than rendering the empty stand-in as a
   *  "no changes" claim the data has not made yet. */
  treeLoading: boolean
  /** Whether the history list's first page is in flight — same rule. */
  historyLoading: boolean
  /** The write operation in flight, or null. Disables the others while set. */
  busy: GitOpName | null
  /** The last write operation's outcome, or null once a new one starts. */
  opResult: { op: GitOpName; result: GitOpResult } | null
  runOp: (op: GitOpName, payload?: GitOpPayload) => Promise<GitOpResult>
  fetchDiscardPlan: (worktreePath: string | undefined, path: string, signal: AbortSignal) => Promise<DiscardAnswer>
  /** Say why an operation the drawer started did nothing. */
  onOpError: (op: GitOpName, error: string) => void
  /** Ticks awaiting their git call, keyed by path — overlaid over the file
   *  list so the click is on screen before git confirms it. */
  pendingTicks: ReadonlyMap<string, TickAction>
  /** Queue the git calls for a tick batch. */
  onTick: (action: TickAction, paths: readonly string[]) => void
  fetchFileDiff: (path: string, signal: AbortSignal) => Promise<string>
  /** One layer of one file for the side-by-side pane; the drawer binds the source. */
  fetchFileSides: (worktreePath: string | undefined, path: string, layer: SideLayer, signal: AbortSignal) => Promise<FileSides | null>
  /** Save the side pane's editor buffer; the drawer binds the source. */
  writeChecked: (worktreePath: string | undefined, path: string, text: string, expectedSha: string, signal: AbortSignal) => Promise<WriteResult | null>
  fetchBlame: (worktreePath: string | undefined, path: string, signal: AbortSignal) => Promise<BlameAnswer | null>
  /** Identifies the view the per-file diff cache belongs to (working tree, or one commit). */
  viewKey: string
  gen: number
  collapsed: Set<string> | undefined
  filesPlace: FilesPlace
  onFilesPlace: (next: FilesPlace) => void
  filesTree: { paths: readonly string[]; truncated: boolean }
  onFilesTree: (next: { readonly paths: readonly string[]; readonly truncated: boolean }) => void
  onCollapsedChange: (next: Set<string>) => void
}

function Drawer({ stats, shown, tab, onSwitchTab, commits, commitHash, onSelectCommit, hasMoreCommits, loadingMore, onLoadMoreCommits, historyRef, onHistoryRef, historyQuery, onHistoryQuery, historyError, fetchAuthors, fetchRepoTree, branches, worktreeBranches, branchesTruncated, baseRef, headRef, onBaseRef, onHeadRef, comparable, t, binding, worktrees, sessionPath, statsPath, onSwitchSource, segments, selected, onSelect, maximized, onToggleMaximized, theme, mode, family, onMode, onFamily, style, background, onStyle, width, onWidth, panes, onPane, onClose, onRefresh, commitDraft, onCommitDraft, commitAmend, onCommitAmend, sync, treeLoading, historyLoading, busy, opResult, runOp, fetchDiscardPlan, onOpError, pendingTicks, onTick, fetchFileDiff, fetchFileSides, writeChecked, fetchBlame, viewKey, gen, collapsed, onCollapsedChange, filesPlace, onFilesPlace, filesTree, onFilesTree }: DrawerProps): ReactNode {
  // Empty stand-in while a commit's change set loads, so every hook below keeps a
  // stable shape and the panes simply render nothing.
  const body = shown ?? EMPTY_STATS
  /** The file list with ticks still awaiting git laid over them. The tree and
   *  the commit box read this, so a click moves its box and the "N ticked"
   *  counter in the click's own frame rather than a refetch later. Same
   *  reference as `body.files` whenever nothing is pending. */
  const tickedFiles = withPendingTicks(body.files, pendingTicks)
  /** Whether this view has nothing to show YET, as opposed to showing good data
   *  while a refresh lands over it. Derived once and handed to both the header
   *  and the tree: spelling it twice is what let the header get it wrong. */
  const pending = showsPending(treeLoading, body.files.length)
  /** The history filter's paths, which decide what a commit OPENS on. Only the
   *  history tab has one: the changes and compare trees are not filtered, and
   *  steering their default selection by a query the reader cannot see from
   *  there would be a spooky action. */
  const activeFilterPaths = useMemo(
    () => tab === 'history' ? parseLogQuery(historyQuery).paths : NO_PATHS,
    [tab, historyQuery],
  )
  /** Working-tree files the browser can open on top of what `repoTree` knows:
   *  `git ls-tree HEAD` cannot see an untracked file, and a browser that will
   *  not open the file you just created reads as broken. A deleted file is
   *  left out — opening it would only fail. */
  const browsablePaths = useMemo(
    () => stats.files.filter(file => file.status !== 'deleted').map(file => file.path),
    [stats.files],
  )
  // A selection the current source no longer lists (e.g. after a source or tab
  // switch) falls back to the filtered file, else the first — never a dangling
  // highlight. See `active-file.ts` for the order and the reasoning.
  const active = preferredFile(body.files, activeFilterPaths, selected)
  const activeFile = body.files.find(file => file.path === active) ?? null
  /** The file whose roll-back is being asked about; `plan` is null while the
   *  host is still being asked what it would do. */
  const [discardPending, setDiscardPending] = useState<{ file: GitFile; plan: DiscardPreview | null } | null>(null)
  const [fetched, setFetched] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(false)
  const bundled = active === null ? '' : segments.get(active) ?? ''
  // The cache spans views, so its key names one: the same path holds different
  // content in the working tree and in every commit.
  const activeKey = active === null ? null : `${viewKey}\x1f${active}`
  const segment = bundled.length > 0 ? bundled : activeKey === null ? '' : fetched.get(activeKey) ?? ''

  // On-demand diff for files absent from the bundled payload (cap-truncated
  // untracked files, oversize paths).
  useEffect(() => {
    const path = active
    if (path === null || activeKey === null || bundled.length > 0) return
    const file = body.files.find(f => f.path === path)
    if (file === undefined || file.binary) return
    if (fetched.has(activeKey)) return
    const ctrl = new AbortController()
    setLoading(true)
    fetchFileDiff(path, ctrl.signal)
      .then(diff => { setFetched(prev => new Map(prev).set(activeKey, diff)) })
      .catch(() => {})
      .finally(() => { setLoading(false) })
    return () => ctrl.abort()
  }, [active, activeKey, bundled, body.files, fetched, fetchFileDiff])

  // Reset the on-demand cache when the generation (refresh) advances.
  useEffect(() => { setFetched(new Map()) }, [gen])

  // The side pane's dirty flag, reported upward: every gesture that would
  // drop the editor's buffer asks before it acts, and the layer tab is only
  // the rarest of them — clicking another file in the tree is this pane's
  // PRIMARY navigation. The guard is the little state machine in
  // side-edit.ts (gateLeave / leaveAsked / leaveAnswered / paneDirtyReport);
  // the PANE is the dirty flag's only writer, so the drawer never guesses
  // it — clearing the flag on a confirmed Leave is what let a no-op gesture
  // (the already-active tab, the already-shown file's row) disarm the guard
  // for every gesture after it.
  const [leaveGuard, setLeaveGuard] = useState<LeaveGuard>(LEAVE_GUARD_CLEAR)
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null)
  const onSideDirty = useCallback((dirty: boolean): void => {
    setLeaveGuard(prev => paneDirtyReport(prev, dirty))
  }, [])
  const guardLeave = (act: () => void, same: boolean): void => {
    const gate = gateLeave(leaveGuard, same)
    if (gate.kind === 'wait') return
    if (gate.kind === 'ask') {
      setPendingLeave(() => act)
      setLeaveGuard(leaveAsked)
      return
    }
    act()
  }
  const settleLeaveAsk = (): void => {
    setPendingLeave(null)
    setLeaveGuard(leaveAnswered)
  }
  const confirmDrawerLeave = (): void => {
    const act = pendingLeave
    if (act === null) return
    // Leave closes the ask and runs the gesture; the flag keeps the pane's
    // last report. A real navigation's reset reports clean on its own; a
    // no-op gesture never should have prompted, and its Leave leaves the
    // guard armed.
    settleLeaveAsk()
    act()
  }
  const closeDrawer = (): void => guardLeave(onClose, false)
  const leaveTab = (next: Tab): void => guardLeave(() => onSwitchTab(next), next === tab)
  // `active`, not `selected`: the pane's identity is the file it SHOWS, and
  // the preferred-file fallback can leave `selected` naming a file the pane
  // is not rendering — the row that changes nothing is the shown file's.
  const selectAndReveal = (path: string): void => guardLeave(() => onSelect(path), path === active)
  // The source picker swaps the whole worktree under the drawer — the buffer
  // belongs to a file the new source may not even list. Picking the source
  // already on screen changes nothing, so it runs unguarded like every other
  // no-op gesture.
  const leaveSource = (next: string): void => guardLeave(() => onSwitchSource(next), samePath(next, statsPath))

  /**
   * Roll-back, in two steps that are deliberately not one.
   *
   * The click asks the host what rolling this file back would DO, and only the
   * answer opens the dialog. Deriving the wording from the clicked row instead
   * would mean describing a file as the last poll saw it: the difference
   * between "goes back to its committed content" and "leaves the disk and
   * cannot come back" is the entire subject of the question being asked, and it
   * is exactly the thing a stale row gets wrong.
   *
   * `recover` — a deleted file coming back — shows no dialog at all. It loses
   * nothing, and a confirmation in front of a pure gain is how people learn to
   * dismiss confirmations without reading them.
   *
   * Every other answer is `nextAfterPlan`'s to classify, and the one it exists
   * for is failure: a plan that never arrives reports, where it used to leave
   * the reader looking at a button that did nothing.
   */
  const askDiscard = (file: GitFile): void => {
    setDiscardPending({ file, plan: null })
    void (async () => {
      const next = nextAfterPlan(await fetchDiscardPlan(statsPath, file.path, new AbortController().signal))
      if (next.kind === 'confirm') {
        setDiscardPending({ file, plan: next.plan })
        return
      }
      setDiscardPending(null)
      if (next.kind === 'run') void runOp('discardFile', { path: file.path, expectedEffect: next.effect })
      else if (next.kind === 'refresh') onRefresh()
      else onOpError('discardFile', next.error)
    })()
  }

  const confirmDiscard = (): void => {
    const pending = discardPending
    if (pending === null || pending.plan === null) return
    setDiscardPending(null)
    void runOp('discardFile', { path: pending.file.path, expectedEffect: pending.plan.effect })
  }

  /** The BLOCK roll-back being asked about, snapshotted at click time; null
   *  while none is open. The confirmation states this ask, and the confirmed
   *  call carries it verbatim — so if the file moves underneath the dialog,
   *  the host's diffSha refusal is what stops the apply, not a re-derived
   *  (different) block. */
  const [blockDiscard, setBlockDiscard] = useState<BlockAsk | null>(null)

  /**
   * One block action from the side pane, routed the way `askDiscard` routes a
   * file's: stage and unstage are not destructive and run now, through the same
   * op machinery as every tick; discard is the irreversible one, so its click
   * only asks. The chain has no plan RPC to call — the consequence of reverting
   * THIS block's lines is fully stated by the pane's own rows — and the
   * "refuse if the answer changed" step is the host's stale check, which fires
   * on the diffSha the dialog was opened against.
   */
  const askBlockAction = (mode: BlockMode, ask: BlockAsk): Promise<GitOpResult> => {
    if (mode === 'discard') {
      setBlockDiscard(ask)
      return Promise.resolve({ ok: true })
    }
    return runOp('applyBlocks', { path: ask.path, layer: ask.layer, diffSha: ask.diffSha, lines: ask.lines, mode })
  }

  const confirmBlockDiscard = (): void => {
    const ask = blockDiscard
    if (ask === null) return
    setBlockDiscard(null)
    void runOp('applyBlocks', { path: ask.path, layer: ask.layer, diffSha: ask.diffSha, lines: ask.lines, mode: 'discard' })
  }

  const drawerRef = useRef<HTMLDivElement>(null)
  const commitsRef = useRef<HTMLDivElement>(null)
  const treeRef = useRef<HTMLDivElement>(null)
  const edgeDrag = useHorizontalDrag()

  /**
   * What a pane drag is clamped against: the drawer's inner width and what the
   * panes currently occupy. Read live, because the drawer itself can have been
   * resized since the last render.
   * @returns the three widths in px.
   */
  const measurePanes = (): { drawer: number; commits: number; tree: number } => ({
    drawer: drawerRef.current?.clientWidth ?? window.innerWidth,
    commits: commitsRef.current?.getBoundingClientRect().width ?? 0,
    tree: treeRef.current?.getBoundingClientRect().width ?? 0,
  })

  /**
   * @param which - the pane a divider resizes.
   * @param ref - that pane's element, whose left edge the width is measured from.
   * @returns a drag handler for {@link PaneDivider}.
   */
  const paneDrag = (which: keyof PaneWidths, ref: { current: HTMLDivElement | null }) =>
    (clientX: number, done: boolean): void => {
      const left = ref.current?.getBoundingClientRect().left
      if (left === undefined) return
      onPane(which, clientX - left, measurePanes(), done)
    }

  /** The drawer's leading edge, measured from the card's own right edge — fixed
   *  for the whole drag, so the inset between card and viewport is never
   *  restated in JS. */
  const edgeDragHandler = (clientX: number, done: boolean): void => {
    const right = drawerRef.current?.getBoundingClientRect().right ?? window.innerWidth
    onWidth(right - clientX, done)
  }

  /** A dragged pane width must beat the stylesheet's `max-width`, which was
   *  written for the undragged default. */
  const paneStyle = (px: number | null): CSSProperties | undefined =>
    px === null ? undefined : { width: `${px}px`, maxWidth: 'none' }

  // Width and the background's three tunables are inline because both are live
  // user values; the stylesheet only says what reads them. The pane floors are
  // inline for a different reason: they belong to the drag clamp above, and
  // restating them in CSS would give one fact two homes that can disagree.
  const cardStyle: CSSProperties = {
    // `@types/react` 18's CSSProperties has no index signature for custom
    // properties, so every --gs-* group is asserted rather than declared.
    ...{
      '--gs-min-commits': `${MIN_COMMITS_WIDTH}px`,
      '--gs-min-tree': `${MIN_TREE_WIDTH}px`,
      '--gs-min-diff': `${MIN_DIFF_WIDTH}px`,
    } as CSSProperties,
    ...maximized || width === null ? {} : { width: `${width}px` },
    ...background === null ? {} : {
      '--gs-bg-image': `url("${background.image}")`,
      '--gs-bg-blur': `${background.blur}px`,
      '--gs-veil': `${background.veil}%`,
    } as CSSProperties,
  }

  return (
    <div
      className={maximized ? `${css.overlay} ${css.overlayMax}` : css.overlay}
      data-gs-theme={theme}
      data-gs-part="overlay"
      onClick={closeDrawer}
    >
      <div
        ref={drawerRef}
        className={css.drawer}
        style={cardStyle}
        data-gs-part="card"
        {...background === null ? {} : { 'data-gs-bg': '' }}
        role="dialog"
        aria-label={t('drawerLabel')}
        onClick={event => event.stopPropagation()}
      >
        <div
          className={edgeDrag.dragging ? `${css.resizer} ${css.resizerActive}` : css.resizer}
          role="separator"
          aria-orientation="vertical"
          aria-label={t('resizeLabel')}
          onPointerDown={event => edgeDrag.start(event, edgeDragHandler)}
        />
        {/* One row for "where am I": the worktree, its path, and — when the view
            is about something other than the working tree — what that is. The
            branch used to be stated here AND in a picker row of its own, and
            the divergence here AND in the sync bar; both now have one home. */}
        <div className={css.header} data-gs-part="header">
          <div className={css.headerLeft}>
            <SourceChip
              t={t}
              worktrees={worktrees}
              boundPath={binding?.worktreePath ?? null}
              sessionPath={sessionPath}
              statsPath={statsPath}
              fallbackBranch={stats.branch}
              onSwitch={leaveSource}
            />
            <Elided text={stats.worktreePath} className={css.headerPathMain} title={stats.worktreePath} />
            {tab === 'changes' && stats.detached ? <span className={css.headerDetached}>detached HEAD</span> : null}
            {tab === 'history' && commitHash !== null ? <span className={css.headerView}>{commitHash}</span> : null}
            {tab === 'compare' ? (
              <span className={css.headerView}>
                <Elided text={branchLabel(baseRef, t('noBranch'))} className={css.headerViewRef} />
                {' → '}
                <Elided text={branchLabel(headRef, t('noBranch'))} className={css.headerViewRef} />
              </span>
            ) : null}
            {/* A confident `+0 −1` for a view with nothing behind it yet is not
                a slower answer, it is a wrong one — so the totals say "pending".
                But only then: a refresh landing over numbers already on screen
                must leave them alone. See {@link showsPending}. */}
            {pending ? <span className={css.headerTotalsDim}>—</span> : (
              <>
                <span className={css.headerTotals}>
                  <span className={css.headerTotalsAdd}>+{body.addedLines}</span>{' '}
                  <span className={css.headerTotalsDel}>−{body.deletedLines}</span>
                </span>
                <span className={css.headerTotalsDim}>
                  {t('totalsDim', { added: body.addedFiles, modified: body.modifiedFiles, deleted: body.deletedFiles })}
                </span>
                {tab === 'compare' && comparable ? (
                  <span className={css.headerTotalsDim}>
                    {t('compareCommits', { count: shown?.commits.length ?? 0 })}
                  </span>
                ) : null}
              </>
            )}
          </div>
          {/* Window controls, not sentences. Each keeps its word on `title` and
              `aria-label`, so nothing is lost to a reader who cannot see the
              glyph or does not recognise it. */}
          <div className={css.headerRight}>
            <SettingsMenu
              t={t} mode={mode} family={family} onMode={onMode} onFamily={onFamily}
              settings={style} onStyle={onStyle}
            />
            <button
              type="button"
              className={`${css.btn} ${css.btnIcon}`}
              aria-pressed={maximized}
              aria-label={maximized ? t('restore') : t('maximize')}
              title={maximized ? t('restore') : t('maximize')}
              onClick={onToggleMaximized}
            ><ChromeGlyph of={maximized ? 'restore' : 'maximize'} /></button>
            <button
              type="button"
              className={`${css.btn} ${css.btnIcon}`}
              aria-label={t('refresh')} title={t('refresh')}
              onClick={onRefresh}
            ><ChromeGlyph of="refresh" /></button>
            <button
              type="button"
              className={`${css.btn} ${css.btnIcon} ${css.btnClose}`}
              aria-label={t('close')} title={t('close')}
              onClick={closeDrawer}
            ><ChromeGlyph of="close" /></button>
          </div>
        </div>
        <div className={css.tabs} role="tablist" aria-label={t('tabsLabel')} data-gs-part="tabs">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'changes'}
            className={tab === 'changes' ? `${css.tab} ${css.tabActive}` : css.tab}
            onClick={() => leaveTab('changes')}
          >{t('tabChanges')}</button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'history'}
            className={tab === 'history' ? `${css.tab} ${css.tabActive}` : css.tab}
            onClick={() => leaveTab('history')}
          >{t('tabHistory')}</button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'compare'}
            className={tab === 'compare' ? `${css.tab} ${css.tabActive}` : css.tab}
            onClick={() => leaveTab('compare')}
          >{t('tabCompare')}</button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'files'}
            className={tab === 'files' ? `${css.tab} ${css.tabActive}` : css.tab}
            onClick={() => leaveTab('files')}
          >{t('tabFiles')}</button>
        </div>
        {tab === 'compare' ? (
          <CompareBar
            t={t}
            branches={branches}
            worktreeBranches={worktreeBranches}
            truncated={branchesTruncated}
            baseRef={baseRef}
            headRef={headRef}
            onBaseRef={onBaseRef}
            onHeadRef={onHeadRef}
          />
        ) : null}
        {tab === 'history' && branches.length > 0 ? (
          <div className={css.compareBar}>
            <RefPicker
              t={t} label={t('historyRefLabel')} value={historyRef}
              branches={branches} worktreeBranches={worktreeBranches} truncated={branchesTruncated}
              onPick={onHistoryRef}
              allLabel={t('allBranches')}
            />
          </div>
        ) : null}
        {/* Write operations act on the working tree, so they belong to the tab
            that shows it. A commit box under a historical diff would be asking
            which tree it commits. */}
        {tab === 'changes' && sync !== null && sync.hasRemote ? (
          <SyncBar t={t} sync={sync} busy={busy} onOp={(op, payload) => { void runOp(op, payload) }} />
        ) : null}
        {opResult !== null ? (
          <div
            className={opResult.result.ok ? `${css.opBanner} ${css.opBannerOk}` : `${css.opBanner} ${css.opBannerBad}`}
            role="status"
          >{opMessage(t, opResult.op, opResult.result)}</div>
        ) : null}
        <div className={css.body}>
          {tab === 'history' ? (
            <>
              <CommitList
                paneRef={commitsRef}
                style={paneStyle(panes.commits)}
                t={t}
                loading={historyLoading}
                commits={commits}
                active={commitHash}
                onSelect={onSelectCommit}
                hasMore={hasMoreCommits}
                loadingMore={loadingMore}
                onLoadMore={onLoadMoreCommits}
                query={historyQuery}
                onQueryChange={onHistoryQuery}
                error={historyError}
                statsPath={statsPath}
                refName={historyRef}
                fetchAuthors={fetchAuthors}
                fetchRepoTree={fetchRepoTree}
              />
              <PaneDivider label={t('resizeCommits')} onDrag={paneDrag('commits', commitsRef)} />
            </>
          ) : null}
          {tab === 'files' ? (
            <FileBrowser
              t={t}
              palette={theme}
              statsPath={statsPath}
              extraPaths={browsablePaths}
              gen={gen}
              treeStyle={paneStyle(panes.tree)}
              treeRef={treeRef}
              divider={<PaneDivider label={t('resizeTree')} onDrag={paneDrag('tree', treeRef)} />}
              place={filesPlace}
              onPlace={onFilesPlace}
              cached={filesTree}
              onTree={onFilesTree}
              fetchRepoTree={fetchRepoTree}
              fetchFileSides={fetchFileSides}
              writeChecked={writeChecked}
              fetchBlame={fetchBlame}
              onSaved={onRefresh}
              onDirtyChange={onSideDirty}
              onShowHistory={query => { onHistoryQuery(query); leaveTab('history') }}
            />
          ) : (
            <>
          <div ref={treeRef} className={css.treeCol} style={paneStyle(panes.tree)} data-gs-part="tree">
            <FileTree
              t={t}
              scopeKey={viewKey}
              loading={pending}
              lead={tab === 'changes' ? t('workingTree') : undefined}
              files={tickedFiles}
              active={active}
              onSelect={selectAndReveal}
              collapsed={collapsed}
              onCollapsedChange={onCollapsedChange}
              // Ticks exist only for the working tree. A commit's contents were
              // decided long ago and a range's never were, so the column is
              // absent there rather than present and inert.
              //
              // A tick IS still the git call — `add` on the way in,
              // `restore --staged` on the way out, applied now rather than
              // saved up for Commit — but the call is queued, not raced: the
              // click paints itself through the overlay, the drain loop batches
              // the git calls, and a click that lands while another runs waits
              // its turn instead of being dropped. `checked` carries the
              // overlaid flags, so a second click reads the state the user is
              // looking at, not the pre-click payload.
              onCheck={tab === 'changes' ? (checked, state) => {
                const action = nextAction(state)
                const paths = pathsFor(checked, action)
                if (paths.length > 0) onTick(action, paths)
              } : undefined}
              // Roll back, likewise working-tree only. The click does not act:
              // it asks the host what the act WOULD be, and that answer is what
              // the dialog states. See `askDiscard`.
              onDiscard={tab === 'changes' ? askDiscard : undefined}
              footer={tab === 'changes'
                ? (
                  <CommitBox
                    t={t} files={tickedFiles} busy={busy} onOp={runOp}
                    message={commitDraft} onMessage={onCommitDraft}
                    amend={commitAmend} onAmend={onCommitAmend}
                  />
                )
                : undefined}
            />
          </div>
          <PaneDivider label={t('resizeTree')} onDrag={paneDrag('tree', treeRef)} />
          <div className={css.diffPane} data-gs-part="diff">
            {tab === 'compare' && !comparable ? (
              <div className={css.empty}>{t('comparePick')}</div>
            ) : shown === null && tab !== 'changes' ? (
              <div className={css.empty}>{tab === 'compare' ? t('loadingCompare') : t('loadingCommit')}</div>
            ) : activeFile !== null && activeFile.previousPath !== undefined ? (
              <div className={css.renameLine}>{t('renamedFrom')} <code>{activeFile.previousPath}</code></div>
            ) : null}
            {(shown === null && tab !== 'changes') || (tab === 'compare' && !comparable) ? null
              : activeFile !== null && activeFile.binary ? (
                <div className={css.empty}>{t('binaryFile')}</div>
              ) : tab === 'changes' && active !== null ? (
                <SideBySideView
                  t={t}
                  path={active}
                  palette={theme}
                  statsPath={statsPath}
                  fetchSides={fetchFileSides}
                  writeChecked={writeChecked}
                  scopeKey={viewKey}
                  gen={gen}
                  fallbackSegment={segment}
                  fallbackLoading={loading && segment.length === 0}
                  onBlockAction={askBlockAction}
                  onSaved={onRefresh}
                  onDirtyChange={onSideDirty}
                />
              ) : loading && segment.length === 0 ? (
                <div className={css.empty}>{t('loadingDiff')}</div>
              ) : segment.length > 0 ? (
                <DiffView segment={segment} path={active ?? ''} palette={theme} />
              ) : (
                <div className={css.empty}>{t('noTextDiff')}</div>
              )}
          </div>
            </>
          )}
        </div>
        {discardPending?.plan != null ? (
          <DiscardConfirm
            t={t}
            body={discardBodyText(t, discardPending.file, discardPending.plan)}
            onCancel={() => setDiscardPending(null)}
            onConfirm={confirmDiscard}
          />
        ) : null}
        {blockDiscard !== null ? (
          <DiscardConfirm
            t={t}
            body={blockDiscardBodyText(
              t,
              blockDiscard,
              body.files.find(file => file.path === blockDiscard.path),
            )}
            onCancel={() => setBlockDiscard(null)}
            onConfirm={confirmBlockDiscard}
          />
        ) : null}
        {/* The drawer-level unsaved-edits guard: the file being left is the
            one the reader was editing, and the deferred gesture — another
            file, another tab, closing — runs only on the dialog's answer. */}
        {pendingLeave !== null ? (
          <LeaveEditsConfirm
            t={t}
            path={active ?? ''}
            onCancel={settleLeaveAsk}
            onConfirm={confirmDrawerLeave}
          />
        ) : null}
      </div>
    </div>
  )
}

/**
 * The one dialog in this drawer, because this is the one act it cannot undo.
 *
 * It never asks a generic "are you sure": the caller hands it a body that names
 * the file and states which consequence is about to happen — the whole-file
 * roll-back's wording derived from the host's own reading of that file, the
 * block roll-back's from the pane's rows. Cancel holds the initial focus and
 * Escape closes, because the default answer to an irreversible question is no.
 *
 * There is deliberately no "don't ask again". This is the only path in the
 * drawer with nothing behind it, and a checkbox whose whole function is to
 * switch off the last guard is a feature that eventually gets clicked.
 */
function DiscardConfirm({ t, body, onCancel, onConfirm }: {
  t: Translate
  body: string
  onCancel: () => void
  onConfirm: () => void
}): ReactNode {
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { cancelRef.current?.focus() }, [])
  useEffect(() => {
    // Capture phase: while this question is open, Escape belongs to it alone
    // — consumed here, before it can reach the page's other Escape handlers
    // (an open picker's dismiss, the commit box's undo).
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onCancel()
    }
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('keydown', onKey, true) }
  }, [onCancel])

  return (
    <div className={css.confirmScrim} onClick={onCancel}>
      <div
        className={css.confirmBox}
        role="alertdialog"
        aria-modal="true"
        aria-label={t('discardTitle')}
        onClick={event => event.stopPropagation()}
      >
        <div className={css.confirmTitle}>{t('discardTitle')}</div>
        <div className={css.confirmBody}>{body}</div>
        <div className={css.confirmActions}>
          <button ref={cancelRef} type="button" className={css.btn} onClick={onCancel}>{t('discardCancel')}</button>
          <button type="button" className={`${css.btn} ${css.btnDanger}`} onClick={onConfirm}>{t('discardConfirm')}</button>
        </div>
      </div>
    </div>
  )
}

/**
 * The whole-file roll-back's consequence, in the host's own fresh reading of
 * the file — the difference between "goes back to its committed content" and
 * "leaves the disk and cannot come back" is the entire question the dialog
 * asks, and it is exactly what a stale row gets wrong.
 */
function discardBodyText(t: Translate, file: GitFile, plan: DiscardPreview): string {
  if (plan.effect === 'delete') return t('discardBodyDelete', { path: file.path })
  if (plan.effect === 'unrename') return t('discardBodyUnrename', { path: file.path, previousPath: plan.previousPath ?? '' })
  return t('discardBodyRestore', { path: file.path, added: file.addedLines, deleted: file.deletedLines })
}

/**
 * The BLOCK roll-back's consequence, in the pane's own rows.
 *
 * One case outranks the tally wording: an untracked file's whole content is
 * the one block, and rolling THAT block back reverse-applies the new-file
 * patch — which deletes the file from the working tree, not rewrites it. The
 * file row's status is the gate (a tracked file whose every line changed has
 * the same block shape and only rewrites), which is why the ask's shape alone
 * is not enough.
 */
function blockDiscardBodyText(t: Translate, ask: BlockAsk, file: GitFile | undefined): string {
  if (file !== undefined && file.status === 'untracked' && ask.wholeFile) {
    return t('blockDiscardBodyDelete', { path: ask.path })
  }
  return t('blockDiscardBody', { path: ask.path, added: ask.added, deleted: ask.deleted })
}

/**
 * A slash-separated name that gives up its HEAD, never its tail.
 *
 * Paths and branches have the same shape and the same problem: the leaf is what
 * distinguishes siblings, and ordinary `text-overflow: ellipsis` eats exactly
 * that. `…/worktrees/fixture-07` and `…/worktrees/fixture-14` become the same
 * string; so do `feature/nested/deep/parser` and `feature/nested/deep/lexer`.
 * Splitting in two and letting only the head shrink keeps the half that
 * answers "which one".
 *
 * Truncating from the other end with `direction: rtl` was the one-line version
 * and the wrong one: it reorders the backslashes in a Windows path.
 *
 * When the name has no head to give — a bare `some-very-long-branch-name` — the
 * tail ellipsises after all rather than overflowing its row; the stylesheet
 * weights the shrink so that only happens once the head is gone.
 */
function Elided({ text, className, title }: {
  text: string
  className: string
  /** Set only where the row does not already carry the full text itself. */
  title?: string
}): ReactNode {
  if (text.length === 0) return null
  const { head, tail } = splitPath(text)
  return (
    <span className={`${css.elide} ${className}`} {...title === undefined ? {} : { title }}>
      {head.length > 0 ? <span className={css.elideHead}>{head}</span> : null}
      <span className={css.elideTail}>{tail}</span>
    </span>
  )
}

/**
 * Which worktree the drawer is reading — the header's first control.
 *
 * Git allows at most one worktree per branch, so the repository's worktree list
 * IS the branch list and one control covers both. This used to be a row of its
 * own under the tabs, restating the branch the header had already named one
 * line above; now it IS that name, and clicking it changes the view.
 *
 * A repository with a single worktree has nothing to choose, so it renders as
 * the same chip without the menu — the identity still has to be stated, and a
 * control that opens an empty list is worse than none.
 */
function SourceChip({ t, worktrees, boundPath, sessionPath, statsPath, fallbackBranch, onSwitch }: {
  t: Translate
  worktrees: readonly WorktreeEntry[]
  boundPath: string | null
  sessionPath: string | undefined
  statsPath: string | undefined
  /** What to name when the worktree list does not cover the active path — the
   *  branch the stats themselves report. */
  fallbackBranch: string
  onSwitch: (next: string) => void
}): ReactNode {
  if (worktrees.length < 2) {
    return (
      <span className={css.headerBranch}>
        <WorktreeGlyph />
        <Elided text={branchLabel(fallbackBranch, t('noBranch'))} className={css.refValue} />
      </span>
    )
  }
  return (
    <WorktreePicker
      t={t} worktrees={worktrees} boundPath={boundPath}
      sessionPath={sessionPath} statsPath={statsPath}
      fallbackBranch={fallbackBranch} onSwitch={onSwitch}
    />
  )
}

/**
 * The worktree menu: the ref picker's scaffold — button, filter box, scrolling
 * list — over worktree rows, wearing the header chip's accent so it reads as
 * the subject of the drawer rather than one more grey button.
 *
 * Rows carry the tree glyph when the session is bound there and a dot when it
 * is the session's own; Enter takes the first match.
 *
 * The row gives its whole width to the branch. A dim path used to ride on the
 * right to tell same-named branches in different repositories apart, but it
 * cost half the row to earn that, and the half it took was the half that
 * mattered: `wt/fixture-03` truncated to `wt/fixtur…` beside a path whose tail
 * was repeating the name anyway. The full path stays one hover away on `title`,
 * and the header spells it out the moment a row is picked.
 */
function WorktreePicker({ t, worktrees, boundPath, sessionPath, statsPath, fallbackBranch, onSwitch }: {
  t: Translate
  worktrees: readonly WorktreeEntry[]
  boundPath: string | null
  sessionPath: string | undefined
  statsPath: string | undefined
  fallbackBranch: string
  onSwitch: (next: string) => void
}): ReactNode {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useDismissable(open, setOpen)

  const needle = query.trim().toLowerCase()
  const matched = needle.length === 0 ? worktrees : worktrees.filter(entry =>
    entry.branch.toLowerCase().includes(needle) || entry.path.toLowerCase().includes(needle))
  const first = matched[0]
  const current = worktrees.find(entry => samePath(entry.path, statsPath))

  const choose = (entry: WorktreeEntry): void => {
    onSwitch(entry.path)
    setOpen(false)
    setQuery('')
  }

  return (
    <div className={css.refPicker} ref={rootRef}>
      <button
        type="button"
        className={`${css.refButton} ${css.headerPicker}`}
        aria-expanded={open}
        aria-label={t('sourceLabel')}
        title={current?.path ?? statsPath}
        onClick={() => setOpen(isOpen => !isOpen)}
      >
        <WorktreeGlyph />
        <Elided text={branchLabel(current?.branch ?? fallbackBranch, t('noBranch'))} className={css.refValue} />
        <span className={css.refCaret}>▾</span>
      </button>
      {open ? (
        <div className={css.refPop}>
          <input
            className={css.refSearch}
            autoFocus
            value={query}
            placeholder={t('refSearch')}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter' && first !== undefined) choose(first) }}
          />
          <div className={css.refList} role="listbox" aria-label={t('sourceLabel')}>
            {matched.map(entry => {
              const active = samePath(entry.path, statsPath)
              return (
                <button
                  key={entry.path}
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={active ? `${css.refRow} ${css.refRowActive}` : css.refRow}
                  title={entry.path}
                  onClick={() => choose(entry)}
                >
                  {samePath(boundPath, entry.path) ? <WorktreeGlyph /> : <span className={css.refRowSpacer} />}
                  <Elided text={branchLabel(entry.branch, t('noBranch'))} className={css.refRowName} />
                  {samePath(sessionPath, entry.path) ? <span className={css.wtCurrent}>●</span> : null}
                </button>
              )
            })}
            {matched.length === 0 ? <div className={css.refEmpty}>{t('refNone')}</div> : null}
          </div>
          <div className={css.refFoot}>{t('refCount', { shown: matched.length, total: worktrees.length })}</div>
        </div>
      ) : null}
    </div>
  )
}

/**
 * Settings: colour mode, palette, background image and custom CSS.
 *
 * Mode defaults to `system`, which follows dsh (`body[data-ds-dark-theme]`);
 * light and dark pin the drawer even when the host is the other scheme. The
 * palette is a pure token swap — every drawer colour resolves through the same
 * names, so nothing but the values differ between families.
 *
 * The background and the stylesheet are per-scope, and the scope switch is the
 * only control in here that changes what an edit WRITES rather than what it
 * looks like, so it sits at the top of that section rather than beside a field.
 *
 * This was a companion card portalled into the overlay to the LEFT of the
 * drawer, so a palette could be previewed against the diff without covering it.
 * It is a popover now, hung under its own gear: a card floating out in the page
 * beside the drawer read as a second window rather than as this drawer's
 * settings, and it was the one menu here that did not behave like the rest.
 * The preview still works — the popover covers the top of the diff, not all of
 * it, and the drawer repaints live underneath.
 */
function SettingsMenu({ t, mode, family, onMode, onFamily, settings, onStyle }: {
  t: Translate
  mode: ColorMode
  family: ThemeFamily
  onMode: (next: ColorMode) => void
  onFamily: (next: ThemeFamily) => void
  settings: StyleSettings
  onStyle: (scope: StyleScope, entry: StyleEntry, persist: boolean) => Promise<{ ok: boolean; error?: string }>
}): ReactNode {
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState<StyleScope>('project')
  /** Editor buffer for the stylesheet, so typing does not restyle on every key. */
  const [draft, setDraft] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const rootRef = useDismissable(open, setOpen)
  const imageFileRef = useRef<HTMLInputElement>(null)
  const cssFileRef = useRef<HTMLInputElement>(null)

  // The buffer belongs to one scope; switching scope must show that scope's
  // stylesheet rather than carry the other one's text across.
  useEffect(() => { setDraft(null); setNote('') }, [scope])

  // The default scope is `project`, chosen before the host has said whether
  // there IS one. Outside a repository it has nothing to key by, so the menu
  // falls back rather than pointing every control at a scope that refuses
  // every write.
  useEffect(() => {
    if (settings.repoRoot === null) setScope('global')
  }, [settings.repoRoot])

  const entry = entryFor(settings, scope)
  const cssText = draft ?? entry.css

  /**
   * Apply a change to the scope being edited.
   * @param patch - the fields that changed.
   * @param persist - whether to store it; false previews without a file write.
   */
  const write = (patch: Partial<StyleEntry>, persist = true): void => {
    setNote('')
    void onStyle(scope, { ...entry, ...patch }, persist).then(result => {
      if (!result.ok) setNote(result.error ?? t('styleFailed'))
    })
  }

  /**
   * Resample a chosen image and store it.
   *
   * Downscaling in the browser is what keeps this practical: a phone photograph
   * is 4-6MB, far past what is worth carrying on every drawer open, and none of
   * that detail survives a blur anyway.
   * @param file - the picked file.
   */
  const takeImage = async (file: File): Promise<void> => {
    setNote(t('bgWorking'))
    try {
      const bitmap = await createImageBitmap(file)
      const scale = Math.min(1, IMAGE_MAX_EDGE / Math.max(bitmap.width, bitmap.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(bitmap.width * scale)
      canvas.height = Math.round(bitmap.height * scale)
      const context = canvas.getContext('2d')
      if (context === null) { setNote(t('bgFailed')); return }
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      bitmap.close()
      const url = canvas.toDataURL('image/jpeg', IMAGE_QUALITY)
      if (url.length > IMAGE_MAX_BYTES) { setNote(t('bgTooBig')); return }
      setNote('')
      write({ image: url })
    } catch {
      // A file the decoder refuses (corrupt, or an image codec this browser
      // lacks) is a user mistake, not a fault worth propagating.
      setNote(t('bgFailed'))
    }
  }

  const modeLabel: Record<ColorMode, string> = {
    system: t('modeSystem'), light: t('modeLight'), dark: t('modeDark'),
  }
  const modeChip: Record<ColorMode, string> = {
    system: css.chipSystem, light: css.chipLight, dark: css.chipDark,
  }
  const scopeLabel: Record<StyleScope, string> = {
    project: t('scopeProject'), global: t('scopeGlobal'),
  }
  const projectAvailable = settings.repoRoot !== null

  return (
    <div className={css.theme} ref={rootRef}>
      <button
        type="button"
        className={`${css.btn} ${css.btnIcon}`}
        aria-expanded={open}
        aria-label={t('settings')} title={t('settings')}
        onClick={() => setOpen(value => !value)}
      ><ChromeGlyph of="settings" /></button>
      {open ? (
        <div className={`${css.refPop} ${css.settingsPop}`} data-gs-part="settings">
          {/* The popover positions and clips; this is the padded body that
              scrolls inside it. Collapsing the two put every section flush
              against the card's edge. */}
          <div className={css.themeRail} data-gs-part="theme-rail">
          <div className={css.themeGroup}>
            <span className={css.themeLabel}>{t('themeMode')}</span>
            <div className={css.segmented} role="group" aria-label={t('themeMode')}>
              {COLOR_MODES.map(option => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={mode === option}
                  className={mode === option ? `${css.segment} ${css.segmentActive}` : css.segment}
                  onClick={() => onMode(option)}
                >
                  <span className={`${css.segmentChip} ${modeChip[option]}`} aria-hidden="true" />
                  {modeLabel[option]}
                </button>
              ))}
            </div>
          </div>

          <div className={css.themeGroup}>
            <span className={css.themeLabel}>{t('themePalette')}</span>
            {THEME_FAMILIES.map(option => (
              <button
                key={option.id}
                type="button"
                aria-pressed={family === option.id}
                className={family === option.id ? `${css.paletteRow} ${css.paletteRowActive}` : css.paletteRow}
                onClick={() => onFamily(option.id)}
              >
                <span className={css.swatch} aria-hidden="true">
                  {option.swatch.map(color => <span key={color} style={{ background: color }} />)}
                </span>
                {option.label}
              </button>
            ))}
          </div>

          <div className={css.themeGroup}>
            <span className={css.themeLabel}>{t('themeScope')}</span>
            <div className={css.scopeRow} role="group" aria-label={t('themeScope')}>
              {STYLE_SCOPES.map(option => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={scope === option}
                  disabled={option === 'project' && !projectAvailable}
                  className={scope === option ? `${css.scopeBtn} ${css.scopeBtnActive}` : css.scopeBtn}
                  onClick={() => setScope(option)}
                >{scopeLabel[option]}</button>
              ))}
            </div>
            <span className={css.scopeHint}>
              {scope === 'global' ? t('scopeGlobalHint')
                : projectAvailable ? settings.repoRoot
                  : t('scopeNoRepo')}
            </span>
          </div>

          <div className={css.themeGroup}>
            <span className={css.themeLabel}>{t('themeBackground')}</span>
            <div
              className={entry.image.length > 0 ? css.bgPreview : `${css.bgPreview} ${css.bgEmpty}`}
              style={entry.image.length > 0 ? { backgroundImage: `url("${entry.image}")` } : undefined}
            >{entry.image.length > 0 ? null : t('bgNone')}</div>
            <div className={css.themeRowSplit}>
              <button type="button" className={css.miniBtn} onClick={() => imageFileRef.current?.click()}>{t('bgChoose')}</button>
              {entry.image.length > 0
                ? <button type="button" className={css.miniBtn} onClick={() => write({ image: '' })}>{t('bgClear')}</button>
                : null}
            </div>
            <input
              ref={imageFileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={event => {
                const file = event.target.files?.[0]
                // Clearing the input is what lets the same file be picked twice
                // after a failure; a change event fires only on a NEW value.
                event.target.value = ''
                if (file !== undefined) void takeImage(file)
              }}
            />
            {entry.image.length > 0 ? (
              <>
                <label className={css.sliderRow}>
                  {t('bgBlur')}
                  <input
                    type="range" min={0} max={STYLE_BLUR_MAX} step={1} value={entry.blur}
                    onChange={event => write({ blur: Number(event.target.value) }, false)}
                    onPointerUp={() => write({})}
                    onKeyUp={() => write({})}
                  />
                  <span className={css.sliderValue}>{entry.blur}px</span>
                </label>
                <label className={css.sliderRow}>
                  {t('bgVeil')}
                  <input
                    type="range" min={0} max={100} step={1} value={entry.veil}
                    onChange={event => write({ veil: Number(event.target.value) }, false)}
                    onPointerUp={() => write({})}
                    onKeyUp={() => write({})}
                  />
                  <span className={css.sliderValue}>{entry.veil}%</span>
                </label>
              </>
            ) : null}
          </div>

          <div className={css.themeGroup}>
            <span className={css.themeLabel}>{t('themeCss')}</span>
            <textarea
              className={css.cssArea}
              spellCheck={false}
              placeholder={t('cssPlaceholder')}
              value={cssText}
              onChange={event => setDraft(event.target.value)}
            />
            <div className={css.themeRowSplit}>
              <button type="button" className={css.miniBtn} onClick={() => cssFileRef.current?.click()}>{t('cssImport')}</button>
              <button
                type="button"
                className={`${css.miniBtn} ${css.miniBtnPrimary}`}
                disabled={draft === null}
                onClick={() => { write({ css: cssText }); setDraft(null) }}
              >{t('cssApply')}</button>
            </div>
            <input
              ref={cssFileRef}
              type="file"
              accept=".css,text/css"
              hidden
              onChange={event => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file !== undefined) void file.text().then(text => setDraft(text))
              }}
            />
            {draft === null ? null : <span className={css.themeDirty}>{t('cssUnapplied')}</span>}
          </div>

            {note.length > 0 ? <span className={css.themeNote}>{note}</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

/**
 * Close a popover on the two gestures every user already expects: a click
 * outside it, and Escape. Both arrive on `document` rather than on the
 * popover's own subtree, so neither can be a handler on the element.
 * @param open - whether the popover is showing; nothing is bound while closed.
 * @param setOpen - the state setter, stable, so the effect binds once per open.
 * @returns the ref to put on the element that counts as "inside".
 */
function useDismissable(open: boolean, setOpen: Dispatch<SetStateAction<boolean>>): Ref<HTMLDivElement> {
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') setOpen(false) }
    // Bound on the next tick: the click that opened the popover is still
    // travelling, and would otherwise close it again immediately.
    const id = window.setTimeout(() => document.addEventListener('mousedown', onDown), 0)
    document.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(id)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, setOpen])
  return rootRef
}

/**
 * Ref picker built for a repository with hundreds of branches.
 *
 * A chip row cannot do this job — it grows without bound and gives every branch
 * the same weight — and a native select is no better once the list is long
 * enough to scroll past what anyone will read. This is the control git tooling
 * converges on instead: one button showing the current ref, opening a filter box
 * over a scrolling list.
 *
 * Two things make it useful before a character is typed. Branches arrive
 * most-recently-committed first, so the handful actually being worked on are at
 * the top; and those that have a worktree are grouped above the rest, because a
 * checked-out branch is the likeliest thing to want. Enter takes the first
 * match, so a distinctive substring plus Enter reaches any branch in the list.
 */
/** Sentinel ref meaning "walk every ref" — same string the host special-cases
 *  into `--all`. A real ref cannot begin with a dash, so it collides with
 *  nothing; defined separately on both halves (client bundles import no host
 *  values), tied by this comment and the probe. */
const ALL_REFS = '--all'

function RefPicker({ t, label, value, branches, worktreeBranches, truncated, onPick, allLabel }: {
  t: Translate
  label: string
  value: string
  branches: readonly string[]
  /** Branches that have a worktree — grouped first and marked. */
  worktreeBranches: readonly string[]
  /** Whether the host cut the branch list short. */
  truncated: boolean
  onPick: (ref: string) => void
  /** When set, an "all branches" entry is offered above the list and shown for
   *  the {@link ALL_REFS} sentinel — the history picker's answer to "search
   *  must not require knowing which branch holds the commit". */
  allLabel?: string
}): ReactNode {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useDismissable(open, setOpen)

  const needle = query.trim().toLowerCase()
  const matched = needle.length === 0 ? branches : branches.filter(ref => ref.toLowerCase().includes(needle))
  const checkedOut = matched.filter(ref => worktreeBranches.includes(ref))
  const rest = matched.filter(ref => !worktreeBranches.includes(ref))
  const first = checkedOut[0] ?? rest[0]

  const choose = (ref: string): void => {
    onPick(ref)
    setOpen(false)
    setQuery('')
  }

  const row = (ref: string, inWorktree: boolean): ReactNode => (
    <button
      key={ref}
      type="button"
      role="option"
      aria-selected={ref === value}
      className={ref === value ? `${css.refRow} ${css.refRowActive}` : css.refRow}
      title={ref}
      onClick={() => choose(ref)}
    >
      {inWorktree ? <WorktreeGlyph /> : <span className={css.refRowSpacer} />}
      <Elided text={ref} className={css.refRowName} />
    </button>
  )

  return (
    <div className={css.refPicker} ref={rootRef}>
      <span className={css.refLabel}>{label}</span>
      <button
        type="button"
        className={css.refButton}
        aria-expanded={open}
        title={value.length > 0 ? value : undefined}
        onClick={() => setOpen(isOpen => !isOpen)}
      >
        <Elided text={value === ALL_REFS && allLabel !== undefined ? allLabel : (value.length > 0 ? value : '—')} className={css.refValue} />
        <span className={css.refCaret}>▾</span>
      </button>
      {open ? (
        <div className={css.refPop}>
          <input
            className={css.refSearch}
            autoFocus
            value={query}
            placeholder={t('refSearch')}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter' && first !== undefined) choose(first) }}
          />
          <div className={css.refList} role="listbox" aria-label={label}>
            {allLabel !== undefined && (needle.length === 0 || allLabel.toLowerCase().includes(needle)) ? (
              <button
                type="button"
                role="option"
                aria-selected={value === ALL_REFS}
                className={value === ALL_REFS ? `${css.refRow} ${css.refRowActive}` : css.refRow}
                title={allLabel}
                onClick={() => choose(ALL_REFS)}
              >
                <span className={css.refRowSpacer} />
                <Elided text={allLabel} className={css.refRowName} />
              </button>
            ) : null}
            {checkedOut.length > 0 && rest.length > 0 ? <div className={css.refGroup}>{t('refWorktrees')}</div> : null}
            {checkedOut.map(ref => row(ref, true))}
            {checkedOut.length > 0 && rest.length > 0 ? <div className={css.refGroup}>{t('refBranches')}</div> : null}
            {rest.map(ref => row(ref, false))}
            {matched.length === 0 && !(allLabel !== undefined && needle.length > 0 && allLabel.toLowerCase().includes(needle)) ? <div className={css.refEmpty}>{t('refNone')}</div> : null}
          </div>
          <div className={css.refFoot}>
            {t('refCount', { shown: matched.length, total: branches.length })}
            {truncated ? ` · ${t('refTruncated')}` : ''}
          </div>
        </div>
      ) : null}
    </div>
  )
}

/**
 * Compare tab controls: the two refs, in reading order.
 *
 * Both sides list the same refs — comparing a branch against itself is possible
 * to express and simply reports nothing, which is clearer than hiding it.
 */
function CompareBar({ t, branches, worktreeBranches, truncated, baseRef, headRef, onBaseRef, onHeadRef }: {
  t: Translate
  branches: readonly string[]
  worktreeBranches: readonly string[]
  truncated: boolean
  baseRef: string
  headRef: string
  onBaseRef: (ref: string) => void
  onHeadRef: (ref: string) => void
}): ReactNode {
  if (branches.length === 0) return <div className={css.compareBar}>{t('noBranches')}</div>
  return (
    <div className={css.compareBar}>
      <RefPicker
        t={t} label={t('compareBase')} value={baseRef}
        branches={branches} worktreeBranches={worktreeBranches} truncated={truncated}
        onPick={onBaseRef}
      />
      <span className={css.compareArrow}>→</span>
      <RefPicker
        t={t} label={t('compareHead')} value={headRef}
        branches={branches} worktreeBranches={worktreeBranches} truncated={truncated}
        onPick={onHeadRef}
      />
    </div>
  )
}

/* ---------- write operations ---------- */

/**
 * Failures whose sentence is the whole story. Everything else shows git's own
 * text underneath, because the classification is a hint about what to do next
 * and the raw message is the evidence for it — when the hint is `unknown` it is
 * the only thing left that helps at all.
 *
 * These two are excluded because their detail is never informative and is often
 * actively misleading: git says nothing useful about an empty index, so what
 * lands in stderr is whatever a hook wrapper happened to print. A user reading
 * "nothing staged" followed by a lefthook config warning learns only that
 * something else is broken, which is not true.
 */
const SELF_EXPLANATORY: ReadonlySet<GitOpFailure> = new Set(['nothing-to-commit', 'no-upstream'])

/** What to tell the user about a finished operation. */
function opMessage(t: Translate, op: GitOpName, result: GitOpResult): string {
  if (result.ok) return t(`op.ok.${op}`)
  const failure = result.failure ?? 'unknown'
  const reason = t(`op.fail.${failure}`)
  if (SELF_EXPLANATORY.has(failure)) return reason
  const detail = (result.error ?? '').trim()
  return detail.length > 0 ? `${reason}\n${detail}` : reason
}

/**
 * Glyphs for the three network actions, on Primer's 16px grid.
 *
 * They sit BESIDE the labels rather than replacing them. The complaint that
 * started this was that Fetch/Pull/Push do not say what they do — icon-only
 * would answer it by removing the half that is unambiguous. What an icon adds
 * is recognition at a glance: down is work arriving, up is work leaving, and
 * the ring is the one that only reads a remote without changing anything here.
 */
const SYNC_GLYPH = {
  // Circular arrows: VS Code's and IDEA's shared sign for "refresh what I know
  // about the remote". Nothing in the working tree moves.
  fetch: 'M8 2.5a5.5 5.5 0 0 0-4.9 3 .75.75 0 0 1-1.34-.68A7 7 0 0 1 13.5 5.2V3.75a.75.75 0 0 1 1.5 0v3.5a.75.75 0 0 1-.75.75h-3.5a.75.75 0 0 1 0-1.5h1.86A5.5 5.5 0 0 0 8 2.5Zm-6.25 6a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5a.75.75 0 0 1 .75-.75Zm.75 1.5h3.5a.75.75 0 0 1 0 1.5H4.14A5.5 5.5 0 0 0 12.9 10.5a.75.75 0 0 1 1.34.68A7 7 0 0 1 2.5 10.8v-.05a.75.75 0 0 1 0-.75Z',
  // Down into a floor line: commits arriving from the remote onto this branch.
  pull: 'M8 1.75a.75.75 0 0 1 .75.75v6.44l2.22-2.22a.75.75 0 1 1 1.06 1.06l-3.5 3.5a.75.75 0 0 1-1.06 0l-3.5-3.5a.75.75 0 0 1 1.06-1.06l2.22 2.22V2.5A.75.75 0 0 1 8 1.75ZM2.75 12.5h10.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5Z',
  // Up off a floor line: the same arrow mirrored, because the pair only reads
  // as a direction if it is the same arrow.
  push: 'M7.47 1.97a.75.75 0 0 1 1.06 0l3.5 3.5a.75.75 0 0 1-1.06 1.06L8.75 4.31v6.44a.75.75 0 0 1-1.5 0V4.31L5.03 6.53a.75.75 0 0 1-1.06-1.06l3.5-3.5ZM2.75 12.5h10.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5Z',
} as const

function SyncGlyph({ of }: { of: keyof typeof SYNC_GLYPH }): ReactNode {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d={SYNC_GLYPH[of]} />
    </svg>
  )
}

/**
 * Filter this list: a magnifier, not the funnel above the commit list. The two
 * are deliberately different glyphs because they do different things — the
 * funnel asks git for a different set of commits, this only hides rows already
 * on screen — and the drawer shows both at once.
 */
function FilterGlyph(): ReactNode {
  return (
    <svg
      width="13" height="13" viewBox="0 0 16 16"
      fill="none" stroke="currentColor" strokeWidth="1.25"
      strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="7" cy="7" r="4" />
      <path d="M10 10l3.5 3.5" />
    </svg>
  )
}

/** Nothing folded. A constant so the filtered tree does not allocate a new Set
 *  on every render and re-run `TreeChildren`'s memo. */
const EMPTY_COLLAPSED: ReadonlySet<string> = new Set<string>()

/**
 * Roll back: the counter-clockwise arc every editor and VCS uses for undo,
 * drawn in the same New UI idiom as the node glyphs beside it — 16px grid,
 * 1px stroke, no fill — so the row does not mix an outlined file icon with a
 * solid action icon.
 */
function RollbackGlyph(): ReactNode {
  return (
    <svg
      width="14" height="14" viewBox="0 0 16 16"
      fill="none" stroke="currentColor" strokeWidth="1.25"
      strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* The arc, open at the upper left where the head goes. */}
      <path d="M3.5 6.5a5 5 0 1 0 1.9-2.2" />
      {/* The head: a corner, not a triangle — a filled arrowhead this small
          turns into a dot at 1x. */}
      <path d="M2.6 3.2v3.4h3.4" />
    </svg>
  )
}

const PULL_MODES = ['ff-only', 'rebase', 'merge'] as const
type PullMode = typeof PULL_MODES[number]

/** Each strategy's label key, so the trigger and the menu cannot disagree. */
const PULL_MODE_KEY: Record<PullMode, WorkbenchKey> = {
  'ff-only': 'pullFf',
  rebase: 'pullRebase',
  merge: 'pullMerge',
}

/**
 * Pull strategy, in the drawer's own menu idiom.
 *
 * This was a native `<select>`, justified as "a three-way choice used rarely".
 * The cost was not the frequency: a native popup paints in the OS palette, so
 * it was the one control in the drawer that ignored `data-gs-theme` — system
 * blue over Solarized, square corners in a row of pills. Reusing the ref
 * picker's button and popover makes it the same idiom as the drawer's other
 * menu rather than a second one.
 */
function SyncModePicker({ t, value, disabled, quiet, onPick }: {
  t: Translate
  value: PullMode
  disabled: boolean
  /** Disabled only by an operation too young to report: refuse, but do not dim. */
  quiet: boolean
  onPick: (mode: PullMode) => void
}): ReactNode {
  const [open, setOpen] = useState(false)
  const rootRef = useDismissable(open, setOpen)

  return (
    <div className={css.refPicker} ref={rootRef}>
      <button
        type="button"
        className={css.refButton}
        aria-expanded={open}
        aria-label={t('pullModeLabel')}
        disabled={disabled}
        data-quiet={quiet ? '' : undefined}
        onClick={() => setOpen(isOpen => !isOpen)}
      >
        <span className={`${css.elide} ${css.refValue}`}><span className={css.elideTail}>{t(PULL_MODE_KEY[value])}</span></span>
        <span className={css.refCaret}>▾</span>
      </button>
      {open ? (
        <div className={`${css.refPop} ${css.menuPop}`} role="listbox" aria-label={t('pullModeLabel')}>
          {PULL_MODES.map(pullMode => (
            <button
              key={pullMode}
              type="button"
              role="option"
              aria-selected={pullMode === value}
              className={pullMode === value ? `${css.refRow} ${css.refRowActive}` : css.refRow}
              onClick={() => { onPick(pullMode); setOpen(false) }}
            >{t(PULL_MODE_KEY[pullMode])}</button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/**
 * Whether an in-flight operation has run long enough to be worth showing.
 *
 * True only after `active` has held for `delay`, and then for at least `hold`
 * however quickly it ends — so a fast operation never paints, and a slow one
 * never blinks. See `op-feedback.ts` for why the appearance is paced and the
 * guard is not.
 */
function useSustained(active: boolean, delay = BUSY_DELAY_MS, hold = BUSY_HOLD_MS): boolean {
  const [shown, setShown] = useState(false)
  const shownAt = useRef(0)
  useEffect(() => {
    if (active === shown) return undefined
    const wait = active ? delay : holdRemaining(shownAt.current, Date.now(), hold)
    const id = setTimeout(() => {
      if (active) shownAt.current = Date.now()
      setShown(active)
    }, wait)
    return () => { clearTimeout(id) }
  }, [active, shown, delay, hold])
  return shown
}

/**
 * Fetch / pull / push, with the divergence they act on.
 *
 * Hidden entirely when the repository has no remote: three buttons that can only
 * fail are worse than no buttons. Pull carries its own strategy picker rather
 * than reading `pull.rebase`, so the button's label is what actually runs.
 *
 * The three used to be one grey pill each, distinguished by their word and a
 * 13px glyph — indistinguishable at a glance because they carried the same
 * amount of information, which was none. The counts have moved off the
 * divergence pills and INTO the two buttons that act on them, so the control
 * that can do something about the drift is also the one that reports it. Fetch
 * stays quiet in every state: it writes nothing, so it never has news.
 */
function SyncBar({ t, sync, busy, onOp }: {
  t: Translate
  sync: SyncStatus
  busy: GitOpName | null
  onOp: (op: GitOpName, payload?: GitOpPayload) => void
}): ReactNode {
  const [mode, setMode] = useState<PullMode>('ff-only')
  const running = busy !== null
  const noUpstream = sync.upstream === null
  // Every tick stages through git, so this bar was fading out and back on each
  // one. The buttons still refuse the click from the first frame; only saying
  // so waits until there is something worth saying.
  const sustained = useSustained(running)
  const quiet = quietlyDisabled(running, sustained, false)

  /** Push is the branch's first — the one case where it is the whole point of
   *  the bar, so it is the one case that gets the solid fill. */
  const pushClass = noUpstream ? `${css.btn} ${css.btnPrimary}`
    : sync.ahead > 0 ? `${css.btn} ${css.btnAhead}`
      : css.btn

  return (
    <div className={css.syncBar} role="group" aria-label={t('syncLabel')}>
      <span className={css.syncUpstream} title={sync.upstream ?? undefined}>
        {noUpstream ? t('noUpstream') : sync.upstream}
      </span>
      {sync.behind === 0 && sync.ahead === 0 && !noUpstream
        ? <span className={css.syncLevel}>{t('upToDate')}</span>
        : null}

      <span className={css.syncSpacer} />

      <button
        type="button" className={css.btn} disabled={running} data-quiet={quiet ? '' : undefined}
        onClick={() => onOp('fetch')}
      ><SyncGlyph of="fetch" />{busy === 'fetch' ? t('opRunning') : t('fetch')}</button>

      {/* The strategy is Pull's own argument, so it is welded to Pull. Loose
          between Fetch and Pull it read as a third peer action. */}
      <span className={css.pullGroup}>
        <SyncModePicker t={t} value={mode} disabled={running} quiet={quiet} onPick={setMode} />
        <button
          type="button"
          className={sync.behind > 0 ? `${css.btn} ${css.btnBehind}` : css.btn}
          disabled={running || noUpstream}
          // No upstream is a reason of Pull's own, so that dim stays put.
          data-quiet={quietlyDisabled(running, sustained, noUpstream) ? '' : undefined}
          title={noUpstream ? t('noUpstreamHint') : undefined}
          onClick={() => onOp('pull', { mode })}
        >
          <SyncGlyph of="pull" />
          {busy === 'pull' ? t('opRunning') : t('pull')}
          {sync.behind > 0 ? <span className={css.btnCount}>{sync.behind}</span> : null}
        </button>
      </span>

      <button
        type="button" className={pushClass} disabled={running} data-quiet={quiet ? '' : undefined}
        // The first push of a branch has no upstream yet — that is the case
        // `--set-upstream` exists for, so it must not be disabled here.
        title={noUpstream ? t('pushSetUpstream') : undefined}
        onClick={() => onOp('push')}
      >
        <SyncGlyph of="push" />
        {busy === 'push' ? t('opRunning') : noUpstream ? t('publish') : t('push')}
        {sync.ahead > 0 && !noUpstream ? <span className={css.btnCount}>{sync.ahead}</span> : null}
      </button>
    </div>
  )
}

/**
 * The commit box: a message, and what it would commit.
 *
 * Commit is disabled with nothing staged rather than quietly falling back to
 * committing the whole worktree. The drawer shows a staging area, and a button
 * that ignores it would make that display a lie.
 */
function CommitBox({ t, files, busy, onOp, message, onMessage, amend, onAmend }: {
  t: Translate
  files: readonly GitFile[]
  busy: GitOpName | null
  onOp: (op: GitOpName, payload?: GitOpPayload) => Promise<GitOpResult>
  /** Lifted to the panel: this box unmounts on a tab switch, the draft must not. */
  message: string
  onMessage: (next: string) => void
  amend: boolean
  onAmend: (next: boolean) => void
}): ReactNode {
  const setMessage = onMessage
  const setAmend = onAmend
  const stagedCount = files.filter(file => file.staged === true).length
  const running = busy !== null
  // Amending re-uses the previous commit, so it is the one case where an empty
  // index is still a legitimate commit (a message-only reword).
  const needsStaged = stagedCount === 0 && !amend
  const needsMessage = message.trim().length === 0
  const canCommit = !needsMessage && !needsStaged && !running
  // A disabled button that does not say why reads as broken; the staging half of
  // that is stated permanently by the lead line above, so only the message case
  // needs the title.
  const blocked = needsMessage ? t('commitNeedMessage') : undefined

  const commit = (): void => {
    if (!canCommit) return
    void onOp('commit', { message, amend }).then(result => {
      // Keep the message on failure: it is the user's text, and retyping a
      // commit message because the index was empty is a bad way to learn that.
      if (result.ok) { setMessage(''); setAmend(false) }
    })
  }

  return (
    <div className={css.commitBox}>
      {/* The one instruction the tick model needs, stated once where the action
          lives. A blocker that appears only when the index is empty reads as an
          error and arrives after the confusion it explains. */}
      <p className={css.commitLead} data-gs-part="commit-lead">{t('commitLead')}</p>
      <textarea
        className={css.commitMessage}
        value={message}
        rows={2}
        placeholder={t('commitPlaceholder')}
        aria-label={t('commitPlaceholder')}
        disabled={running}
        onChange={event => setMessage(event.target.value)}
        onKeyDown={event => {
          // Ctrl/Cmd+Enter commits, the shortcut every git client shares. Plain
          // Enter stays a newline: a commit body is normal and losing it to a
          // stray keystroke is not recoverable from the UI.
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); commit() }
        }}
      />
      <div className={css.commitRow}>
        <label className={css.commitAmend}>
          <input
            type="checkbox" checked={amend} disabled={running}
            onChange={event => setAmend(event.target.checked)}
          />
          {t('amend')}
        </label>
        <span className={css.commitStaged}>{t('stagedCount', { count: stagedCount })}</span>
        <button
          type="button"
          className={css.commitBtn}
          disabled={!canCommit}
          title={running ? undefined : blocked}
          onClick={commit}
        >{busy === 'commit' ? t('opRunning') : t('commit')}</button>
      </div>
    </div>
  )
}

/** Subject plus body, the text `git log` would print for `%B` without the trailing newline. */
function commitMessageText(commit: GitCommit): string {
  const body = commit.body ?? ''
  return body.length > 0 ? `${commit.subject}\n\n${body}` : commit.subject
}

function CopyCommitButton({ t, text }: { t: Translate; text: string }): ReactNode {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const id = window.setTimeout(() => setCopied(false), 1400)
    return () => { window.clearTimeout(id) }
  }, [copied])
  return (
    <button
      type="button"
      className={css.commitCopy}
      onMouseDown={event => event.preventDefault()}
      onClick={event => {
        event.stopPropagation()
        void navigator.clipboard.writeText(text).then(() => setCopied(true), () => setCopied(false))
      }}
    >{copied ? t('copiedCommit') : t('copyCommit')}</button>
  )
}

/**
 * One row in the history list. The subject stays one truncated line so the list
 * stays scannable; hovering opens a card with the full message, including a
 * multi-line body, which can be copied without selecting the commit.
 */
/* ---------- commit graph ---------- */

/** Row height the graph and the list agree on. The lines only join up if every
 *  row is exactly as tall as the segment drawn for it. */
const GRAPH_ROW_H = 48
/** Horizontal distance between lanes. */
const GRAPH_LANE_W = 14
/** Ref chips shown inline before the subject; the rest collapse into a "+N". */
const COMMIT_REF_CHIPS = 2
/** Lanes past this are not drawn. A repository can braid arbitrarily wide, and
 *  the diff is worth more than the twelfth simultaneous branch. */
const GRAPH_MAX_LANES = 6

const laneX = (lane: number): number => lane * GRAPH_LANE_W + GRAPH_LANE_W / 2

/**
 * One row's slice of the commit graph.
 *
 * Drawn as an SVG of exactly {@link GRAPH_ROW_H} pixels, so consecutive rows
 * butt together and a lane reads as one unbroken line down the list. The dot
 * sits at the vertical centre; edges leave the top edge, the dot, or the bottom
 * edge, and a cubic with its control points at the quarter heights gives the
 * S-curve every git client draws for a branch or a merge.
 */
function GraphCell({ row, width, active }: { row: GraphRow; width: number; active: boolean }): ReactNode {
  const lanes = Math.min(width, GRAPH_MAX_LANES)
  const w = lanes * GRAPH_LANE_W
  const mid = GRAPH_ROW_H / 2
  const visible = (lane: number): boolean => lane < GRAPH_MAX_LANES
  const stroke = (lane: number): string => `var(--gs-graph-${lane % 6})`

  const paths: ReactNode[] = []
  for (const lane of row.through) {
    if (!visible(lane)) continue
    paths.push(<path key={`t${lane}`} d={`M ${laneX(lane)} 0 V ${GRAPH_ROW_H}`} stroke={stroke(lane)} />)
  }
  for (const lane of row.into) {
    if (!visible(lane) || !visible(row.lane)) continue
    paths.push(lane === row.lane
      ? <path key={`i${lane}`} d={`M ${laneX(lane)} 0 V ${mid}`} stroke={stroke(lane)} />
      : (
        <path
          key={`i${lane}`}
          d={`M ${laneX(lane)} 0 C ${laneX(lane)} ${mid / 2}, ${laneX(row.lane)} ${mid / 2}, ${laneX(row.lane)} ${mid}`}
          stroke={stroke(lane)}
        />
      ))
  }
  for (const lane of row.outOf) {
    if (!visible(lane) || !visible(row.lane)) continue
    paths.push(lane === row.lane
      ? <path key={`o${lane}`} d={`M ${laneX(lane)} ${mid} V ${GRAPH_ROW_H}`} stroke={stroke(lane)} />
      : (
        <path
          key={`o${lane}`}
          d={`M ${laneX(row.lane)} ${mid} C ${laneX(row.lane)} ${mid + mid / 2}, ${laneX(lane)} ${mid + mid / 2}, ${laneX(lane)} ${GRAPH_ROW_H}`}
          stroke={stroke(lane)}
        />
      ))
  }

  return (
    <svg
      className={css.graphCell}
      width={w}
      height={GRAPH_ROW_H}
      viewBox={`0 0 ${w} ${GRAPH_ROW_H}`}
      aria-hidden="true"
      focusable="false"
    >
      <g fill="none" strokeWidth="1.6" strokeLinecap="round">{paths}</g>
      {visible(row.lane) ? (
        <circle
          cx={laneX(row.lane)}
          cy={mid}
          r={row.isMerge ? 4.5 : 3.5}
          // A merge is hollow, the way every git client distinguishes it: it is
          // a joining of lines rather than a change of its own.
          fill={row.isMerge ? 'var(--gs-panel)' : stroke(row.lane)}
          stroke={stroke(row.lane)}
          strokeWidth={row.isMerge ? 2 : active ? 3 : 0}
        />
      ) : null}
    </svg>
  )
}

function CommitRow({ t, commit, active, onSelect, graphRow, graphWidth }: {
  t: Translate
  commit: GitCommit
  active: boolean
  onSelect: (hash: string) => void
  /** This commit's lane geometry; absent while the graph is still empty. */
  graphRow?: GraphRow
  graphWidth: number
}): ReactNode {
  const rowRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [box, setBox] = useState<{ top: number; left: number; maxHeight: number } | null>(null)
  const enterTimer = useRef(0)
  const leaveTimer = useRef(0)
  const body = commit.body ?? ''
  const authorName = commit.authorName ?? ''
  const committerName = commit.committerName ?? ''
  // The viewer's own locale and timezone — that is the whole point of the line.
  const exactDate = formatCommitDate(commit.dateIso ?? '')

  const cancel = (): void => {
    window.clearTimeout(enterTimer.current)
    window.clearTimeout(leaveTimer.current)
  }
  const show = (): void => {
    cancel()
    enterTimer.current = window.setTimeout(() => setOpen(true), 360)
  }
  const hide = (): void => {
    cancel()
    leaveTimer.current = window.setTimeout(() => setOpen(false), 160)
  }

  useEffect(() => () => { cancel() }, [])

  useEffect(() => {
    if (!open) { setBox(null); return }
    const row = rowRef.current
    if (row === null) return
    const rect = row.getBoundingClientRect()
    const width = 380
    const left = Math.min(rect.right + 10, window.innerWidth - width - 12)
    const top = Math.max(12, Math.min(rect.top, window.innerHeight - 220))
    setBox({ top, left: Math.max(12, left), maxHeight: window.innerHeight - top - 16 })
  }, [open])

  const host = rowRef.current?.closest('[data-gs-part="overlay"]') ?? (typeof document === 'undefined' ? null : document.body)

  const refs = commit.refs ?? []

  return (
    <>
      {/* The graph is a SIBLING of the row button, spanning the line's full
          height with no margin of its own — that is what lets a lane run
          unbroken from one row into the next while the button itself keeps its
          inset and its rounded corners. */}
      <div className={css.commitLine}>
        {graphRow !== undefined
          ? <GraphCell row={graphRow} width={graphWidth} active={active} />
          : null}
        <button
          ref={rowRef}
          type="button"
          role="option"
          aria-selected={active}
          className={active ? `${css.commit} ${css.commitActive}` : css.commit}
          onClick={() => onSelect(commit.hash)}
          onMouseEnter={show}
          onMouseLeave={hide}
        >
          <span className={css.commitTop}>
            <code className={css.commitHash}>{commit.hash}</code>
            {authorName.length > 0 ? <span className={css.commitAuthor}>{authorName}</span> : null}
            <span className={css.commitWhen}>{commit.when}</span>
          </span>
          <span className={css.commitSubjectRow}>
            {/* Capped at two. A release commit can carry six refs, and the
                subject is what the row is actually for — the rest are counted
                and named in the title rather than crowding it out. */}
            {refs.slice(0, COMMIT_REF_CHIPS).map(ref => (
              <span key={ref} className={css.commitRef} title={ref}>{ref}</span>
            ))}
            {refs.length > COMMIT_REF_CHIPS ? (
              <span className={css.commitRefMore} title={refs.slice(COMMIT_REF_CHIPS).join('\n')}>
                +{refs.length - COMMIT_REF_CHIPS}
              </span>
            ) : null}
            <span className={css.commitSubject}>{commit.subject}</span>
            {body.length > 0 ? <span className={css.commitHasBody} aria-hidden="true">···</span> : null}
          </span>
        </button>
      </div>
      {open && box !== null && host !== null ? createPortal(
        <div
          className={css.commitPop}
          style={{ top: box.top, left: box.left, maxHeight: box.maxHeight }}
          onMouseEnter={() => { cancel(); setOpen(true) }}
          onMouseLeave={hide}
          onClick={event => event.stopPropagation()}
        >
          <div className={css.commitPopTop}>
            <code className={css.commitHash}>{commit.hash}</code>
            <span className={css.commitWhen}>{commit.when}</span>
            <CopyCommitButton t={t} text={commitMessageText(commit)} />
          </div>
          {/* Who and exactly when. The row summarizes ("3 weeks ago"); the
              hover card is where the precise question gets a precise answer —
              full date in the VIEWER's timezone, author, and the committer
              whenever git recorded someone other than the author. */}
          {authorName.length > 0 || committerName.length > 0 || exactDate.length > 0 ? (
            <div className={css.commitPopMeta}>
              {authorName.length > 0 ? <span>{t('commitAuthor')}: {authorName}</span> : null}
              {committerName.length > 0 && committerName !== authorName ? (
                <span>{t('commitCommitter')}: {committerName}</span>
              ) : null}
              {exactDate.length > 0 ? <span>{t('commitDate')}: {exactDate}</span> : null}
            </div>
          ) : null}
          <div className={css.commitPopSubject}>{commit.subject}</div>
          {body.length > 0 ? <pre className={css.commitPopBody}>{body}</pre> : null}
        </div>,
        host,
      ) : null}
    </>
  )
}

/** The filter's own calendar — a hand-rolled 6×7 Monday-first grid (pure
 *  arithmetic in `calendar.ts`), because the native date input renders as the
 *  platform's bare widget and the bundle's purity gate forbids pulling in a
 *  library. Picking a day hands `yyyy-mm-dd` to the bound the segmented
 *  control armed; the host expands it to the whole day. */
function FilterCalendar({ year, month, after, before, locale, onPick, onShift }: {
  year: number
  month: number
  /** Current bounds, to mark the picked days (approxidate text never matches
   *  an iso, so a preset like "1 week ago" simply marks nothing). */
  after: string
  before: string
  /** BCP-47 tag from the drawer's own dictionary (`filterLocale`), NOT the
   *  browser's — those disagree the moment the UI language is not the OS one,
   *  and the grid printed its month in the other language. */
  locale: string
  onPick: (iso: string) => void
  onShift: (deltaMonths: number) => void
}): ReactNode {
  const grid = monthGrid(year, month, localTodayIso())
  const title = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long' }).format(new Date(year, month, 1))
  return (
    <div className={css.cal}>
      <div className={css.calHead}>
        <button type="button" className={css.calNav} aria-label="‹" onClick={() => onShift(-1)}>‹</button>
        <span className={css.calTitle}>{title}</span>
        <button type="button" className={css.calNav} aria-label="›" onClick={() => onShift(1)}>›</button>
      </div>
      <div className={css.calWeek}>
        {weekdayLabels(locale).map((label, index) => <span key={index}>{label}</span>)}
      </div>
      <div className={css.calGrid}>
        {grid.flat().map(cell => cell === null ? null : (
          <button
            key={cell.iso}
            type="button"
            aria-label={cell.iso}
            title={cell.iso}
            className={[
              cell.inMonth ? '' : css.calOut,
              cell.isToday ? css.calToday : '',
              // Between the bounds, not one of them: the two endpoints alone
              // never showed which days the filter actually admits. Both
              // bounds are iso here or the comparison is simply false, which
              // is what an approxidate preset should render as.
              inCalRange(cell.iso, after, before) ? css.calIn : '',
              cell.iso === after || cell.iso === before ? css.calMark : '',
            ].filter(cls => cls.length > 0).join(' ')}
            onClick={() => onPick(cell.iso)}
          ><span>{cell.day}</span></button>
        ))}
      </div>
    </div>
  )
}

/** Files shown per expanded directory. The search box is the way to a file in
 *  a crowded directory; the tree shows enough to browse without flooding the
 *  list, and says so when it cut the tail. */
const PATH_FILES_SHOWN = 100

/** Horizontal step per nesting level in the path picker. The whole indent now
 *  comes from this one number: `.pathChildren` used to add a margin and a rail
 *  of its own on top of it, so every level cost 29px and a 320px popover ran
 *  out of width three directories deep. */
const PATH_INDENT = 14

/** One level of the path picker's directory tree — directories (chevron,
 *  subtree count) then their files (doc glyph, leaf rows). Collapsed subtrees
 *  are not in the DOM at all, so a monorepo costs only what the reader has
 *  opened. */
/** A checkbox that also carries the tree's third state — `indeterminate` is a
 *  DOM property, not an attribute, so it is set through the ref. */
function TriStateCheckbox({ state, onChange, ariaLabel }: {
  state: 'on' | 'off' | 'partial'
  onChange: () => void
  ariaLabel: string
}): ReactNode {
  return (
    <input
      type="checkbox"
      aria-label={ariaLabel}
      checked={state === 'on'}
      ref={el => { if (el !== null) el.indeterminate = state === 'partial' }}
      onChange={onChange}
    />
  )
}

function PathTreeRows({ dirs, depth, expanded, stateOf, onToggleOpen, onTogglePath }: {
  dirs: readonly DirEntry[]
  depth: number
  expanded: readonly string[]
  /** Derived on/partial/off for any row path — the single source of truth. */
  stateOf: (path: string) => 'on' | 'off' | 'partial'
  onToggleOpen: (path: string) => void
  onTogglePath: (path: string) => void
}): ReactNode {
  return (
    <>
      {dirs.map(dir => {
        const open = expanded.includes(dir.path)
        const expandable = dir.children.length > 0 || dir.files.length > 0
        const shown = dir.files.slice(0, PATH_FILES_SHOWN)
        return (
          <div key={dir.path} className={css.pathNode}>
            <div className={css.funnelRow} style={{ paddingLeft: depth * PATH_INDENT + 4 }}>
              <button
                type="button"
                className={css.funnelChevron}
                disabled={!expandable}
                aria-expanded={open}
                onClick={() => onToggleOpen(dir.path)}
              >{expandable ? (open ? '▾' : '▸') : ''}</button>
              <TriStateCheckbox state={stateOf(dir.path)} ariaLabel={dir.path} onChange={() => onTogglePath(dir.path)} />
              <PathDirGlyph />
              <span className={css.funnelName} title={dir.path}>{dir.name}</span>
              <span className={css.funnelCount}>{dir.fileCount}</span>
            </div>
            {open ? (
              <div className={css.pathChildren}>
                <PathTreeRows
                  dirs={dir.children}
                  depth={depth + 1}
                  expanded={expanded}
                  stateOf={stateOf}
                  onToggleOpen={onToggleOpen}
                  onTogglePath={onTogglePath}
                />
                {shown.map(file => (
                  <label key={file} className={css.funnelRow} style={{ paddingLeft: (depth + 1) * PATH_INDENT + 4 }}>
                    <span className={css.funnelChevron} aria-hidden="true" />
                    <TriStateCheckbox state={stateOf(`${dir.path}/${file}`)} ariaLabel={`${dir.path}/${file}`} onChange={() => onTogglePath(`${dir.path}/${file}`)} />
                    <PathFileGlyph path={`${dir.path}/${file}`} />
                    <span className={css.funnelName} title={`${dir.path}/${file}`}>{file}</span>
                  </label>
                ))}
                {dir.files.length > PATH_FILES_SHOWN ? (
                  <div className={css.funnelMore}>+{dir.files.length - PATH_FILES_SHOWN}</div>
                ) : null}
              </div>
            ) : null}
          </div>
        )
      })}
    </>
  )
}

/**
 * The commit log as its own full-height pane.
 *
 * It sits BESIDE the file tree rather than stacked above it, which is what
 * GitHub Desktop, the JetBrains git log and GitKraken all do: a commit list and
 * the selected commit's files are peer panes, each with its own scrollbar. The
 * earlier stacked layout had to be collapsible because two scrolling lists were
 * sharing one narrow column — a control that hid the thing you were reading and
 * that nobody could be expected to discover. Side by side, there is nothing to
 * collapse and nothing to explain.
 *
 * Pages load by scrolling. A button at the end of a growing list is the worst
 * of both worlds — it retreats every time it is used, and it asks the reader to
 * confirm an intention that scrolling toward the end already stated. A sentinel
 * below the last row requests the next page as it comes into view, which is
 * what GitHub and GitLens do. The observer is rebuilt whenever the list grows,
 * so a page too short to fill the pane immediately triggers the next one.
 */
function CommitList({ paneRef, style, t, loading, commits, active, onSelect, hasMore, loadingMore, onLoadMore, query, onQueryChange, error, statsPath, refName, fetchAuthors, fetchRepoTree }: {
  /** The pane element, which the divider beside it measures from. Not named
   *  `ref`: React reserves that on a function component, so it would be stripped
   *  from props and never reach this element. */
  paneRef: Ref<HTMLDivElement>
  /** Dragged width, when the divider has been used. */
  style: CSSProperties | undefined
  t: Translate
  /** First page in flight — the pane says "loading", not "no history", which
   *  would be a claim about the repository the data has not made. */
  loading: boolean
  commits: readonly GitCommit[]
  active: string | null
  onSelect: (hash: string) => void
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
  /** The filter box's text. Parsed here for chips; the parent debounces the
   *  same parse into the server-side fetch. */
  query: string
  onQueryChange: (query: string) => void
  /** git's complaint when the log itself failed (bad pattern/date), verbatim. */
  error: string | null
  /** Which tree the author roster counts — the drawer's current source. */
  statsPath: string | undefined
  /** Which ref the roster and the list both walk — the picker's people are the
   *  list's people, so a tick can never name someone with nothing to show. */
  refName: string
  fetchAuthors: (worktreePath: string | undefined, ref: string, signal: AbortSignal) => Promise<{ authors: readonly AuthorEntry[]; truncated: boolean } | null>
  fetchRepoTree: (worktreePath: string | undefined, signal: AbortSignal) => Promise<{ paths: string[]; truncated: boolean } | null>
}): ReactNode {
  const scrollRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  // One grammar, one filter: chips are the parsed criteria, and removing one
  // rewrites the box through that same grammar.
  const filterModel = useMemo(() => parseLogQuery(query), [query])
  const chips = chipsFromFilter(filterModel)
  // What the panel is currently asking git for. Each tab shows its own share
  // so the two sections nobody is looking at still say they hold something,
  // and the footer shows the total — the chip row that used to be the only
  // feedback sits BEHIND the popup, so the ticks looked inert until it closed.
  // A date bound counts as one criterion each; free text is the box's, not
  // the popup's, so it stays out of both.
  const dateCount = (filterModel.after.length > 0 ? 1 : 0) + (filterModel.before.length > 0 ? 1 : 0)
  const selectedCount = filterModel.users.length + filterModel.paths.length + dateCount

  // ---- funnel popup: user picker + date bounds + path tree --------------
  const [funnelOpen, setFunnelOpen] = useState(false)
  const [authors, setAuthors] = useState<{ authors: readonly AuthorEntry[]; truncated: boolean } | null>(null)
  const [authorsQuery, setAuthorsQuery] = useState('')
  const [pathTree, setPathTree] = useState<{ dirs: readonly DirEntry[]; paths: readonly string[]; truncated: boolean } | null>(null)
  const [expandedDirs, setExpandedDirs] = useState<readonly string[]>([])
  const [pathsQuery, setPathsQuery] = useState('')
  // The popup shows ONE section at a time (tabs), so a roster of dozens
  // cannot grow the panel past the paths section — every section is reachable
  // in one click whatever the others hold.
  const [funnelSection, setFunnelSection] = useState<'users' | 'date' | 'paths'>('users')
  // The calendar's displayed month, and which bound a picked day lands in.
  const [calMonth, setCalMonth] = useState(() => { const now = new Date(); return { year: now.getFullYear(), month: now.getMonth() } })
  const [calBound, setCalBound] = useState<'after' | 'before'>('after')

  // The panel is PORTALLED to the drawer overlay (position: fixed, clamped to
  // the viewport — the commits pane can be narrower than the panel, and an
  // absolute panel anchored at its right edge runs off-screen). Dismissal
  // therefore checks TWO refs: the anchor button and the panel itself; a
  // single useDismissable root would see every click inside the portalled
  // panel as "outside" and close it out from under the click.
  const funnelAnchorRef = useRef<HTMLDivElement>(null)
  const funnelPanelRef = useRef<HTMLDivElement>(null)
  const [funnelBox, setFunnelBox] = useState<{ top: number; left: number; maxHeight: number } | null>(null)

  useEffect(() => {
    if (!funnelOpen) { setFunnelBox(null); return }
    const onDown = (event: MouseEvent): void => {
      const target = event.target as Node
      if (funnelAnchorRef.current?.contains(target) === true) return
      if (funnelPanelRef.current?.contains(target) === true) return
      setFunnelOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') setFunnelOpen(false) }
    // Bound on the next tick: the opening click is still travelling.
    const id = window.setTimeout(() => document.addEventListener('mousedown', onDown), 0)
    document.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(id)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [funnelOpen])

  useEffect(() => {
    if (!funnelOpen) return
    const rect = funnelAnchorRef.current?.getBoundingClientRect()
    if (rect === undefined) return
    const width = 300
    const left = Math.max(12, Math.min(rect.left + rect.width - width, window.innerWidth - width - 12))
    const top = rect.bottom + 4
    setFunnelBox({ top, left, maxHeight: Math.max(160, window.innerHeight - top - 16) })
  }, [funnelOpen])

  // The roster and the tree are fetched when the funnel OPENS (not when the
  // pane mounts — most visits never filter) and again when the source or the
  // ref moves: the roster counts the very history the list walks, so the two
  // can never disagree about who has commits.
  useEffect(() => {
    if (!funnelOpen) return
    const ctrl = new AbortController()
    setAuthors(null)
    setPathTree(null)
    fetchAuthors(statsPath, refName, ctrl.signal).then(roster => {
      if (!ctrl.signal.aborted) setAuthors(roster)
    }).catch(() => {})
    fetchRepoTree(statsPath, ctrl.signal).then(tree => {
      if (!ctrl.signal.aborted && tree !== null) {
        setPathTree({ dirs: buildDirTree(tree.paths), paths: tree.paths, truncated: tree.truncated })
      }
    }).catch(() => {})
    return () => { ctrl.abort() }
  }, [funnelOpen, statsPath, refName, fetchAuthors, fetchRepoTree])

  // Where the popover mounts: the drawer's overlay layer when there is one,
  // the body otherwise. Same resolution the commit-row popover does, and the
  // render below skips the portal when neither exists rather than handing
  // createPortal a null container.
  const funnelHost = funnelAnchorRef.current?.closest('[data-gs-part="overlay"]') ?? (typeof document === 'undefined' ? null : document.body)

  /** Every funnel interaction writes the filter through the box's grammar, so
   *  the box, the chips and the fetch can never disagree about the query. */
  const applyFilter = (next: LogFilter): void => { onQueryChange(serializeLogQuery(next)) }
  const toggleUser = (name: string): void => {
    const has = filterModel.users.includes(name)
    applyFilter({
      ...filterModel,
      users: has ? filterModel.users.filter(user => user !== name) : [...filterModel.users, name],
    })
  }
  // Checkbox-tree semantics: ticking a folder covers its subtree (and absorbs
  // the files already ticked inside it); unticking a file under a checked
  // folder cascades out. Rows DERIVE their state — on/partial/off — from the
  // set, so a folder tick visibly checks everything under it.
  const pathIndex = useMemo(
    () => (pathTree === null ? null : buildIndex(pathTree.paths)),
    [pathTree],
  )
  const pathState = (path: string): 'on' | 'off' | 'partial' =>
    pathIndex === null ? 'off' : checkedState(filterModel.paths, path, pathIndex)
  const togglePath = (path: string): void => {
    if (pathIndex === null) return
    applyFilter({
      ...filterModel,
      paths: isCovered(filterModel.paths, path)
        ? removePath(filterModel.paths, path, pathIndex)
        : addPath(filterModel.paths, path),
    })
  }
  const toggleDirOpen = (path: string): void => {
    setExpandedDirs(prev => prev.includes(path) ? prev.filter(p => p !== path) : [...prev, path])
  }
  const needle = authorsQuery.trim().toLowerCase()
  const matchedAuthors = authors === null
    ? []
    : needle.length === 0
      ? authors.authors
      : authors.authors.filter(entry =>
        entry.name.toLowerCase().includes(needle) || entry.email.toLowerCase().includes(needle))
  const DATE_PRESETS: readonly { key: WorkbenchKey; value: string }[] = [
    { key: 'filterToday', value: 'midnight' },
    { key: 'filterLast7', value: '1 week ago' },
    { key: 'filterLast30', value: '30 days ago' },
  ]
  // Recomputed only when a page lands. The layout is a single pass over the
  // loaded prefix, and every row's geometry depends on the rows above it, so
  // there is nothing finer to memoise than the whole list.
  //
  // Filtering does not suspend the graph: the server returns one contiguous
  // walk of the FILTERED log, so lanes stay truthful — unlike a client-side
  // filter, which would break the very walk it draws from.
  const graph = useMemo(
    () => layoutGraph(commits.map(commit => ({ hash: commit.hash, parents: commit.parents ?? [] }))),
    [commits],
  )

  useEffect(() => {
    const root = scrollRef.current
    const sentinel = sentinelRef.current
    if (root === null || sentinel === null || !hasMore || loadingMore) return
    const observer = new IntersectionObserver(
      entries => { if (entries.some(entry => entry.isIntersecting)) onLoadMore() },
      // Start the fetch before the sentinel is actually reached, so the next
      // page is usually there by the time the reader arrives.
      { root, rootMargin: '300px' },
    )
    observer.observe(sentinel)
    return () => { observer.disconnect() }
  }, [hasMore, loadingMore, commits.length, onLoadMore])

  return (
    <div ref={paneRef} className={css.commitsPane} style={style} data-gs-part="commits">
      {/* No count: the only number available is how many pages have been loaded,
          which is not how many commits exist. A number that cannot be right is
          worse than none. */}
      <div className={css.paneHead}>
        <span className={css.paneTitle}>{t('historyLabel')}</span>
        <div className={css.funnel} ref={funnelAnchorRef}>
          <button
            type="button"
            className={funnelOpen || chips.length > 0 ? `${css.funnelButton} ${css.funnelButtonActive}` : css.funnelButton}
            aria-expanded={funnelOpen}
            onClick={() => setFunnelOpen(isOpen => !isOpen)}
          >{t('filterBy')} ▾</button>
        </div>
        <input
          className={css.commitFilter}
          type="search"
          value={query}
          onChange={event => onQueryChange(event.target.value)}
          placeholder={t('historyFilterPlaceholder')}
          aria-label={t('historyFilterPlaceholder')}
          spellCheck={false}
        />
      </div>
      {funnelOpen && funnelBox !== null && funnelHost !== null ? createPortal(
        <div
          ref={funnelPanelRef}
          className={css.funnelPop}
          style={funnelBox}
          role="dialog"
          aria-label={t('filterBy')}
        >
          {/* One section at a time: a roster of dozens cannot grow the panel
              past the other sections, and each tab carries its own active
              count so the criteria are visible without visiting the tab. */}
          <div className={css.funnelTabs} role="tablist">
            <button
              type="button" role="tab" aria-selected={funnelSection === 'users'}
              className={funnelSection === 'users' ? `${css.funnelTab} ${css.funnelTabActive}` : css.funnelTab}
              onClick={() => setFunnelSection('users')}
            >
              {t('filterUsers')}
              {filterModel.users.length > 0 ? <span className={css.funnelTabCount}>{filterModel.users.length}</span> : null}
            </button>
            <button
              type="button" role="tab" aria-selected={funnelSection === 'date'}
              className={funnelSection === 'date' ? `${css.funnelTab} ${css.funnelTabActive}` : css.funnelTab}
              onClick={() => setFunnelSection('date')}
            >
              {t('filterDate')}
              {dateCount > 0 ? <span className={css.funnelTabCount}>{dateCount}</span> : null}
            </button>
            <button
              type="button" role="tab" aria-selected={funnelSection === 'paths'}
              className={funnelSection === 'paths' ? `${css.funnelTab} ${css.funnelTabActive}` : css.funnelTab}
              onClick={() => setFunnelSection('paths')}
            >
              {t('filterPaths')}
              {filterModel.paths.length > 0 ? <span className={css.funnelTabCount}>{filterModel.paths.length}</span> : null}
            </button>
          </div>
          {funnelSection === 'users' ? (
            <div className={css.funnelPane}>
              <input
                className={css.funnelSearch}
                type="search"
                value={authorsQuery}
                onChange={event => setAuthorsQuery(event.target.value)}
                placeholder={t('filterUserSearch')}
                aria-label={t('filterUserSearch')}
                spellCheck={false}
              />
              <div className={css.funnelList}>
                {authors === null ? (
                  <div className={css.funnelMore}>{t('loading')}</div>
                ) : matchedAuthors.length === 0 ? (
                  <div className={css.funnelMore}>{authors.authors.length === 0 ? t('noCommits') : t('historyNoMatch')}</div>
                ) : matchedAuthors.map(entry => (
                  <label key={`${entry.name}\x1f${entry.email}`} className={css.funnelRow}>
                    <input
                      type="checkbox"
                      checked={filterModel.users.includes(entry.name)}
                      onChange={() => toggleUser(entry.name)}
                    />
                    <span className={css.funnelName} title={`${entry.name} <${entry.email}>`}>{entry.name}</span>
                    <span className={css.funnelCount}>{entry.count}</span>
                  </label>
                ))}
                {authors?.truncated === true ? (
                  <div className={css.funnelMore}>{t('filterAuthorsMore')}</div>
                ) : null}
              </div>
            </div>
          ) : null}
          {funnelSection === 'date' ? (
            <div className={css.funnelPane}>
              <div className={css.funnelPresets}>
                {DATE_PRESETS.map(preset => (
                  <button
                    key={preset.key}
                    type="button"
                    className={filterModel.after === preset.value ? `${css.funnelPreset} ${css.funnelPresetActive}` : css.funnelPreset}
                    onClick={() => applyFilter({ ...filterModel, after: filterModel.after === preset.value ? '' : preset.value })}
                  >{t(preset.key)}</button>
                ))}
              </div>
              {/* Which bound a picked day lands in — the calendar is one, the
                  range is two picks apart. Captioned, and shaped as a rect
                  track rather than the tab strip's pills: two identical pill
                  rows six pixels apart never said they meant different
                  things. */}
              <span className={css.funnelCaption}>{t('filterCalendarSets')}</span>
              <div className={css.funnelBounds} role="group" aria-label={t('filterCalendarSets')}>
                <button
                  type="button"
                  aria-pressed={calBound === 'after'}
                  className={calBound === 'after' ? `${css.funnelBoundBtn} ${css.funnelBoundBtnActive}` : css.funnelBoundBtn}
                  onClick={() => setCalBound('after')}
                >{t('filterAfter')}</button>
                <button
                  type="button"
                  aria-pressed={calBound === 'before'}
                  className={calBound === 'before' ? `${css.funnelBoundBtn} ${css.funnelBoundBtnActive}` : css.funnelBoundBtn}
                  onClick={() => setCalBound('before')}
                >{t('filterBefore')}</button>
              </div>
              <FilterCalendar
                year={calMonth.year}
                month={calMonth.month}
                after={filterModel.after}
                before={filterModel.before}
                locale={t('filterLocale')}
                onPick={iso => applyFilter({ ...filterModel, [calBound]: iso })}
                onShift={delta => setCalMonth(current => {
                  const next = new Date(current.year, current.month + delta, 1)
                  return { year: next.getFullYear(), month: next.getMonth() }
                })}
              />
              <div className={css.funnelBoundRows}>
                <span className={css.funnelBoundRow}>
                  <span className={css.funnelBoundKey}>{t('filterAfter')}</span>
                  <span className={filterModel.after.length > 0 ? `${css.funnelBoundVal} ${css.funnelBoundValSet}` : css.funnelBoundVal}>
                    {filterModel.after.length > 0 ? filterModel.after : '—'}
                  </span>
                  {filterModel.after.length > 0 ? (
                    <button type="button" className={css.funnelBoundClear} aria-label={t('filterAfter')} onClick={() => applyFilter({ ...filterModel, after: '' })}>×</button>
                  ) : null}
                </span>
                <span className={css.funnelBoundRow}>
                  <span className={css.funnelBoundKey}>{t('filterBefore')}</span>
                  <span className={filterModel.before.length > 0 ? `${css.funnelBoundVal} ${css.funnelBoundValSet}` : css.funnelBoundVal}>
                    {filterModel.before.length > 0 ? filterModel.before : '—'}
                  </span>
                  {filterModel.before.length > 0 ? (
                    <button type="button" className={css.funnelBoundClear} aria-label={t('filterBefore')} onClick={() => applyFilter({ ...filterModel, before: '' })}>×</button>
                  ) : null}
                </span>
              </div>
            </div>
          ) : null}
          {funnelSection === 'paths' ? (
            <div className={css.funnelPane}>
              <input
                className={css.funnelSearch}
                type="search"
                value={pathsQuery}
                onChange={event => setPathsQuery(event.target.value)}
                placeholder={t('filterPathSearch')}
                aria-label={t('filterPathSearch')}
                spellCheck={false}
              />
              <div className={css.funnelList}>
                {pathTree === null ? (
                  <div className={css.funnelMore}>{t('loading')}</div>
                ) : pathsQuery.trim().length > 0 ? (
                  /* Search results are FLAT — the honest shape for hits (same
                     argument as the filtered commit list), each row ticking a
                     pathspec directly: files first, then directories. */
                  (() => {
                    const hits = searchPaths(pathTree.paths, pathsQuery).slice(0, 200)
                    if (hits.length === 0) return <div className={css.funnelMore}>{t('historyNoMatch')}</div>
                    return (
                      <>
                        {hits.map(hit => (
                          <label key={hit.path} className={css.funnelRow}>
                            <TriStateCheckbox state={pathState(hit.path)} ariaLabel={hit.path} onChange={() => togglePath(hit.path)} />
                            {hit.isFile ? <PathFileGlyph path={hit.path} /> : <PathDirGlyph />}
                            <span className={css.funnelName} title={hit.path}>{hit.path}</span>
                          </label>
                        ))}
                        {searchPaths(pathTree.paths, pathsQuery).length > 200 ? (
                          <div className={css.funnelMore}>{t('filterPathsMore')}</div>
                        ) : null}
                      </>
                    )
                  })()
                ) : pathTree.dirs.length === 0 ? (
                  <div className={css.funnelMore}>{t('noCommits')}</div>
                ) : (
                  <PathTreeRows
                    dirs={pathTree.dirs}
                    depth={0}
                    expanded={expandedDirs}
                    stateOf={pathState}
                    onToggleOpen={toggleDirOpen}
                    onTogglePath={togglePath}
                  />
                )}
                {pathTree?.truncated === true ? (
                  <div className={css.funnelMore}>{t('filterPathsMore')}</div>
                ) : null}
              </div>
            </div>
          ) : null}
          {/* The panel's own readout. Clearing goes through the box's grammar
              like every other funnel interaction, so one query string stays
              the single source of truth. */}
          <div className={css.funnelFoot}>
            <span className={selectedCount > 0 ? `${css.funnelFootCount} ${css.funnelFootCountOn}` : css.funnelFootCount}>
              {t('filterSelected', { count: selectedCount })}
            </span>
            <button
              type="button"
              className={css.funnelFootClear}
              disabled={selectedCount === 0}
              onClick={() => onQueryChange('')}
            >{t('filterClearAll')}</button>
          </div>
        </div>,
        funnelHost,
      ) : null}
      {chips.length > 0 ? (
        <div className={css.filterChips}>
          {chips.map(chip => (
            <span key={`${chip.kind}\x1f${chip.value}`} className={css.filterChip}>
              <span className={css.filterChipLabel}>{chip.kind}:{chip.value}</span>
              <button
                type="button"
                className={css.filterChipRemove}
                aria-label={`${chip.kind} ${chip.value}`}
                onClick={() => onQueryChange(serializeLogQuery(removeChip(filterModel, chip.kind, chip.value)))}
              >×</button>
            </span>
          ))}
          <button type="button" className={css.filterClear} onClick={() => onQueryChange('')}>{t('filterClearAll')}</button>
        </div>
      ) : null}
      {commits.length === 0 ? (
        <div className={css.empty}>
          {loading ? t('loading') : error !== null ? error : chips.length > 0 ? t('historyNoMatch') : t('noCommits')}
        </div>
      ) : (
        <div className={css.commits} role="listbox" aria-label={t('historyLabel')} ref={scrollRef}>
          {commits.map((commit, index) => (
            <CommitRow
              key={commit.hash}
              t={t}
              commit={commit}
              active={commit.hash === active}
              onSelect={onSelect}
              graphRow={graph.rows[index]}
              graphWidth={graph.width}
            />
          ))}
          <div ref={sentinelRef} className={css.commitsSentinel} />
          <div className={css.commitsFoot}>
            {loadingMore ? t('loading') : hasMore ? '' : t('historyEnd')}
          </div>
        </div>
      )}
    </div>
  )
}

/* ---------- file tree ---------- */

/** Horizontal step per nesting level. */
const TREE_INDENT = 14
/** The gutter every row starts at. Equals `--gs-gutter-pane`, so depth-0 ticks
 *  line up with the toolbar's own content — and everything interactive stays
 *  clear of the 10px resizer the drawer paints over its left edge. */
const TREE_BASE_INDENT = 12
/** Chevron width plus its gap. A file row adds this so its status badge starts at
 *  the directory NAME's column rather than under the directory's chevron. */
const TREE_LEAF_OFFSET = 16
/** Where a level's indent guide sits: inside the chevron, so it points at the
 *  rows it groups. */
const TREE_RAIL_OFFSET = 12
/** The tick's own width. Must match `.checkBox` — the row's content starts after
 *  it, and the indent guides are positioned from it. */
const TREE_CHECK_W = 22
/** Custom property the stylesheet reads to place one level's indent guide. */
const RAIL_VAR = '--gs-rail'

interface DirNode {
  readonly name: string
  readonly path: string
  readonly dirs: Map<string, DirNode>
  readonly files: GitFile[]
  fileCount: number
  added: number
  deleted: number
  /** Every descendant's tick, rolled up. Computed once with the other totals. */
  check: CheckState
}

function buildTree(files: readonly GitFile[]): DirNode {
  const root: DirNode = { name: '', path: '', dirs: new Map(), files: [], fileCount: 0, added: 0, deleted: 0, check: 'off' }
  for (const file of files) {
    let node = root
    const parts = file.path.split('/')
    for (let i = 0; i < parts.length - 1; i += 1) {
      const name = parts[i]
      let child = node.dirs.get(name)
      if (child === undefined) {
        child = { name, path: parts.slice(0, i + 1).join('/'), dirs: new Map(), files: [], fileCount: 0, added: 0, deleted: 0, check: 'off' }
        node.dirs.set(name, child)
      }
      node = child
    }
    node.files.push(file)
  }
  const aggregate = (node: DirNode): void => {
    node.fileCount = node.files.length
    node.added = node.files.reduce((sum, f) => sum + f.addedLines, 0)
    node.deleted = node.files.reduce((sum, f) => sum + f.deletedLines, 0)
    const ticks: CheckState[] = node.files.map(fileCheckState)
    for (const child of node.dirs.values()) {
      aggregate(child)
      node.fileCount += child.fileCount
      node.added += child.added
      node.deleted += child.deleted
      ticks.push(child.check)
    }
    node.check = rollUp(ticks)
  }
  aggregate(root)
  return compactChains(root)
}

/**
 * Merge every directory that holds nothing but one subdirectory into that child.
 *
 * `docs/superpowers/specs/design.md` otherwise costs three rows and three indent
 * levels to reach one file, and none of those three rows carries a choice — each
 * has exactly one way down. Merging them into a single `docs/superpowers/specs`
 * row is what VS Code calls compact folders, and it makes indentation depth mean
 * "where the tree branches" rather than "how long the path is".
 *
 * The merged node keeps the DEEPEST path, so it stays the one the collapse set
 * and the reveal-the-active-file walk already address.
 * @param node - directory whose descendants are compacted.
 * @returns the node with compacted children.
 */
function compactChains(node: DirNode): DirNode {
  const dirs = new Map<string, DirNode>()
  for (const child of node.dirs.values()) {
    let merged = compactChains(child)
    while (merged.files.length === 0 && merged.dirs.size === 1) {
      const only = merged.dirs.values().next().value as DirNode
      merged = { ...only, name: `${merged.name}/${only.name}` }
    }
    dirs.set(merged.name, merged)
  }
  return { ...node, dirs }
}

interface FileTreeProps {
  t: Translate
  /** Whether the view has nothing to show yet — already resolved by the caller
   *  via {@link showsPending}, NOT the raw in-flight flag. This pane used to
   *  re-derive it from `loading && files.length === 0`, and that second copy of
   *  the rule is precisely what the header then got wrong. */
  loading?: boolean
  /** What the list holds, prepended to the count — the working-tree view says
   *  which worktree it is reading; commit views are already named by history. */
  lead?: string
  files: readonly GitFile[]
  active: string | null
  onSelect: (path: string) => void
  /** Undefined until the user interacts: then it shows defaults. Lifted to the
   *  panel so background polls (new `files` identity) and drawer close/reopen
   *  never reset the user's expansion choices. */
  collapsed: Set<string> | undefined
  onCollapsedChange: (next: Set<string>) => void
  /** Add or remove files from the commit set. Undefined outside the working-tree
   *  view, where what a commit contains was decided long ago. */
  onCheck?: (files: readonly GitFile[], state: CheckState) => void
  /** Roll one file back to HEAD; working-tree view only. */
  onDiscard?: (file: GitFile) => void
  /** Rendered under the tree in the working-tree view only. */
  footer?: ReactNode
  /** Names what this list is OF — the working tree, or one commit, or one
   *  comparison. The filter clears when it changes: a query typed against a
   *  140-file commit would otherwise carry over to the next commit and hide
   *  most of it, with nothing on screen saying why. */
  scopeKey: string
}

function FileTree({ t, loading, lead, files, active, onSelect, collapsed, onCollapsedChange, onCheck, onDiscard, footer, scopeKey }: FileTreeProps): ReactNode {
  /**
   * The filter over this list. Local, because it describes a way of LOOKING at
   * the pane rather than anything the drawer stores: closing and reopening on
   * an unfiltered list is what someone expects, and a query kept in the panel
   * would have to be cleared from four places instead of one.
   */
  const [query, setQuery] = useState('')
  const [filterOpen, setFilterOpen] = useState(false)
  const filterRef = useRef<HTMLInputElement>(null)
  useEffect(() => { setQuery(''); setFilterOpen(false) }, [scopeKey])

  const shownFiles = useMemo(() => filterFiles(files, query), [files, query])
  const filtering = shownFiles !== files
  const tree = useMemo(() => buildTree(shownFiles), [shownFiles])
  /** Default: a dir collapses when it holds more than 12 files anywhere below it. */
  const effective = collapsed ?? defaultCollapsed(tree)

  // Reveal the active file by expanding its ancestor chain — ONLY when the
  // selection itself changes. Listening to `collapsed` here would instantly
  // revert manual folds of any directory containing the active file.
  useEffect(() => {
    if (active === null) return
    const parts = active.split('/')
    let touched = false
    const next = new Set(collapsed ?? defaultCollapsed(tree))
    for (let i = 1; i < parts.length; i += 1) {
      const dir = parts.slice(0, i).join('/')
      if (next.delete(dir)) touched = true
    }
    if (touched) onCollapsedChange(next)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- reveal is a selection-change event, not an invariant over `collapsed`
  }, [active])

  const setAll = (open: boolean): void => {
    onCollapsedChange(open ? new Set() : allDirs(tree))
  }

  const toggleOne = (path: string): void => {
    const next = new Set(effective)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    onCollapsedChange(next)
  }

  const stageLabels = { stage: t('stage'), unstage: t('unstage') }

  return (
    <div className={css.treeWrap}>
      <div className={css.treeTools}>
        {/* The root tick replaces the Stage all / Unstage all pair: it says the
            same two things in the column the rows already read down, and gives
            the toolbar back the room those two buttons needed. The toolbar's own
            pane gutter is its indent, so it lines up with the depth-0 rows. */}
        <div className={css.treeLead}>
          {onCheck !== undefined ? (
            <CheckBox
              state={tree.check}
              label={tree.check === 'on' ? t('unstageAll') : t('stageAll')}
              indent={0}
              // `shownFiles`, not `files`: a tick IS a git call, and the root
              // one must stage exactly the rows it sits above. Reaching past a
              // filter into files the pane is hiding is how "stage all" ends up
              // meaning something the reader never saw.
              onToggle={() => onCheck(shownFiles, tree.check)}
            />
          ) : null}
          <span className={css.treeLabel}>
            {loading === true
              ? t('loading')
              : `${lead !== undefined ? `${lead} · ` : ''}${filtering
                ? t('filesFiltered', { shown: shownFiles.length, count: files.length })
                : t('files', { count: files.length })}`}
          </span>
        </div>
        <div className={css.treeActions} data-gs-part="tree-actions">
          {/* Filtering is about the list, so it sits with the list's own two
              controls rather than in the drawer chrome — and it stays lit while
              a query is set, because a pane showing 6 of 140 files with no
              visible reason is the one way this feature can mislead. */}
          <button
            type="button"
            className={filterOpen || filtering ? `${css.treeIcon} ${css.treeIconOn}` : css.treeIcon}
            data-gs-part="filter-files"
            title={t('filterFiles')} aria-label={t('filterFiles')}
            aria-pressed={filterOpen}
            onClick={() => {
              // Closing is also clearing. A hidden box still holding a query
              // would leave the pane filtered with its only explanation
              // folded away.
              if (filterOpen) { setQuery(''); setFilterOpen(false); return }
              setFilterOpen(true)
              window.setTimeout(() => filterRef.current?.focus(), 0)
            }}
          ><FilterGlyph /></button>
          {/* Icon-only, with the label on `title`/`aria-label`: the glyph is the
              same one the rows carry, so each button previews its own result. */}
          <button
            type="button" className={css.treeIcon} data-gs-part="expand-all"
            title={t('expandAll')} aria-label={t('expandAll')}
            onClick={() => setAll(true)}
          ><span className={`${css.treeIconGlyph} ${css.treeIconDown}`}>▸</span></button>
          <button
            type="button" className={css.treeIcon} data-gs-part="collapse-all"
            title={t('collapseAll')} aria-label={t('collapseAll')}
            onClick={() => setAll(false)}
          ><span className={css.treeIconGlyph}>▸</span></button>
        </div>
      </div>
      {filterOpen ? (
        <div className={css.treeFilter}>
          <input
            ref={filterRef}
            className={css.treeFilterInput}
            type="text"
            value={query}
            placeholder={t('filterFilesPlaceholder')}
            aria-label={t('filterFiles')}
            spellCheck={false}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => {
              if (event.key !== 'Escape') return
              // Escape belongs to the box while it has something to undo;
              // only an already-empty box lets it through to close the drawer.
              if (query.length > 0) { event.stopPropagation(); setQuery(''); return }
              event.stopPropagation()
              setFilterOpen(false)
            }}
          />
          {query.length > 0 ? (
            <button
              type="button" className={css.treeFilterClear}
              title={t('filterFilesClear')} aria-label={t('filterFilesClear')}
              onClick={() => { setQuery(''); filterRef.current?.focus() }}
            >×</button>
          ) : null}
        </div>
      ) : null}
      {loading === true ? (
        <div className={css.treeEmpty} data-gs-part="tree-loading">{t('loading')}</div>
      ) : filtering && shownFiles.length === 0 ? (
        <div className={css.treeEmpty} data-gs-part="tree-no-match">{t('filterNoMatch')}</div>
      ) : (
        <ul className={css.tree}>
          {/* A filtered tree ignores the fold state entirely: the reader asked
              for these files, and leaving them behind a directory they
              collapsed twenty minutes ago reads as "no matches". */}
          <TreeChildren
            node={tree} depth={0} active={active} collapsed={filtering ? EMPTY_COLLAPSED : effective}
            onToggle={toggleOne} onSelect={onSelect} onCheck={onCheck} onDiscard={onDiscard} stageLabels={stageLabels} discardLabel={t('discardAction')}
          />
        </ul>
      )}
      {footer}
    </div>
  )
}

function defaultCollapsed(root: DirNode): Set<string> {
  const out = new Set<string>()
  const walk = (node: DirNode): void => {
    for (const child of node.dirs.values()) {
      if (child.fileCount > 12) out.add(child.path)
      walk(child)
    }
  }
  walk(root)
  return out
}

function allDirs(node: DirNode): Set<string> {
  const out = new Set<string>()
  const walk = (n: DirNode): void => {
    for (const child of n.dirs.values()) { out.add(child.path); walk(child) }
  }
  walk(node)
  return out
}

/**
 * One tick. A sibling of the row it belongs to rather than a child of it: a
 * button inside a button is invalid HTML, and the two clicks mean different
 * things — this one changes the commit set, the row opens the diff.
 *
 * The tick carries its row's own indent and stands at the node it includes,
 * IDEA-style, rather than in a column pinned to the pane edge. A pinned column
 * reads at a glance, but it detaches each tick from its node — and its first
 * 10px sat underneath the drawer's edge resizer, so a click on the left half of
 * a depth-0 tick dragged the drawer instead of staging anything.
 */
function CheckBox({ state, label, indent, onToggle }: {
  state: CheckState
  label: string
  /** The row's left edge, carried here so the tick stands at its own node. */
  indent: number
  onToggle: () => void
}): ReactNode {
  const mark = state === 'on' ? css.checkMarkOn : state === 'partial' ? css.checkMarkPartial : ''
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={state === 'partial' ? 'mixed' : state === 'on'}
      className={css.checkBox}
      style={{ marginLeft: indent }}
      title={label}
      aria-label={label}
      onClick={onToggle}
    >
      <span className={`${css.checkMark} ${mark}`} aria-hidden="true">
        {state === 'on' ? '✓' : state === 'partial' ? '–' : ''}
      </span>
    </button>
  )
}

/** Every file at or under a node, for a tick that acts on a whole directory. */
function filesUnder(node: DirNode): GitFile[] {
  const out = [...node.files]
  for (const child of node.dirs.values()) out.push(...filesUnder(child))
  return out
}

interface TreeChildrenProps {
  node: DirNode
  depth: number
  active: string | null
  /** Read-only: a filtered tree is handed a shared empty set rather than a copy. */
  collapsed: ReadonlySet<string>
  onToggle: (path: string) => void
  onSelect: (path: string) => void
  /** Add or remove files from the commit set. Undefined outside the working-tree
   *  view, where what a commit contains was decided long ago. */
  onCheck?: (files: readonly GitFile[], state: CheckState) => void
  /** Roll one file back to HEAD. Undefined outside the working-tree view for
   *  the same reason `onCheck` is: a commit's files are history, and there is
   *  nothing there to roll back. Directories never offer it — the irreversible
   *  action does not get a gesture that takes a subtree with it. */
  onDiscard?: (file: GitFile) => void
  /** Pre-translated, so the row does not have to carry `t` for two strings. */
  stageLabels: { stage: string; unstage: string }
  /** Label for the roll-back action, pre-translated like `stageLabels`. */
  discardLabel?: string
}

function TreeChildren({ node, depth, active, collapsed, onToggle, onSelect, onCheck, onDiscard, stageLabels, discardLabel }: TreeChildrenProps): ReactNode {
  const dirNodes = [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name))
  const fileNodes = [...node.files].sort((a, b) => basePart(a.path).localeCompare(basePart(b.path)))
  const checkColumn = onCheck !== undefined ? TREE_CHECK_W : 0
  // With ticks, the tick carries this indent and the button starts at 0; without
  // them (history, compare) the button carries it, as it always did.
  const indent = TREE_BASE_INDENT + depth * TREE_INDENT
  return (
    <>
      {dirNodes.map(dir => {
        const open = !collapsed.has(dir.path)
        const containsActive = active !== null && active.startsWith(`${dir.path}/`)
        return (
          <li key={dir.path} className={css.treeDirLi}>
            <div className={css.treeRow}>
              {onCheck !== undefined ? (
                <CheckBox
                  state={dir.check}
                  label={dir.check === 'on' ? stageLabels.unstage : stageLabels.stage}
                  indent={indent}
                  onToggle={() => onCheck(filesUnder(dir), dir.check)}
                />
              ) : null}
              <button
                type="button"
                className={`${css.treeDir} ${containsActive ? css.treeDirActive : ''}`}
                style={{ paddingLeft: onCheck !== undefined ? 0 : indent }}
                onClick={() => onToggle(dir.path)}
                title={dir.path}
              >
                <span className={`${css.chevron} ${open ? css.chevronOpen : ''}`}>▸</span>
                <PathDirGlyph />
                <span className={css.treeDirName}>{dir.name}</span>
                <span className={css.treeDirCount}>{dir.fileCount}</span>
                <span className={css.treeDirCounts}>
                  {dir.added > 0 ? <span className={css.fileCountAdd}>+{dir.added}</span> : null}
                  {dir.deleted > 0 ? <span className={css.fileCountDel}>−{dir.deleted}</span> : null}
                </span>
              </button>
            </div>
            {open ? (
              <ul
                className={css.treeSub}
                // The rail hangs off the parent's chevron, which sits after the
                // row's tick — so the tick's width is part of the offset.
                style={{ [RAIL_VAR]: `${checkColumn + TREE_BASE_INDENT + depth * TREE_INDENT + TREE_RAIL_OFFSET}px` } as CSSProperties}
              >
                <TreeChildren node={dir} depth={depth + 1} active={active} collapsed={collapsed} onToggle={onToggle} onSelect={onSelect} onCheck={onCheck} onDiscard={onDiscard} stageLabels={stageLabels} discardLabel={discardLabel} />
              </ul>
            ) : null}
          </li>
        )
      })}
      {fileNodes.map(file => {
        const check = fileCheckState(file)
        return (
          <li key={file.path} className={css.fileLi}>
            {onCheck !== undefined ? (
              <CheckBox
                state={check}
                label={check === 'on' ? stageLabels.unstage : stageLabels.stage}
                indent={indent}
                onToggle={() => onCheck([file], check)}
              />
            ) : null}
            <button
              type="button"
              className={active === file.path ? `${css.file} ${css.fileActive}` : css.file}
              style={{ paddingLeft: (onCheck !== undefined ? 0 : indent) + TREE_LEAF_OFFSET }}
              onClick={() => onSelect(file.path)}
              title={file.previousPath !== undefined ? `${file.previousPath} → ${file.path}` : file.path}
            >
              {/* Icon then name, status on the right with the line counts.
                  The badge used to lead, which put two glyphs side by side the
                  moment the row gained a file icon; both IDEA and VS Code read
                  left-to-right as "what this is, then what happened to it",
                  and the badge still lands in an aligned column — `.filePath`
                  is the only flexible child. */}
              <PathFileGlyph path={file.path} />
              <span className={css.filePath}>{basePart(file.path)}</span>
              {file.binary ? <span className={css.fileBinary}>BIN</span> : (
                <span className={css.fileCounts}>
                  <span className={css.fileCountAdd}>{file.addedLines > 0 ? `+${file.addedLines}` : ''}</span>{' '}
                  <span className={css.fileCountDel}>{file.deletedLines > 0 ? `−${file.deletedLines}` : ''}</span>
                </span>
              )}
              <span className={`${css.fileStatus} ${STATUS_BADGE[file.status]}`}>{statusGlyph(file.status)}</span>
            </button>
            {onDiscard !== undefined ? (
              /* Outside the row button, not inside it: a button in a button is
                 invalid, and clicking roll-back must not also select the file. */
              <button
                type="button"
                className={css.fileDiscard}
                title={discardLabel}
                aria-label={`${discardLabel ?? ''} ${file.path}`}
                onClick={event => { event.stopPropagation(); onDiscard(file) }}
              ><RollbackGlyph /></button>
            ) : null}
          </li>
        )
      })}
    </>
  )
}

/* ---------- diff rendering: rows, word-level ranges, syntax pass ---------- */

/** Render one file's unified-diff segment with word-level highlights and Shiki. */
function DiffView({ segment, path, palette }: { segment: string; path: string; palette: string }): ReactNode {
  const lang = shikiLangOf(path)
  const shikiTheme = shikiThemeOf(palette)
  const grammarGen = useSyncExternalStore(subscribeGrammarLoaded, grammarLoadCount)
  const rowsWithWords = useMemo(() => attachWordRanges(parseRows(segment)), [segment])
  const sides = useMemo(() => gutterSides(rowsWithWords), [rowsWithWords])
  const syntax = useMemo(
    () => highlightForRows(rowsWithWords, lang, shikiTheme),
    [rowsWithWords, lang, shikiTheme, grammarGen],
  )
  return (
    <pre className={css.diffPre}>
      {rowsWithWords.map((row, i) => (
        <div key={i} className={`${css.line} ${rowClass(row.kind)}`}>
          {sides.old ? <span className={css.lnOld}>{row.kind === 'add' || row.kind === 'hunk' ? '' : row.oldL}</span> : null}
          {sides.new ? <span className={css.lnNew}>{row.kind === 'del' || row.kind === 'hunk' ? '' : row.newL}</span> : null}
          <span className={`${css.gutter} ${row.kind === 'add' ? css.signAdd : row.kind === 'del' ? css.signDel : ''}`}>
            {row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ''}
          </span>
          <span className={css.code}>{renderCode(row, syntax[i] ?? [])}</span>
        </div>
      ))}
    </pre>
  )
}

function rowClass(kind: Row['kind']): string {
  switch (kind) {
    case 'add': return css.lineAdd
    case 'del': return css.lineDel
    case 'hunk': return css.lineHunk
    default: return css.lineContext
  }
}

function renderCode(row: RowWithRanges, tokens: readonly HighlightRun[]): ReactNode {
  if (row.kind === 'hunk') return row.text
  const painted = overlayRanges(tokens.length > 0 ? tokens : [{ text: row.text }], row.ranges ?? [])
  if (painted.length === 1 && painted[0]!.color === undefined && !painted[0]!.mark) return row.text
  return painted.map((tok, i) => (
    <span
      key={i}
      className={tok.mark ? (row.kind === 'add' ? css.wordAdd : css.wordDel) : undefined}
      style={tok.color === undefined && !tok.italic ? undefined : { color: tok.color, fontStyle: tok.italic ? 'italic' : undefined }}
    >{tok.text}</span>
  ))
}

/* ---------- side-by-side diff rendering (working tree only) ---------- */

/**
 * The working tree's per-file diff as IDEA shows it: one tab per layer of the
 * index, two columns with the whole file, aligned row by row.
 *
 * The rows come from `side-rows.ts` over the layer's full-context diff, so the
 * alignment is read off the diff rather than computed. A change block — a
 * maximal run of changed rows — carries its own actions: hovering any of its
 * cells outlines the whole block and floats its buttons (stage + roll back on
 * the unstaged tab, unstage on the staged one). The click carries the block's
 * hunk-line indices and the rendered diff's sha, so the host can prove the
 * file has not changed since the pane drew it.
 *
 * The unstaged tab's right column is also EDITABLE (the staged one is not, by
 * design: editing the index would mean writing a blob with no file behind it).
 * Editing arms explicitly — never per keystroke — and the buffer's whole life
 * against the file and the poll is `side-edit.ts`'s to decide: a refresh over
 * a dirty buffer keeps the buffer, a file that moved underneath raises the
 * reload-or-overwrite banner, and the one save path carries the sha the buffer
 * is based on so the host can refuse a stale write. While editing, the layout
 * trades the diff's hole-aligned grid for a dense editor column (same
 * metrics, same gutter rhythm): one grid cannot stay diff-aligned AND hold a
 * dense buffer whenever deletions outrun additions, and re-diffing per
 * keystroke is exactly the editor-library work the first cut declines.
 *
 * `tooLarge` and `binary` fall back to the unified view the pane already had
 * (history and compare keep it unconditionally), with a notice — a silently
 * different view reads as a broken one, not a guarded one.
 */
function SideBySideView({ t, path, palette, statsPath, fetchSides, writeChecked, scopeKey, gen, fallbackSegment, fallbackLoading, onBlockAction, onSaved, onDirtyChange }: {
  t: Translate
  path: string
  palette: string
  statsPath: string | undefined
  fetchSides: (worktreePath: string | undefined, path: string, layer: SideLayer, signal: AbortSignal) => Promise<FileSides | null>
  /** Save the editor buffer; the host refuses a stale sha and nothing is written. */
  writeChecked: (worktreePath: string | undefined, path: string, text: string, expectedSha: string, signal: AbortSignal) => Promise<WriteResult | null>
  /** Names the view the fetch belongs to, as `viewKey` does for the diff cache. */
  scopeKey: string
  /** Refresh generation: a new one means the tree was re-read, so refetch. */
  gen: number
  /** The drawer's polled view of this file's HEAD-diff; a CHANGE in it means
   *  the drawer noticed the file move, so the pane refetches even between
   *  refresh generations — this is how the poll reaches a dirty buffer. */
  fallbackSegment: string
  fallbackLoading: boolean
  /** Run one block action; a discard routes to the drawer's confirmation. */
  onBlockAction: (mode: BlockMode, ask: BlockAsk) => Promise<GitOpResult>
  /** After a successful save: refresh the tree and the pane together. */
  onSaved: () => void
  /** Reports the buffer's dirty flag outward: the drawer guards every
   *  gesture that would drop the buffer (file selection, close, main tab)
   *  on it, so it must live where those gestures are handled. */
  onDirtyChange: (dirty: boolean) => void
}): ReactNode {
  const [layer, setLayer] = useState<SideLayer>('unstaged')
  // How much of the pane the left column gets. Lives here rather than in the
  // drawer so it is one setting for the pane, and survives a file switch —
  // the reader sized the columns for how they read, not for one file.
  const [split, setSplit] = useState(0.5)
  const colsRef = useRef<HTMLDivElement>(null)

  const [sides, setSides] = useState<FileSides | null>(null)
  // Set when the RPC itself failed — most plausibly a host half older than
  // this client (the two halves reload on different cycles). The unified view
  // still renders, so an old host costs the new pane, not the diff.
  const [failed, setFailed] = useState(false)
  // The block under the pointer, or null over context rows and gutters. Hover
  // names the BLOCK, not the cell: the outline and the buttons belong to a
  // whole run of rows, and a per-cell affordance would scatter them.
  const [hotBlock, setHotBlock] = useState<number | null>(null)
  // The block whose stage/unstage call is in flight, disabling its buttons.
  const [pendingBlock, setPendingBlock] = useState<number | null>(null)
  // The editable right column's state and its one save path. `saving` disables
  // the controls for the call's duration; `saveFailed` carries a non-stale
  // failure's sentence (the stale case is `edit.conflict`'s banner instead).
  const [edit, setEdit] = useState<EditState>(DISARMED)
  const [saving, setSaving] = useState(false)
  const [saveFailed, setSaveFailed] = useState<{ title: string; detail: string } | null>(null)
  // The layer a dirty-buffer tab switch is waiting on the reader to confirm.
  const [pendingLayer, setPendingLayer] = useState<SideLayer | null>(null)
  // Internal fetch generation: a stale save or the banner's reload refetch
  // without waiting for the drawer's next refresh.
  const [refetch, setRefetch] = useState(0)
  // Which edit session the fetched payload belongs to, and what a landing
  // payload may do with the buffer. The ref is read inside the fetch callback
  // (which closes over a render that may be several states old by the time the
  // answer arrives), and the adopt mode is consumed once by the next run.
  const idRef = useRef('')
  const adoptRef = useRef<'auto' | 'reload'>('auto')
  const editRef = useRef(edit)
  editRef.current = edit

  // Switching tabs refetches: the two layers are different diffs of the same
  // file, and neither is a transform of the other client-side. A change in the
  // drawer's polled segment for this file refetches too — the poll's way of
  // saying the file moved — which is what lets a change under a DIRTY buffer
  // raise the banner within one poll interval instead of at the next refresh.
  //
  // Only a NEW file/layer/scope may blank the pane and disarm the editor; a
  // refetch of the same identity keeps the current payload on screen until the
  // answer lands, because blanking it would unmount the editor mid-keystroke.
  useEffect(() => {
    const id = `${scopeKey}\x1f${path}\x1f${layer}`
    const identityChanged = idRef.current !== id
    if (identityChanged) idRef.current = id
    const adopt = identityChanged ? 'reset' : adoptRef.current
    adoptRef.current = 'auto'
    const ctrl = new AbortController()
    let alive = true
    if (identityChanged) {
      setSides(null)
      setSaveFailed(null)
      setPendingLayer(null)
    }
    if (identityChanged || !editRef.current.armed) setFailed(false)
    fetchSides(statsPath, path, layer, ctrl.signal)
      .then(value => {
        if (!alive) return
        // While armed, a failed background refetch keeps the pane as it is:
        // dropping the editor over a transient RPC failure would cost the
        // buffer's DOM (focus, IME composition) for no reader benefit.
        if (value === null) {
          if (!editRef.current.armed) setFailed(true)
          return
        }
        setSides(value)
        setEdit(prev => adopt === 'reset' ? resetSides(prev, value)
          : adopt === 'reload' ? reloadSides(prev, value)
          : applySides(prev, value))
      })
      .catch(() => { if (alive && !editRef.current.armed) setFailed(true) })
    return () => { alive = false; ctrl.abort() }
  }, [fetchSides, statsPath, path, layer, scopeKey, gen, fallbackSegment, refetch])

  const lang = shikiLangOf(path)
  const shikiTheme = shikiThemeOf(palette)
  const grammarGen = useSyncExternalStore(subscribeGrammarLoaded, grammarLoadCount)
  const rows = useMemo(() => {
    if (sides === null || sides.diff.length === 0) return []
    const file = parsePatch(sides.diff)
    // A diff with no hunk (mode-only change, or text patch-model cannot parse)
    // has no rows to align; the no-change treatment below is the honest view.
    return file === null ? [] : alignRows(file)
  }, [sides])
  // Highlight each column as one file — a row is not a program, and lexing
  // fragments is what made the unified view paint keywords as plain text.
  //
  // These are UNDEFINED until a lazy grammar loads, and stay undefined for a
  // file whose extension has no grammar at all (`go.mod`, `Dockerfile`), so
  // every read below is optional-chained. `renderSideCode` already takes
  // `undefined` and renders the plain text for it; what crashes is indexing
  // the array itself, and `strict` is off in tsconfig, so the compiler will
  // not say so.
  const leftSyntax = useMemo(
    () => highlightFile(rows.map(row => row.left === null ? '' : row.left.text), lang, shikiTheme),
    [rows, lang, shikiTheme, grammarGen],
  )
  const rightSyntax = useMemo(
    () => highlightFile(rows.map(row => row.right === null ? '' : row.right.text), lang, shikiTheme),
    [rows, lang, shikiTheme, grammarGen],
  )

  /** The editor half of the pane, present only on the unstaged layer. */
  const editable = layer === 'unstaged' && edit.armed
  const dirty = isDirty(edit)
  // Whether this payload may enter the editor at all: text carrying \r would
  // be normalised to \n by the textarea the moment it landed, and the next
  // save would rewrite every line ending in the file. The gate lives in
  // `side-edit.ts` with the rest of the buffer's rules.
  const armable = sides !== null && editableSides(sides)
  // Which sentence the withheld editor gets: CRLF and a non-UTF-8 encoding are
  // different problems, and one message for both leaves the reader guessing
  // whether converting line endings would help.
  const refusal = sides === null ? null : armRefusal(sides)


  // The drawer guards every gesture that would drop the buffer — selecting
  // another file, closing, switching the main tab — so it needs the flag as
  // it changes, not at click time from a stale render. Reported on the FLAG
  // (not the buffer) so it fires on the transitions that matter; the cleanup
  // clears it when this pane unmounts, so no orphaned flag prompts later.
  useEffect(() => {
    onDirtyChange(dirty)
    return () => { onDirtyChange(false) }
  }, [dirty, onDirtyChange])
  // The buffer's lines and their highlight, for the editor's underlay: the
  // visible text under the transparent textarea, which is what keeps syntax
  // coloring and the caret on the same grid while typing.
  const bufferLines = useMemo(() => edit.buffer.split('\n'), [edit.buffer])
  // What Tab inserts, learned from the file rather than configured. Keyed on
  // the BASE text, not the buffer: re-detecting mid-edit would let a couple of
  // freshly typed lines redefine the unit under the reader's hands.
  const indentOfBuffer = useMemo(() => detectIndent(edit.baseText), [edit.baseText])
  // The index side as one text, which is what the editor tints against while
  // the reader types. It is the diff's own left column joined back up — every
  // row of a full-context diff carries a left cell unless the line is an
  // addition, which by definition is not on that side.
  const indexText = useMemo(() => {
    const left = rows.filter(row => row.left !== null).map(row => row.left!.text)
    return left.length === 0 ? '' : left.join('\n') + '\n'
  }, [rows])
  // The editor's buffer is a whole file, so it takes the whole-file pass —
  // and it lags the typing, for the same reason the browser's does: a Shiki
  // pass per keystroke is what makes a large file unusable to edit.
  const paintedLines = useIdleValue(bufferLines, HIGHLIGHT_IDLE_MS)
  const editSyntax = useMemo(
    () => edit.armed && paintedLines.length <= HIGHLIGHT_LINE_CAP
      ? highlightWholeFile(paintedLines, lang, shikiTheme)
      : [],
    [edit.armed, paintedLines, lang, shikiTheme, grammarGen],
  )
  // The left column while editing renders dense — one row per INDEX line, no
  // holes — because the right column is now the dense buffer; a hole-aligned
  // left beside a dense right is the alignment the diff view owes, not the
  // editor. Each entry keeps its index into `rows` for its syntax tokens.
  const leftRows = useMemo(() => rows.map((row, i) => ({ row, i })).filter(entry => entry.row.left !== null), [rows])

  // Arming drops the caret straight into the buffer: the click that armed the
  // editor said "I want to type here", and a second click to focus is a tax.

  /** Arm the editor from the payload on screen; the unstaged tab, and only
   *  for a payload `editableSides` accepts — armEdit itself refuses the rest,
   *  so even a stray call cannot put CRLF text into the buffer. */
  const arm = (): void => {
    if (sides === null || layer !== 'unstaged' || !editableSides(sides)) return
    setEdit(prev => armEdit(prev, sides))
  }

  /**
   * The one save path, shared by the Save button, Ctrl/Cmd+S and the banner's
   * overwrite action — they differ only in WHICH sha the host is asked to
   * check: the buffer's basis for a save, the file as it stands NOW for an
   * explicit overwrite of a concurrent writer's version.
   *
   * On success the basis moves to the sha the host read back and the drawer
   * refreshes (tree and pane together). On `stale` the banner goes up and the
   * pane refetches WITHOUT touching the buffer, so the banner's reload and
   * overwrite actions read the file's true current state. Everything else is
   * a failed save with a sentence.
   */
  const runSave = async (expectedSha: string): Promise<void> => {
    if (sides === null || !dirty || saving) return
    const savedText = edit.buffer
    // The edit session this save belongs to. A slow RPC can outlive a file or
    // layer switch, and applying THIS save's outcome to the NEXT file's edit
    // state would re-base that buffer onto text it never held — so every
    // pane-local effect below is gated on the session still being current.
    // The tree refresh on success is not: the file on disk did move.
    const session = idRef.current
    setSaving(true)
    try {
      const result = await writeChecked(statsPath, path, savedText, expectedSha, new AbortController().signal)
      const stillHere = idRef.current === session
      if (result === null) {
        if (stillHere) setSaveFailed({ title: t('saveUnavailable'), detail: '' })
      } else if (result.ok) {
        if (stillHere) {
          setSaveFailed(null)
          setEdit(prev => applySaveOk(prev, savedText, result.sha ?? ''))
        }
        onSaved()
      } else if (result.failure === 'stale') {
        if (stillHere) {
          setEdit(prev => markConflict(prev))
          setRefetch(n => n + 1)
        }
      } else {
        if (stillHere) setSaveFailed({ title: t('saveFailed'), detail: (result.error ?? '').trim() })
      }
    } finally {
      setSaving(false)
    }
  }

  /**
   * The banner's two answers to a file that moved underneath. Overwrite may
   * only run once the post-refusal refetch has landed (the fresh targetSha is
   * what the host checks the overwrite against); until then the button waits,
   * because re-sending the refused sha would just refuse again.
   */
  const canOverwrite = dirty && edit.conflict && sides !== null && sides.targetSha !== edit.baseSha
  const overwrite = (): Promise<void> => sides === null ? Promise.resolve() : runSave(sides.targetSha)
  /** Reload: the reader chose the file over the buffer; drop the edits. */
  const reload = (): void => {
    setSaveFailed(null)
    adoptRef.current = 'reload'
    setRefetch(n => n + 1)
  }
  /** Revert the buffer to its basis, in place; the conflict flag stands. */
  const revert = (): void => {
    setSaveFailed(null)
    setEdit(prev => ({ ...prev, buffer: prev.baseText }))
  }

  /**
   * A layer tab is one click away from dropping the buffer: with unsaved
   * edits the click asks first, and only the dialog's answer switches.
   */
  const switchLayer = (next: SideLayer): void => {
    if (next === layer) return
    if (dirty) {
      setPendingLayer(next)
      return
    }
    setLayer(next)
  }
  const confirmLeave = (): void => {
    const next = pendingLayer
    setPendingLayer(null)
    if (next !== null) setLayer(next)
  }

  /** Ctrl/Cmd+S inside the pane: the editor's other save affordance. */
  const onPaneKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      if (dirty && !saving) void runSave(edit.baseSha)
    }
  }

  /**
   * One bubbling hover listener turns the cell under the pointer into its
   * block id: every changed row's code cells carry `data-block`, so `closest`
   * reads the block off whatever the pointer is over — no handler per cell,
   * and a pointer over context or a gutter simply clears the hot block.
   */
  /**
   * The divider: a ratio, not a pixel width, so the columns keep their
   * proportion when the drawer itself is resized.
   *
   * Clamped well short of either edge — a column dragged to nothing looks
   * like a broken pane, and there is no affordance to drag it back out of.
   */
  const onSplitDrag = (clientX: number): void => {
    const box = colsRef.current?.getBoundingClientRect()
    if (box === undefined || box.width === 0) return
    const ratio = (clientX - box.left) / box.width
    setSplit(Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, ratio)))
  }

  const onBodyHover = (event: ReactMouseEvent<HTMLDivElement>): void => {
    const hit = (event.target as Element).closest('[data-block]')
    const id = hit === null ? null : Number(hit.getAttribute('data-block'))
    setHotBlock(prev => (prev === id ? prev : id))
  }

  /**
   * Run one block action with the coordinates of the diff on screen.
   *
   * Discard never acts from the click — the drawer opens the confirmation,
   * and the confirmed call carries this same snapshot, so a file that moved
   * underneath the dialog is refused host-side rather than re-derived from
   * whatever the poll has fetched since. Stage and unstage run now; the
   * clicked block's buttons stay disabled until the answer lands, and the
   * drawer's op lock refuses any other block click meanwhile.
   */
  const runBlock = async (mode: BlockMode, block: number): Promise<void> => {
    if (sides === null) return
    const ask: BlockAsk = {
      path, layer, diffSha: sides.diffSha,
      lines: blockLines(rows, block),
      ...blockTally(rows, block),
      wholeFile: blockIsWholeFile(rows, block),
    }
    if (mode === 'discard') {
      void onBlockAction(mode, ask)
      return
    }
    setPendingBlock(block)
    try {
      await onBlockAction(mode, ask)
    } finally {
      setPendingBlock(null)
    }
  }

  /** The pane the drawer had before this view existed, notice included. */
  const unifiedFallback = (): ReactNode => fallbackSegment.length > 0
    ? <DiffView segment={fallbackSegment} path={path} palette={palette} />
    : <div className={css.empty}>{fallbackLoading ? t('loadingDiff') : t('noTextDiff')}</div>

  if (failed) return unifiedFallback()
  if (sides === null) return <div className={css.empty}>{t('loadingDiff')}</div>
  if (sides.binary) return <div className={css.empty}>{t('binaryFile')}</div>
  if (sides.tooLarge) {
    return (
      <>
        <div className={css.sideNotice}>{t('diffTooLarge')}</div>
        {unifiedFallback()}
      </>
    )
  }
  // The tabs are the pane's, not one layer's: an empty diff here (a fully
  // staged file's unstaged side, a file with nothing staged) is one click from
  // the other layer, and the Edit button still arms — the working tree is the
  // edit target even when every change in it is already staged. So the
  // no-change treatment below is a state of the BODY (`sideBodyState`), never
  // an early return for the pane: returning here is what used to blank the
  // tabs for exactly these files.
  const bodyState = sideBodyState(rows, editable)
  // The hovered block's first row hosts the action bar; a del-only block has
  // no right cell, so its bar rides the left one instead. In the editor
  // layout the left column is dense, so the bar rides its first left row.
  const hotFirst = hotBlock === null ? -1 : rows.findIndex(row => row.block === hotBlock)
  const hotFirstLeft = hotBlock === null ? -1 : leftRows.findIndex(entry => entry.row.block === hotBlock)
  // Dirty buffer, no block actions: a patch computed from the loaded diff
  // would land on top of edits the patch knows nothing about.
  const barDisabled = pendingBlock !== null || dirty
  const blockBar = (block: number): ReactNode => (
    <span className={css.blockBar}>
      {layer === 'staged' ? (
        <button
          type="button"
          className={css.blockBtn}
          disabled={barDisabled}
          onClick={() => { void runBlock('unstage', block) }}
        >{t('blockUnstage')}</button>
      ) : (
        <>
          <button
            type="button"
            className={css.blockBtn}
            disabled={barDisabled}
            onClick={() => { void runBlock('stage', block) }}
          >{t('blockStage')}</button>
          <button
            type="button"
            className={`${css.blockBtn} ${css.blockBtnDanger}`}
            disabled={barDisabled}
            onClick={() => { void runBlock('discard', block) }}
          >{t('blockDiscard')}</button>
        </>
      )}
    </span>
  )
  /** Clicking the working-tree column is the arm gesture readers will try
   *  first — unless the click was really a text selection, or landed on a
   *  block button, in which case it keeps its own meaning. */
  const armFromCell = (event: ReactMouseEvent<HTMLSpanElement>): void => {
    if (edit.armed) return
    if ((event.target as Element).closest('button') !== null) return
    const selection = window.getSelection()
    if (selection !== null && !selection.isCollapsed) return
    arm()
  }
  return (
    <div className={css.sidePane} onKeyDown={onPaneKeyDown}>
      <div className={css.sideTabs}>
        <button
          type="button"
          aria-pressed={layer === 'unstaged'}
          className={layer === 'unstaged' ? `${css.sideTab} ${css.sideTabActive}` : css.sideTab}
          onClick={() => switchLayer('unstaged')}
        >{t('tabUnstaged')}</button>
        <button
          type="button"
          aria-pressed={layer === 'staged'}
          className={layer === 'staged' ? `${css.sideTab} ${css.sideTabActive}` : css.sideTab}
          onClick={() => switchLayer('staged')}
        >{t('tabStaged')}</button>
        {/* Editing arms explicitly and saves explicitly — the two halves of
            "never per keystroke". Save enables only while dirty; Revert drops
            the buffer back onto its basis without touching the file. A
            payload the CRLF gate refuses offers no Edit button at all — the
            notice below says why rather than leaving a button that does
            nothing. */}
        {layer === 'unstaged' ? (
          <span className={css.sideActions}>
            {edit.armed ? (
              <>
                <button
                  type="button"
                  className={`${css.blockBtn}${dirty ? ` ${css.sideSaveReady}` : ''}`}
                  disabled={!dirty || saving}
                  onClick={() => { void runSave(edit.baseSha) }}
                >{t('fileSave')}</button>
                <button
                  type="button"
                  className={css.blockBtn}
                  disabled={!dirty || saving}
                  onClick={revert}
                >{t('fileRevert')}</button>
              </>
            ) : armable ? (
              <button type="button" className={css.blockBtn} onClick={arm}>{t('editFile')}</button>
            ) : null}
          </span>
        ) : null}
      </div>
      {dirty ? <div className={css.sideNotice}>{t('editingNotice')}</div> : null}
      {layer === 'unstaged' && refusal !== null && !edit.armed ? <div className={css.sideNotice}>{t(refusal === 'encoding' ? 'encodingNotice' : 'crlfNotice')}</div> : null}
      {/* §4's row: the file moved underneath a dirty buffer — by the poll's
          notice or by a refused save — and the reader chooses which version
          survives. Overwrite waits for the refetch the refusal triggered, so
          it is checked against the file as it truly stands. */}
      {dirty && edit.conflict ? (
        <div className={css.sideBanner} role="alert">
          <span className={css.sideBannerTitle}>{t('staleTitle')}</span>
          <span>{t('staleBody')}</span>
          <span className={css.sideBannerActs}>
            <button type="button" className={`${css.blockBtn} ${css.blockBtnDanger}`} disabled={saving} onClick={reload}>{t('staleReload')}</button>
            <button type="button" className={css.blockBtn} disabled={!canOverwrite || saving} onClick={() => { void overwrite() }}>{t('staleOverwrite')}</button>
          </span>
        </div>
      ) : null}
      {saveFailed !== null ? (
        <div className={css.sideBanner} role="alert">
          <span className={css.sideBannerTitle}>{saveFailed.title}</span>
          {saveFailed.detail.length > 0 ? <span>{saveFailed.detail}</span> : null}
          <span className={css.sideBannerActs}>
            <button type="button" className={css.blockBtn} disabled={!dirty || saving} onClick={() => { void runSave(edit.baseSha) }}>{t('saveRetry')}</button>
          </span>
        </div>
      ) : null}
      {/* Two columns that scroll sideways independently, with a divider the
          reader can drag. One grid spanning both sides could not do this: its
          tracks are sized by the widest line in the file, so a drag moved
          nothing on exactly the wide files where the space matters. Vertical
          alignment survives the split because both columns render one row per
          aligned row at the same line height — the diff decides the rows, the
          layout only decides how much width each side gets. */}
      <div className={css.sideScroll}>
      {bodyState.kind === 'empty' ? (
        <div className={css.empty}>{t('noTextDiff')}</div>
      ) : (
      <div
        ref={colsRef}
        className={css.sideCols}
        onMouseOver={onBodyHover}
        onMouseLeave={() => { setHotBlock(null) }}
      >
        <div className={css.sideCol} style={{ flexBasis: `${split * 100}%` }}>
          <div className={css.sideColGrid}>
            {bodyState.kind === 'editor' ? (
              /* While armed the left column renders the index side DENSE —
                 one row per index line, no diff holes — because the right
                 column is a buffer whose line count diverges from the diff
                 the moment a keystroke lands. */
              leftRows.map((entry, k) => {
                const { row, i } = entry
                const hot = hotBlock !== null && row.block === hotBlock
                const hotClass = hot ? ` ${css.sideBlockHot}` : ''
                return (
                  <Fragment key={`l${i}`}>
                    <span className={`${sideNumClass(row, 'left')}${hotClass}`}>{row.left!.line}</span>
                    <span className={`${css.sideCode} ${sideCodeClass(row, 'left')}${hotClass}`} data-block={row.block >= 0 ? row.block : undefined}>
                      {renderSideCode(row.left, leftSyntax?.[i])}
                      {hot && k === hotFirstLeft ? blockBar(row.block) : null}
                    </span>
                  </Fragment>
                )
              })
            ) : (
              rows.map((row, i) => {
                const hot = hotBlock !== null && row.block === hotBlock
                const hotClass = hot ? ` ${css.sideBlockHot}` : ''
                // The block's action bar rides in this column only for a row
                // with no right-hand side — a pure deletion, where the right
                // column has no cell to hang it on.
                const bar = hot && i === hotFirst && row.right === null ? blockBar(row.block) : null
                return (
                  <Fragment key={i}>
                    <span className={`${sideNumClass(row, 'left')}${hotClass}`}>{row.left === null ? '' : row.left.line}</span>
                    <span className={`${css.sideCode} ${sideCodeClass(row, 'left')}${hotClass}`} data-block={row.block >= 0 ? row.block : undefined}>
                      {renderSideCode(row.left, leftSyntax?.[i])}
                      {bar}
                    </span>
                  </Fragment>
                )
              })
            )}
          </div>
        </div>
        <PaneDivider label={t('resizeSides')} onDrag={onSplitDrag} />
        <div className={`${css.sideCol} ${css.sideColRight}`}>
          {bodyState.kind === 'editor' ? (
            <CodeEditor
              value={edit.buffer}
              original={indexText}
              onChange={next => { setEdit(prev => ({ ...prev, buffer: next })) }}
              syntax={editSyntax}
              indent={indentOfBuffer}
              ariaLabel={path}
              onSave={() => { if (dirty && !saving) void runSave(edit.baseSha) }}
            />
          ) : (
            <div className={css.sideColGrid}>
              {rows.map((row, i) => {
                const hot = hotBlock !== null && row.block === hotBlock
                const hotClass = hot ? ` ${css.sideBlockHot}` : ''
                const bar = hot && i === hotFirst && row.right !== null ? blockBar(row.block) : null
                return (
                  <Fragment key={i}>
                    <span className={`${sideNumClass(row, 'right')}${hotClass}`}>{row.right === null ? '' : row.right.line}</span>
                    <span
                      className={`${css.sideCode} ${sideCodeClass(row, 'right')}${hotClass}${layer === 'unstaged' && armable ? ` ${css.sideArmable}` : ''}`}
                      data-block={row.block >= 0 ? row.block : undefined}
                      onClick={layer === 'unstaged' && armable ? armFromCell : undefined}
                    >
                      {renderSideCode(row.right, rightSyntax?.[i])}
                      {bar}
                    </span>
                  </Fragment>
                )
              })}
            </div>
          )}
        </div>
      </div>
      )}
      </div>
      {pendingLayer !== null ? (
        <LeaveEditsConfirm t={t} path={path} onCancel={() => { setPendingLayer(null) }} onConfirm={confirmLeave} />
      ) : null}
    </div>
  )
}

/**
 * The unsaved-edits guard, rendered at both sites that defer a gesture on the
 * buffer's answer: the pane's layer-tab switch, and the drawer level (file
 * selection, main tab, source switch, close) for every gesture that would
 * drop the buffer. Same reason as the roll-back confirmation — the click it
 * answers to is one gesture away from losing work. Cancel holds the initial
 * focus and Escape closes, because the default answer to losing edits is no.
 */
function LeaveEditsConfirm({ t, path, onCancel, onConfirm }: {
  t: Translate
  path: string
  onCancel: () => void
  onConfirm: () => void
}): ReactNode {
  const stayRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { stayRef.current?.focus() }, [])
  useEffect(() => {
    // Capture phase, like the roll-back dialog: while a question about edits
    // is open, Escape answers it and nothing else — consumed here, before it
    // can reach the page's other Escape handlers (an open picker's dismiss,
    // the commit box's undo).
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onCancel()
    }
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('keydown', onKey, true) }
  }, [onCancel])
  return (
    <div className={css.confirmScrim} onClick={onCancel}>
      <div
        className={css.confirmBox}
        role="alertdialog"
        aria-modal="true"
        aria-label={t('unsavedTitle')}
        onClick={event => event.stopPropagation()}
      >
        <div className={css.confirmTitle}>{t('unsavedTitle')}</div>
        <div className={css.confirmBody}>{t('unsavedBody', { path })}</div>
        <div className={css.confirmActions}>
          <button ref={stayRef} type="button" className={css.btn} onClick={onCancel}>{t('unsavedStay')}</button>
          <button type="button" className={`${css.btn} ${css.btnDanger}`} onClick={onConfirm}>{t('unsavedLeave')}</button>
        </div>
      </div>
    </div>
  )
}

/** Line-number cell class: a PRESENT cell of a changed row carries its side's
 *  tint into the gutter; an absent one stays blank, the way a split diff shows
 *  a one-sided change with an empty opposite pane rather than a tinted void. */
function sideNumClass(row: SideRow, side: 'left' | 'right'): string {
  const cell = side === 'left' ? row.left : row.right
  if (cell === null || row.kind === 'same') return css.sideNum
  return `${css.sideNum} ${side === 'left' ? css.sideNumDel : css.sideNumAdd}`
}

/** Code cell class: deletions tint left, additions right, context stays quiet. */
function sideCodeClass(row: SideRow, side: 'left' | 'right'): string {
  const cell = side === 'left' ? row.left : row.right
  if (cell === null || row.kind === 'same') return css.sideCodeSame
  return `${side === 'left' ? css.sideCodeDel : css.sideCodeAdd} ${css.sideCellBlock}`
}

/** One cell's Shiki runs, or its plain text when no tokens exist. */
function renderSideCode(cell: SideCell | null, tokens: readonly HighlightRun[] | undefined): ReactNode {
  if (cell === null) return ''
  if (tokens === undefined || tokens.length === 0) return cell.text
  if (tokens.length === 1 && tokens[0]!.color === undefined && !tokens[0]!.italic) return cell.text
  return tokens.map((tok, i) => (
    <span
      key={i}
      style={tok.color === undefined && !tok.italic ? undefined : { color: tok.color, fontStyle: tok.italic ? 'italic' : undefined }}
    >{tok.text}</span>
  ))
}

/* ---------- shared helpers ---------- */

/** Split a combined `git diff` into path -> its segment text. */
function splitDiff(diff: string): Map<string, string> {
  const out = new Map<string, string>()
  if (diff.length === 0) return out
  for (const part of diff.split(/(?=^diff --git )/m)) {
    if (part.length === 0) continue
    const path = extractDiffPath(part)
    if (path.length > 0) out.set(path, part)
  }
  return out
}

function extractDiffPath(part: string): string {
  const firstLine = part.split('\n')[0] ?? ''
  const match = /\sb\/(.+)$/.exec(firstLine)
  if (match !== null) return match[1]
  const rename = /^rename to (.+)$/m.exec(part)
  if (rename !== null) return rename[1]
  const del = /\ba\/(.+)$/.exec(firstLine)
  return del !== null ? del[1] : ''
}

/**
 * A branch name, or the stand-in when there is none.
 *
 * This used to also cut the name to 21 characters and append an ellipsis, which
 * is how `feature/nested/deep/some-fix` reached the header as
 * `feature/nested/deep/s…` — the truncation was in JS, so it happened at the
 * same 21 characters whether the drawer was 400px or maximised, and it cut off
 * the only end that says which branch this is. Width is the stylesheet's
 * question; {@link Elided} answers it, from the correct end, only when there is
 * genuinely not enough room.
 *
 * @param branch - branch name, empty when the repo has none yet.
 * @param empty - already-translated stand-in for the empty case.
 */
function branchLabel(branch: string, empty: string): string {
  return branch.length === 0 ? empty : branch
}

function statusGlyph(status: GitFileStatus): string {
  switch (status) {
    case 'added': return 'A'
    case 'untracked': return 'U'
    case 'modified': return 'M'
    case 'renamed': return 'R'
    case 'deleted': return 'D'
  }
}

function basePart(path: string): string {
  const cut = path.lastIndexOf('/')
  return cut >= 0 ? path.slice(cut + 1) : path
}
