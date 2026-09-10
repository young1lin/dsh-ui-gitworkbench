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
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  DEFAULT_APPEARANCE, EMPTY_SETTINGS, DSH_DARK_ATTR, effectiveBackground, effectiveCss, hostSchemeDark,
  isAppearance, resolveTheme, withScope,
  type Appearance, type ColorMode, type StyleEntry, type StyleScope, type StyleSettings, type ThemeFamily,
} from './themes.ts'
import { clampPane, neighbourWidth } from './pane-size.ts'
import { COMMIT_ROW_H, DEFAULT_HISTORY_LAYOUT, isHistoryLayout, type HistoryLayout } from './history-layout.ts'
import {
  gateLeave, LEAVE_GUARD_CLEAR, leaveAnswered, leaveAsked, paneDirtyReport,
  type LeaveGuard, type WriteResult,
} from './side-edit.ts'
import { FileBrowser } from './FileBrowser.tsx'
import { ColumnsGlyph, CommitList, LayoutButton, StackedGlyph } from './CommitHistory.tsx'
import { FileTree } from './ChangesFileTree.tsx'
import { DiffView, LeaveEditsConfirm, SideBySideView } from './DiffViews.tsx'
import { PaneDivider, usePaneDrag } from './PaneDivider.tsx'
import { ChromeGlyph } from './ChromeGlyph.tsx'
import { WorktreeGlyph } from './WorktreeGlyph.tsx'
import {
  blockDiscardBodyText, branchLabel, CommitBox, CompareBar, DiscardConfirm, discardBodyText, Elided,
  opMessage, RefPicker, SettingsMenu, SourceChip, SyncBar,
} from './WorkbenchControls.tsx'
import { decodePlaces, encodePlaces, placeAt, withPlace, type FilesPlace, type FilesPlaces } from './files-place.ts'
import { NO_IGNORED_READS, type DirRead, type IgnoredCache } from './ignored-cache.ts'
import { useIdleValue } from './idle-value.ts'
import { emptyQueryFilter, parseLogQuery, serializeLogQuery } from './log-filter-query.ts'
import { nextAfterPlan, type DiscardAnswer, type DiscardPreview } from './discard-flow.ts'
import { isPhantomModified } from './diff-model.ts'
import { NO_PATHS, preferredFile } from './active-file.ts'
import type { LogFilter } from '../log-filter.ts'
import type { AuthorEntry } from '../shortlog.ts'
import {
  nextAction, nextBatch, pathsFor, settledTicks, withPendingTicks,
  type Tick, type TickAction,
} from './stage-tree.ts'
import { badgeRepeatsBranch, bindingChanged, branchOfWorktree, pathKey, probesClosedBinding, samePath, showsPending, turnSettled, viewedPath } from './worktree-view.ts'
import css from './GitWorkbenchPanel.module.css'

export type * from './git-workbench-types.ts'
export type { IgnoredChild } from './ignored-cache.ts'
import type {
  BlameAnswer, BlockAsk, BlockMode, FileImage, FileSides, GitCommit, GitFile,
  GitOpName, GitOpPayload, GitOpResult, SideLayer, SyncStatus, Translate, WorkbenchStats,
  WorktreeBinding, WorktreeEntry, WorktreeStatus,
} from './git-workbench-types.ts'

