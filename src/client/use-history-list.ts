/**
 * The history tab's list, as one unit: the filter box's debounce, the first
 * page that reloads on every view change, and the paging the scroll sentinel
 * drives. Extracted from GitWorkbenchPanel so the state that only the list
 * reads stops living beside state the whole drawer reads (AGENTS.md: pure
 * rules leave the panel; this hook is the panel's own rule for its own rows).
 *
 * The load-more race this hook closes: a page request takes the ref, the
 * worktree AND the live filter as its identity. The first-page effect aborts
 * its own controller, but loadMoreCommits owns a separate one - it must
 * outlive the effect - so a filter change mid-flight left the old query's
 * page free to land and append itself to the NEW list, splicing rows from
 * one query into another with a hasMore nobody computed. The epoch counter
 * is bumped by every first-page reload; a page that comes back to a moved
 * epoch belongs to a list nobody is looking at, and is dropped.
 *
 * @module @young1lin/dsh-ui-gitworkbench/client/use-history-list
 */

import { useEffect, useMemo, useRef, useState } from 'react'

import type { LogFilter } from '../log-filter.ts'
import { emptyQueryFilter, parseLogQuery, serializeLogQuery } from './log-filter-query.ts'
import type { GitCommit } from './git-workbench-types.ts'

/** How many further commits one page request loads. */
export const HISTORY_PAGE = 30

/** One page of the log, exactly as the host's `commits` RPC reports it. */
export interface CommitsPage {
  readonly commits: GitCommit[]
  readonly hasMore: boolean
  readonly error?: string
}

export type FetchCommits = (worktreePath: string | undefined, ref: string, skip: number, limit: number, filter: LogFilter, signal: AbortSignal) => Promise<CommitsPage | null>

export function useHistoryList({ open, statsPath, refName, gen, fetchCommits, dropSelection }: {
  /** Gated on the drawer: this hook is mounted in every session header, and
   *  a log nobody is looking at is a git spawn nobody asked for. */
  readonly open: boolean
  /** The worktree whose object store resolves the ref. */
  readonly statsPath: string | undefined
  /** The ref the list walks; empty means the worktree's own HEAD. */
  readonly refName: string
  /** Bumped by manual refresh: a new generation is a new list. */
  readonly gen: number
  readonly fetchCommits: FetchCommits
  /** Called when the list resets, so a selection from the old list cannot
   *  survive into the new one - a hash from another ref's log has no place
   *  in this one. Must be stable (setState wrapped in useCallback). */
  readonly dropSelection: () => void
}) {
  /** Every history page loaded for the current worktree + ref. */
  const [historyCommits, setHistoryCommits] = useState<readonly GitCommit[]>([])
  const [historyHasMore, setHistoryHasMore] = useState(false)
  /** First page of the history list in flight - the pane says "loading", not
   *  "no commit history", which is a claim about the repository. */
  const [historyLoading, setHistoryLoading] = useState(false)
  /** Why the history list is empty when it is git's word, not the log's: a
   *  bad filter pattern or date, with the stderr tail to say so. */
  const [historyError, setHistoryError] = useState<string | null>(null)
  /** The history filter box's raw text. Parsed into the LogFilter the host
   *  compiles into git log arguments - the funnel popup writes here too: one
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
  /** In-flight marker for paging, read synchronously - see below. */
  const loadingRef = useRef(false)
  /** Which list the loaded pages belong to. Bumped by every first-page
   *  reload; a page resolved against a moved epoch is not appended. */
  const epochRef = useRef(0)

  // First page, reloaded whenever the worktree or the ref changes.
  useEffect(() => {
    if (!open) return
    const ctrl = new AbortController()
    let alive = true
    epochRef.current += 1
    setHistoryCommits([])
    setHistoryHasMore(false)
    dropSelection()
    setHistoryLoading(true)
    setHistoryError(null)
    fetchCommits(statsPath, refName, 0, HISTORY_PAGE, liveFilter, ctrl.signal)
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
  }, [open, statsPath, refName, fetchCommits, gen, liveFilter, dropSelection])

  /** Append the next page of the log.
   *
   *  The guard is a ref, not the `loadingMore` state: the scroll sentinel can
   *  fire again before React has re-rendered with the state set, and two calls
   *  at the same offset would append the same page twice. */
  const loadMoreCommits = (): void => {
    if (loadingRef.current || !historyHasMore) return
    loadingRef.current = true
    setLoadingMore(true)
    const epoch = epochRef.current
    const ctrl = new AbortController()
    fetchCommits(statsPath, refName, historyCommits.length, HISTORY_PAGE, liveFilter, ctrl.signal)
      .then(page => {
        // An epoch that moved means the list this page was fetched for is
        // gone: a filter/ref/worktree change already reset it and loaded its
        // own first page. Appending here would splice the old query's rows
        // into the new list, with a hasMore nobody computed for it.
        if (page === null || epoch !== epochRef.current) return
        setHistoryCommits(prev => [...prev, ...page.commits])
        setHistoryHasMore(page.hasMore)
      })
      .catch(() => {})
      .finally(() => { loadingRef.current = false; setLoadingMore(false) })
  }

  return {
    historyCommits, historyHasMore, historyLoading, historyError,
    historyQuery, setHistoryQuery, liveFilter, loadingMore, loadMoreCommits,
  }
}
