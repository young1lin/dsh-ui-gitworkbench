import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type Ref } from 'react'
import { createPortal } from 'react-dom'

import { COMMIT_ROW_H, type HistoryLayout } from './history-layout.ts'
import { layoutGraph, type GraphRow } from './commit-graph.ts'
import { formatCommitDate } from './commit-filter.ts'
import { chipsFromFilter, parseLogQuery, removeChip, serializeLogQuery } from './log-filter-query.ts'
import { buildDirTree, searchPaths, type DirEntry } from './dir-tree.ts'
import { addPath, buildIndex, checkedState, isCovered, removePath } from './path-select.ts'
import { inCalRange, localTodayIso, monthGrid, weekdayLabels } from './calendar.ts'
import { PathDirGlyph, PathFileGlyph } from './glyphs.tsx'
import type { LogFilter } from '../log-filter.ts'
import type { AuthorEntry } from '../shortlog.ts'
import type { GitCommit, Translate } from './git-workbench-types.ts'
import type { WorkbenchKey } from './locales.ts'
import css from './GitWorkbenchPanel.module.css'

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
 * Drawn as an SVG exactly as tall as the row, so consecutive rows butt together
 * and a lane reads as one unbroken line down the list. The dot sits at the
 * vertical centre; edges leave the top edge, the dot, or the bottom edge, and a
 * cubic with its control points at the quarter heights gives the S-curve every
 * git client draws for a branch or a merge.
 *
 * The height is passed in rather than read from a constant here: the two
 * History arrangements want differently shaped rows, and the segment and the
 * row it belongs to must come from the same entry of `COMMIT_ROW_H` or the
 * lanes stop meeting across the seam between rows.
 */