type Props = PropsRuntime<'conversation.session.header.actions'> & {
  readonly t: Translate
  readonly fetchStats: (worktreePath: string | undefined, signal: AbortSignal) => Promise<WorkbenchStats | null>
  readonly fetchFileDiff: (worktreePath: string | undefined, path: string, commit: string | undefined, range: { base: string; head: string } | undefined, signal: AbortSignal) => Promise<string>
  /** One layer of one file for the side-by-side diff pane. */
  readonly fetchFileSides: (worktreePath: string | undefined, path: string, layer: SideLayer, signal: AbortSignal) => Promise<FileSides | null>
  /** Save the editor buffer, checked against the sha it opened with. */
  readonly writeChecked: (worktreePath: string | undefined, path: string, text: string, expectedSha: string, signal: AbortSignal) => Promise<WriteResult | null>
  readonly fetchBlame: (worktreePath: string | undefined, path: string, signal: AbortSignal) => Promise<BlameAnswer | null>
  /** One file's bytes, when they are an image. Null when the host half is
   *  older than this client: the view then falls back to the text answer. */
  readonly fetchFileImage: (worktreePath: string | undefined, path: string, signal: AbortSignal) => Promise<FileImage | null>
  /** Where the symbol at a zero-based protocol position is defined. */
  readonly fetchWorktreeStatus: (sessionId: string, repoPath: string | undefined, signal: AbortSignal) => Promise<WorktreeStatus | null>
  /** Binding only, no git — the probe the shut chip can afford to poll. */
  readonly fetchSessionBinding: (sessionId: string, signal: AbortSignal) => Promise<{ worktreePath: string | null; name: string | null } | null>
  readonly fetchCommitStats: (worktreePath: string | undefined, hash: string, signal: AbortSignal) => Promise<WorkbenchStats | null>
  readonly fetchCommits: (worktreePath: string | undefined, ref: string, skip: number, limit: number, filter: LogFilter, signal: AbortSignal) => Promise<{ commits: GitCommit[]; hasMore: boolean; error?: string } | null>
  /** Author roster for the filter popup's user picker, busiest first — for the
   *  ref the history walks, so every listed author actually has commits there. */
  readonly fetchAuthors: (worktreePath: string | undefined, ref: string, signal: AbortSignal) => Promise<{ authors: readonly AuthorEntry[]; truncated: boolean } | null>
  /** Every path on HEAD — the path picker's raw material. */
  readonly fetchRepoTree: (worktreePath: string | undefined, signal: AbortSignal) => Promise<RepoTreeAnswer | null>
  /** One level of one ignored directory, read from the filesystem — the step
   *  behind expanding `node_modules/` in the Files tab. Null when the host
   *  half is older than this client, which also sends no ignored entries, so
   *  the call is never made. */
  readonly fetchIgnoredDir: (worktreePath: string | undefined, dir: string, signal: AbortSignal) => Promise<DirRead | null>
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
/** Floors for the History tab's horizontal split. The list keeps enough for a
 *  few rows to read as a list rather than as a strip; the half below keeps
 *  enough that the tree and the diff are still worth rendering. */
const MIN_COMMITS_HEIGHT = 90
const MIN_STACKED_LOWER = 200



/** Element carrying the user's custom stylesheet. One per document. */
const CUSTOM_STYLE_ID = 'dsh-ui-gitworkbench-custom-css'

/** localStorage keys. Namespaced, since the whole app shares one origin.
 *  Layout and palette live here; the background image and custom CSS do not —
 *  they are per-project state the host owns, see `styleGet`/`styleSet`. */
const STORE_APPEARANCE = 'dsh-ui-gitworkbench:appearance'
const STORE_WIDTH = 'dsh-ui-gitworkbench:width'
const STORE_PANES = 'dsh-ui-gitworkbench:panes'
/** Where the reader was in the Files tab, per worktree. View state, so it
 *  belongs here beside the layout rather than in the host's per-project store:
 *  two people on one repository should not share each other's place. */
const STORE_FILES = 'dsh-ui-gitworkbench:files'
/** Which way the History tab arranges its panes. Its own key rather than a
 *  field of the appearance object: that one is about colour, and this choice
 *  has to survive a build that adds a palette. */
const STORE_HISTORY_LAYOUT = 'dsh-ui-gitworkbench:history-layout'
/** Soft wrap, on or off. A reading preference rather than a project setting:
 *  it says how THIS person wants long lines shown, so it lives beside the
 *  pane sizes in localStorage rather than in the shared style store. */
const STORE_WRAP = 'dsh-ui-gitworkbench:wrap'

/** Dragged pane sizes in px; null on any of them keeps that pane's CSS default. */
interface PaneWidths {
  readonly commits: number | null
  readonly tree: number | null
  /**
   * The commit list's HEIGHT, which is what the History tab's divider moves
   * now that the list spans the drawer's full width.
   *
   * Optional because storage is a durable boundary: values written before the
   * tab was stacked have no such field, and rejecting them outright would
   * throw away the column widths the reader had already chosen.
   */
  readonly commitsTall?: number | null
}

/** The two panes whose WIDTH a divider drags. `commitsTall` is deliberately
 *  not one of them — it is a height, with its own floors. */
type PaneWidthKey = 'commits' | 'tree'

const DEFAULT_PANES: PaneWidths = { commits: null, tree: null, commitsTall: null }

/**
 * @param value - value read back from storage.
 * @returns whether it is a pane-width pair this build can use.
 */
function isPaneWidths(value: unknown): value is PaneWidths {
  if (typeof value !== 'object' || value === null) return false
  const { commits, tree, commitsTall } = value as Partial<PaneWidths>
  const ok = (v: unknown): boolean => v === null || (typeof v === 'number' && Number.isFinite(v))
  return ok(commits) && ok(tree) && (commitsTall === undefined || ok(commitsTall))
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



/** Commit change sets kept in the browser before the least recently used is dropped. */
const COMMIT_CACHE_CAPACITY = 24

/** Stand-in while a commit's change set is in flight — every pane renders empty. */
const EMPTY_STATS: WorkbenchStats = {
  worktreePath: '', branch: '', ahead: 0, behind: 0, detached: false,
  addedLines: 0, deletedLines: 0, addedFiles: 0, deletedFiles: 0, modifiedFiles: 0,
  files: [], diff: '', commits: [],
}

/** How long the Files place must hold still before it is written. */
const PLACES_WRITE_MS = 500

/**
 * What `repoTree` answers. The ignored fields are OPTIONAL because a host
 * half older than this client sends none of them — the browser then simply
 * has no ignored rows to show. Named rather than inlined so the panel, the
 * drawer and the browser cannot drift apart on what crosses the wire.
 */
export interface RepoTreeAnswer {
  paths: string[]
  truncated: boolean
  ignored?: string[]
  ignoredTruncated?: boolean
  /** Set when the ignored listing itself failed, so "nothing ignored" and
   *  "could not ask" are not the same silence. */
  ignoredError?: string
}

/** One worktree's last-read file list. Exported because the browser takes it
 *  whole: one shape for the cache and the update, so the two cannot drift. */
export interface FilesTree {
  readonly paths: readonly string[]
  readonly truncated: boolean
  /** Ignored entries exactly as `repoTree` sent them: full paths for ignored
   *  files, one trailing-slash line per directory a rule ignores whole. */
  readonly ignored: readonly string[]
  readonly ignoredTruncated: boolean
  /** Why the ignored listing is missing, when it is. Absent on success — an
   *  empty list then means the repository really has nothing ignored. */
  readonly ignoredError?: string
  /** Children read so far — the payload of every lazy expansion the reader
   *  has made in this worktree, bounded and evicting (`ignored-cache.ts`). */
  readonly children: IgnoredCache
}

/** A worktree nobody has opened the Files tab on yet. One instance, so an
 *  unvisited worktree does not re-render the browser on every pass. */
const EMPTY_TREE: FilesTree = {
  paths: [], truncated: false, ignored: [], ignoredTruncated: false, children: NO_IGNORED_READS,
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



export function GitWorkbenchPanel({ sessionId, useSessions, t, fetchStats, fetchFileDiff, fetchFileSides, writeChecked, fetchBlame, fetchFileImage, fetchWorktreeStatus, fetchSessionBinding, fetchCommitStats, fetchCommits, fetchAuthors, fetchRepoTree, fetchIgnoredDir, fetchCompare, fetchStyle, saveStyle, fetchSync, runGitOp, fetchDiscardPlan }: Props) {
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
  // The Files tab's place and its last file list, ONE PER WORKTREE. Held here
  // rather than in the browser because the browser unmounts whenever another
  // tab is looked at: without this, coming back lost the selection and every
  // expanded folder, which is the difference between a tab you return to and
  // one you start over in.
  //
  // Per worktree because a worktree is a different place — different files, at
  // different paths, and the open one may not exist in the next one at all.
  // Keying the cached list too is what stops a switch from rendering the
  // previous worktree's files until the new list arrives.
  const [filesPlaces, setFilesPlaces] = useState<FilesPlaces>(
    () => decodePlaces(readStored<unknown>(STORE_FILES, (value): value is unknown => true, null)),
  )
  const [filesTrees, setFilesTrees] = useState<ReadonlyMap<string, FilesTree>>(() => new Map())
  const rememberPlace = useCallback((key: string, next: FilesPlace): void => {
    setFilesPlaces(prev => withPlace(prev, key, next))
  }, [])
  // An UPDATER, not a value: two lazy directory reads can land in the same
  // microtask, before React has re-rendered either into the browser. Both
  // would then build their write from the same stale tree and the first one's
  // children would be silently dropped — which the effect below the browser
  // notices and re-reads, turning N expanded directories into O(N²) disk
  // reads. Folding the merge into the setState is what makes each write see
  // the one before it.
  const rememberTree = useCallback((key: string, update: (prev: FilesTree) => FilesTree): void => {
    setFilesTrees(prev => {
      const map = new Map(prev)
      map.set(key, update(prev.get(key) ?? EMPTY_TREE))
      return map
    })
  }, [])
  // Written on a pause, not on the change: expanding a folder and typing in
  // the search box both move the place, and localStorage writes synchronously.
  const settledPlaces = useIdleValue(filesPlaces, PLACES_WRITE_MS)
  useEffect(() => { writeStored(STORE_FILES, encodePlaces(settledPlaces)) }, [settledPlaces])
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
  /**
   * The History tab's arrangement.
   *
   * Panel-level, beside the palette rather than inside the tab: the choice has
   * to hold across tab switches and reopens, and the drawer's own card is where
   * the row height it implies is published from.
   */
  const [historyLayout, setHistoryLayout] = useState<HistoryLayout>(
    () => readStored(STORE_HISTORY_LAYOUT, isHistoryLayout, DEFAULT_HISTORY_LAYOUT),
  )
  /** Soft wrap. Default OFF, which is what the panes have always done: code is
   *  written in columns, and wrapping it is a choice about one long file, not
   *  a better default for every file. */
  const [wrap, setWrap] = useState<boolean>(
    () => readStored(STORE_WRAP, (value): value is boolean => typeof value === 'boolean', false),
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
      // Each tab asks its own question about the path. Compare used to ask
      // nothing at all — `fileDiff` had no way to take a ref range, so a file
      // the bundled payload did not carry simply had no detail, which is what
      // an added XML file past the payload cap looked like.
      const range = tab === 'compare' ? { base: baseRef, head: headRef } : undefined
      const commit = tab === 'history' ? commitHash ?? undefined : undefined
      return fetchFileDiff(statsPath, path, commit, range, signal)
    },
    [fetchFileDiff, statsPath, tab, commitHash, baseRef, headRef],
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
  const applyPane = (which: PaneWidthKey, next: number, measured: { drawer: number; commits: number; tree: number }, persist: boolean): void => {
    const min = which === 'commits' ? MIN_COMMITS_WIDTH : MIN_TREE_WIDTH
    const other = which === 'commits' ? measured.tree : measured.commits
    const clamped = clampPane(next, min, measured.drawer, other, MIN_DIFF_WIDTH)
    setPanes(prev => {
      const updated = { ...prev, [which]: clamped }
      if (persist) writeStored(STORE_PANES, updated)
      return updated
    })
  }

  /**
   * Drag the History tab's horizontal split.
   *
   * Clamped the same way `applyPane` clamps a width, and for the same reason:
   * a pane dragged to nothing reads as broken and offers nothing to drag back
   * out. The outer `Math.max` keeps the range from inverting in a drawer too
   * short to hold both floors — the list then simply takes its minimum.
   *
   * @param next - the height in px the pointer implies.
   * @param bodyHeight - the space the two stacked halves share.
   * @param persist - false for every intermediate frame of a drag, so a
   *   synchronous localStorage write never lands mid-resize.
   */
  const applyCommitsTall = (next: number, bodyHeight: number, persist: boolean): void => {
    const max = Math.max(MIN_COMMITS_HEIGHT, bodyHeight - MIN_STACKED_LOWER)
    const clamped = Math.min(Math.max(next, MIN_COMMITS_HEIGHT), max)
    setPanes(prev => {
      const updated = { ...prev, commitsTall: clamped }
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

  /**
   * Pick the History tab's arrangement.
   *
   * Written through immediately: unlike a drag this is one click, so there is
   * no intermediate frame to withhold a synchronous storage write for.
   * @param next - the arrangement to switch to.
   */
  const applyHistoryLayout = (next: HistoryLayout): void => {
    setHistoryLayout(next)
    writeStored(STORE_HISTORY_LAYOUT, next)
  }

  /**
   * Turn soft wrap on or off, and remember it.
   *
   * A plain function, like every other handler below the two guards above:
   * those `return null`s are the reason nothing past this point may be a HOOK.
   * A `useCallback` here rendered fewer hooks than the previous pass on the
   * frame the first stats arrived, which React reports as error #310 and the
   * shell reports as "slot entry crashed" — the chip simply vanishes.
   */
  const toggleWrap = (): void => {
    setWrap(prev => {
      writeStored(STORE_WRAP, !prev)
      return !prev
    })
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
          onCommitsTall={applyCommitsTall}
          historyLayout={historyLayout}
          onHistoryLayout={applyHistoryLayout}
          onClose={() => setOpen(false)}
          onRefresh={refresh}
          wrap={wrap}
          onToggleWrap={toggleWrap}
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
          fetchFileImage={fetchFileImage}
          fetchIgnoredDir={fetchIgnoredDir}
          viewKey={viewKey}
          gen={gen}
          collapsed={collapsed}
          filesPlaces={filesPlaces}
          onFilesPlace={rememberPlace}
          filesTrees={filesTrees}
          onFilesTree={rememberTree}
          onCollapsedChange={setCollapsed}
        />
      ) : null}
    </>
  )
}

/* ---------- header environment card ---------- */







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
  fetchRepoTree: (worktreePath: string | undefined, signal: AbortSignal) => Promise<RepoTreeAnswer | null>
  fetchIgnoredDir: (worktreePath: string | undefined, dir: string, signal: AbortSignal) => Promise<DirRead | null>
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
  onPane: (which: PaneWidthKey, next: number, measured: { drawer: number; commits: number; tree: number }, persist: boolean) => void
  /** Drag the History tab's horizontal split: the commit list's height in px. */
  onCommitsTall: (next: number, bodyHeight: number, persist: boolean) => void
  /** Which way the History tab arranges its panes. */
  historyLayout: HistoryLayout
  onHistoryLayout: (next: HistoryLayout) => void
  onClose: () => void
  onRefresh: () => void
  /** Soft wrap, shared by every pane that shows code — the Files editor and
   *  both diff views — because it is one reading preference, not three. */
  wrap: boolean
  onToggleWrap: () => void
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
  fetchFileImage: (worktreePath: string | undefined, path: string, signal: AbortSignal) => Promise<FileImage | null>
  /** Identifies the view the per-file diff cache belongs to (working tree, or one commit). */
  viewKey: string
  gen: number
  collapsed: Set<string> | undefined
  filesPlaces: FilesPlaces
  onFilesPlace: (key: string, next: FilesPlace) => void
  filesTrees: ReadonlyMap<string, FilesTree>
  onFilesTree: (key: string, update: (prev: FilesTree) => FilesTree) => void
  onCollapsedChange: (next: Set<string>) => void
}

function Drawer({ stats, shown, tab, onSwitchTab, commits, commitHash, onSelectCommit, hasMoreCommits, loadingMore, onLoadMoreCommits, historyRef, onHistoryRef, historyQuery, onHistoryQuery, historyError, fetchAuthors, fetchRepoTree, fetchIgnoredDir, branches, worktreeBranches, branchesTruncated, baseRef, headRef, onBaseRef, onHeadRef, comparable, t, binding, worktrees, sessionPath, statsPath, onSwitchSource, segments, selected, onSelect, maximized, onToggleMaximized, theme, mode, family, onMode, onFamily, style, background, onStyle, width, onWidth, panes, onPane, onCommitsTall, historyLayout, onHistoryLayout, onClose, onRefresh, wrap, onToggleWrap, commitDraft, onCommitDraft, commitAmend, onCommitAmend, sync, treeLoading, historyLoading, busy, opResult, runOp, fetchDiscardPlan, onOpError, pendingTicks, onTick, fetchFileDiff, fetchFileSides, writeChecked, fetchBlame, fetchFileImage, viewKey, gen, collapsed, onCollapsedChange, filesPlaces, onFilesPlace, filesTrees, onFilesTree }: DrawerProps): ReactNode {
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
  /** Which worktree the Files tab is remembering for. */
  const filesKey = pathKey(statsPath)
  const rememberPlaceHere = useCallback(
    (next: FilesPlace) => { onFilesPlace(filesKey, next) }, [onFilesPlace, filesKey])
  const rememberTreeHere = useCallback(
    (update: (prev: FilesTree) => FilesTree) => { onFilesTree(filesKey, update) }, [onFilesTree, filesKey])
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
  /** The CRLF phantom: listed modified, whole-file diff empty (see
   *  {@link isPhantomModified}). Changes-tab only — history and compare list
   *  files from real ref diffs, where an empty segment means a failed fetch,
   *  and the phantom notice would mislead. */
  const phantomListed = tab === 'changes' && isPhantomModified(activeFile?.status, segment)

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
  /** The two stacked halves' shared box, which the History split measures in. */
  const bodyRef = useRef<HTMLDivElement>(null)
  const commitsRef = useRef<HTMLDivElement>(null)
  const treeRef = useRef<HTMLDivElement>(null)
  const edgeDrag = usePaneDrag()

  /**
   * What a pane drag is clamped against: the drawer's inner width and what the
   * panes currently occupy. Read live, because the drawer itself can have been
   * resized since the last render.
   * @returns the three widths in px.
   */
  const measurePanes = (): { drawer: number; commits: number; tree: number } => {
    const commits = commitsRef.current?.getBoundingClientRect() ?? null
    const tree = treeRef.current?.getBoundingClientRect() ?? null
    return {
      drawer: drawerRef.current?.clientWidth ?? window.innerWidth,
      // Each width counts only where the pane is actually IN THE WAY of the
      // other. Stacked, the commit list spans the drawer above the row rather
      // than sitting beside the tree, and taking its width as the tree's
      // neighbour made the ceiling smaller than the floor — the tree stayed at
      // its minimum whatever the pointer did.
      commits: neighbourWidth(commits, tree),
      tree: neighbourWidth(tree, commits),
    }
  }

  /**
   * @param which - the pane a divider resizes.
   * @param ref - that pane's element, whose left edge the width is measured from.
   * @returns a drag handler for {@link PaneDivider}.
   */
  const paneDrag = (which: PaneWidthKey, ref: { current: HTMLDivElement | null }) =>
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

  /**
    * The History tab's commit list, sized by height instead. `flex: none` so
    * the height is the height — a flex child in a column would otherwise
    * stretch or shrink away from it.
    *
    * The floor and the ceiling are NOT applied here. A stored height is a
    * number of pixels, and the drag that produced it clamped against the body
    * as it stood at that moment; the window can be made shorter afterwards,
    * and then a height that was reasonable becomes taller than everything.
    * The lower half collapses to nothing and the handle is pushed past the
    * bottom edge — there is no longer anything on screen to drag back, which
    * is the one failure mode a resizable split must not have. So the clamp
    * lives in the stylesheet, against `100%` of whatever the body currently
    * is, from the same two constants the drag clamp uses. The reader's chosen
    * height is kept, not rewritten: make the window tall again and it returns.
    */
  const paneTall = (px: number | null): CSSProperties | undefined =>
    px === null ? undefined : { height: `${px}px`, flex: 'none' }

  /** The stacked split, measured from the top of the body rather than from the
   *  list: the list's own top is what the drag is moving the bottom of, and
   *  measuring from a moving edge makes the handle drift under the pointer. */
  const commitsTallDrag = (clientY: number, done: boolean): void => {
    const box = bodyRef.current?.getBoundingClientRect()
    if (box === undefined) return
    onCommitsTall(clientY - box.top, box.height, done)
  }

  /**
   * Whether the History tab is showing its stacked arrangement.
   *
   * Three things follow from it and they must agree: the body's direction, how
   * the commit list is sized, and which way its divider slides. Read from one
   * name so a fourth reader cannot be added out of step.
   */
  const stackedHistory = tab === 'history' && historyLayout === 'stacked'

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
      '--gs-min-commits-tall': `${MIN_COMMITS_HEIGHT}px`,
      '--gs-min-stacked-lower': `${MIN_STACKED_LOWER}px`,
      // The commit row's height, which the lane graph also draws itself at.
      // Published rather than written into the stylesheet twice: the two
      // arrangements want different rows, and lanes only meet across the seam
      // between rows while both numbers come from `COMMIT_ROW_H`.
      '--gs-commit-row': `${COMMIT_ROW_H[historyLayout]}px`,
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
              className={wrap ? `${css.btn} ${css.btnIcon} ${css.btnIconOn}` : `${css.btn} ${css.btnIcon}`}
              aria-pressed={wrap}
              aria-label={wrap ? t('wrapLinesOff') : t('wrapLines')}
              title={wrap ? t('wrapLinesOff') : t('wrapLines')}
              onClick={onToggleWrap}
            ><ChromeGlyph of="wrap" /></button>
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
        {/* History's own toolbar: which ref is listed, and how the panes are
            arranged. The switch lives HERE rather than in the commit list's
            head because that head is about 340px wide in the column layout and
            already holds a title, a funnel and a search box — adding a fourth
            control pushed it off the pane, and the narrower the reader dragged
            the list the sooner it went. This row spans the drawer whichever
            arrangement is in force, so the control cannot be squeezed out of
            reach by the thing it controls.

            The bar renders for the whole tab, not only when there are branches
            to pick between: a repository with an unborn HEAD still has an
            arrangement, and a control that comes and goes is worse than one
            beside an empty space. */}
        {tab === 'history' ? (
          <div className={css.compareBar}>
            {branches.length > 0 ? (
              <RefPicker
                t={t} label={t('historyRefLabel')} value={historyRef}
                branches={branches} worktreeBranches={worktreeBranches} truncated={branchesTruncated}
                onPick={onHistoryRef}
                allLabel={t('allBranches')}
              />
            ) : null}
            {/* Two pressed-state buttons rather than one that toggles, so the
                arrangement in force is readable without knowing which way a
                toggle points. */}
            <div className={css.layoutSwitch} role="group" aria-label={t('historyLayout')}>
              <LayoutButton
                glyph={<ColumnsGlyph />}
                label={t('layoutColumns')}
                on={historyLayout === 'columns'}
                onPick={() => onHistoryLayout('columns')}
              />
              <LayoutButton
                glyph={<StackedGlyph />}
                label={t('layoutStacked')}
                on={historyLayout === 'stacked'}
                onPick={() => onHistoryLayout('stacked')}
              />
            </div>
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
        {/* History arranges itself two ways and the reader picks; see
            `history-layout.ts` for what each is good at. Stacked, the commit
            list spans the top and the tree and diff sit below it, so a subject
            is never cut; in columns the list is a pane beside them, so the log
            is as tall as the drawer. Everything else on the tab is identical,
            which is why one flag decides all three differences here. */}
        <div ref={bodyRef} className={css.body} data-stacked={stackedHistory ? '' : undefined}>
          {tab === 'history' ? (
            <>
              <CommitList
                paneRef={commitsRef}
                style={stackedHistory ? paneTall(panes.commitsTall ?? null) : paneStyle(panes.commits)}
                layout={historyLayout}
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
              {/* Each arrangement drags its own stored size — a width and a
                  height are separate fields, so switching back finds the pane
                  where it was left rather than reset. */}
              {stackedHistory
                ? <PaneDivider axis="y" label={t('resizeCommits')} onDrag={commitsTallDrag} />
                : <PaneDivider label={t('resizeCommits')} onDrag={paneDrag('commits', commitsRef)} />}
            </>
          ) : null}
          <div className={css.bodyRow}>
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
              place={placeAt(filesPlaces, filesKey)}
              onPlace={rememberPlaceHere}
              cached={filesTrees.get(filesKey) ?? EMPTY_TREE}
              onTree={rememberTreeHere}
              wrap={wrap}
              fetchRepoTree={fetchRepoTree}
              fetchIgnoredDir={fetchIgnoredDir}
              fetchFileSides={fetchFileSides}
              writeChecked={writeChecked}
              fetchBlame={fetchBlame}
              fetchFileImage={fetchFileImage}
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
            {/* An empty compare result is usually the three-dot DIRECTION, not
                "no differences": A...B diffs from the fork point up to B, so a
                B that never moved past the fork shows nothing at all. Say so —
                an empty tree with no word reads as a broken one. */}
            {tab === 'compare' && comparable && shown !== null && body.files.length === 0 ? (
              <div className={css.empty}>{t('compareEmptyHint', { base: baseRef ?? '', head: headRef ?? '' })}</div>
            ) : null}
            {(shown === null && tab !== 'changes') || (tab === 'compare' && !comparable) ? null
              : activeFile !== null && activeFile.binary ? (
                <div className={css.empty}>{t('binaryFile')}</div>
              ) : tab === 'changes' && active !== null ? (
                <SideBySideView
                  t={t}
                  path={active}
                  palette={theme}
                  wrap={wrap}
                  statsPath={statsPath}
                  fetchSides={fetchFileSides}
                  writeChecked={writeChecked}
                  scopeKey={viewKey}
                  gen={gen}
                  fallbackSegment={segment}
                  fallbackLoading={loading && segment.length === 0}
                  phantomListed={phantomListed}
                  onBlockAction={askBlockAction}
                  onSaved={onRefresh}
                  onDirtyChange={onSideDirty}
                />
              ) : loading && segment.length === 0 ? (
                <div className={css.empty}>{t('loadingDiff')}</div>
              ) : segment.length > 0 ? (
                <DiffView segment={segment} path={active ?? ''} palette={theme} t={t} wrap={wrap} />
              ) : (
                <div className={css.empty}>{t('noTextDiff')}</div>
              )}
          </div>
            </>
          )}
          </div>
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