function GraphCell({ row, width, active, rowH }: { row: GraphRow; width: number; active: boolean; rowH: number }): ReactNode {
  const lanes = Math.min(width, GRAPH_MAX_LANES)
  const w = lanes * GRAPH_LANE_W
  const mid = rowH / 2
  const visible = (lane: number): boolean => lane < GRAPH_MAX_LANES
  const stroke = (lane: number): string => `var(--gs-graph-${lane % 6})`

  const paths: ReactNode[] = []
  for (const lane of row.through) {
    if (!visible(lane)) continue
    paths.push(<path key={`t${lane}`} d={`M ${laneX(lane)} 0 V ${rowH}`} stroke={stroke(lane)} />)
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
      ? <path key={`o${lane}`} d={`M ${laneX(lane)} ${mid} V ${rowH}`} stroke={stroke(lane)} />
      : (
        <path
          key={`o${lane}`}
          d={`M ${laneX(row.lane)} ${mid} C ${laneX(row.lane)} ${mid + mid / 2}, ${laneX(lane)} ${mid + mid / 2}, ${laneX(lane)} ${rowH}`}
          stroke={stroke(lane)}
        />
      ))
  }

  return (
    <svg
      className={css.graphCell}
      width={w}
      height={rowH}
      viewBox={`0 0 ${w} ${rowH}`}
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

function CommitRow({ t, commit, active, onSelect, graphRow, graphWidth, layout }: {
  t: Translate
  commit: GitCommit
  active: boolean
  onSelect: (hash: string) => void
  /** This commit's lane geometry; absent while the graph is still empty. */
  graphRow?: GraphRow
  graphWidth: number
  /** Which arrangement the list is in, which decides the row's shape. */
  layout: HistoryLayout
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

  /* The part both shapes share, and the only part either is really for. */
  const subjectRow = (
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
  )

  return (
    <>
      {/* The graph is a SIBLING of the row button, spanning the line's full
          height with no margin of its own — that is what lets a lane run
          unbroken from one row into the next while the button itself keeps its
          inset and its rounded corners. */}
      <div className={css.commitLine}>
        {graphRow !== undefined
          ? <GraphCell row={graphRow} width={graphWidth} active={active} rowH={COMMIT_ROW_H[layout]} />
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
          {layout === 'stacked' ? (
            <>
              {/* One line, in git log --oneline's order: a fixed-width hash,
                  then the subject, then who and when pushed to the right. The
                  hash being fixed width is what aligns every subject into a
                  column the eye can run down — leading with the author's name
                  instead would start each subject at a different place. */}
              <code className={css.commitHash}>{commit.hash}</code>
              {subjectRow}
              <span className={css.commitMeta}>
                {authorName.length > 0 ? <span className={css.commitAuthor}>{authorName}</span> : null}
                <span className={css.commitWhen}>{commit.when}</span>
              </span>
            </>
          ) : (
            <>
              {/* Two lines, because a pane beside the diff has no width to
                  spare: everything but the subject goes above it, and the
                  subject then gets the column to itself. */}
              <span className={css.commitTop}>
                <code className={css.commitHash}>{commit.hash}</code>
                {authorName.length > 0 ? <span className={css.commitAuthor}>{authorName}</span> : null}
                <span className={css.commitWhen}>{commit.when}</span>
              </span>
              {subjectRow}
            </>
          )}
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
 * The two arrangements, drawn in the same 16px/1px idiom as the drawer's other
 * glyphs: a pane and its neighbour, either side by side or one over the other.
 * The filled half is the list, so the picture says which pane moves.
 */
export function ColumnsGlyph(): ReactNode {
  return (
    <svg
      className={css.layoutGlyph}
      width="16" height="16" viewBox="0 0 16 16"
      fill="none" stroke="currentColor" strokeWidth="1"
      strokeLinejoin="round" aria-hidden="true"
    >
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      <rect x="1.5" y="2.5" width="5" height="11" rx="1.5" fill="currentColor" stroke="none" opacity="0.55" />
      <path d="M6.5 2.5 V13.5" />
    </svg>
  )
}

export function StackedGlyph(): ReactNode {
  return (
    <svg
      className={css.layoutGlyph}
      width="16" height="16" viewBox="0 0 16 16"
      fill="none" stroke="currentColor" strokeWidth="1"
      strokeLinejoin="round" aria-hidden="true"
    >
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      <rect x="1.5" y="2.5" width="13" height="4" rx="1.5" fill="currentColor" stroke="none" opacity="0.55" />
      <path d="M1.5 6.5 H14.5" />
    </svg>
  )
}

/**
 * One end of the arrangement switch.
 *
 * `aria-pressed` rather than a radio group: these are two states of one view
 * control, not a value being submitted, and a screen reader then reads the
 * arrangement in force without the group needing a name per option.
 * @param glyph - the arrangement, drawn.
 * @param label - accessible name, also the tooltip.
 * @param on - whether this arrangement is the one in force.
 * @param onPick - switch to it.
 */
export function LayoutButton({ glyph, label, on, onPick }: {
  glyph: ReactNode
  label: string
  on: boolean
  onPick: () => void
}): ReactNode {
  return (
    <button
      type="button"
      className={on ? `${css.layoutButton} ${css.layoutButtonOn}` : css.layoutButton}
      aria-pressed={on}
      aria-label={label}
      title={label}
      onClick={onPick}
    >{glyph}</button>
  )
}

/**
 * The commit log as its own pane, in whichever arrangement the reader picked.
 *
 * Beside the file tree it is a peer pane the way GitHub Desktop, the JetBrains
 * git log and GitKraken all draw it — list and selected commit's files side by
 * side, each with its own scrollbar. Across the top it is IDEA's git log
 * instead, which is the arrangement that stops a long subject being cut; see
 * `history-layout.ts` for what each costs. The switch that picks between them
 * is in the toolbar row above, not in this pane's head — the head is the first
 * thing to run out of room when the pane is dragged narrow, which is exactly
 * when a reader reaches for the switch. Either way there is nothing to
 * collapse and nothing to discover.
 *
 * Pages load by scrolling. A button at the end of a growing list is the worst
 * of both worlds — it retreats every time it is used, and it asks the reader to
 * confirm an intention that scrolling toward the end already stated. A sentinel
 * below the last row requests the next page as it comes into view, which is
 * what GitHub and GitLens do. The observer is rebuilt whenever the list grows,
 * so a page too short to fill the pane immediately triggers the next one.
 */
export function CommitList({ paneRef, style, layout, t, loading, commits, active, onSelect, hasMore, loadingMore, onLoadMore, query, onQueryChange, error, statsPath, refName, fetchAuthors, fetchRepoTree }: {
  /** The pane element, which the divider beside it measures from. Not named
   *  `ref`: React reserves that on a function component, so it would be stripped
   *  from props and never reach this element. */
  paneRef: Ref<HTMLDivElement>
  /** Dragged size, when the divider has been used: a width beside the diff, a
   *  height above it. */
  style: CSSProperties | undefined
  /** The arrangement in force, which decides the row's shape as well as the
   *  pane's. The control that CHANGES it is not in here — see the toolbar row
   *  above the panes. */
  layout: HistoryLayout
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
    <div ref={paneRef} className={css.commitsPane} style={style} data-layout={layout} data-gs-part="commits">
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
              layout={layout}
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
