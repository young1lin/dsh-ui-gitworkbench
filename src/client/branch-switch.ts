/**
 * Rows for the header's branch switcher, derived without React so the rules
 * can be tested: `tests/branch-switch.test.ts`.
 *
 * Two facts the list must state before a click, because git states them
 * only after: which row the tree is already on, and which rows git will
 * refuse because another worktree holds that branch (`fatal: '<b>' is already
 * checked out at ...`). Remote-only branches ride along as a second group,
 * spelled with the `track` the host needs to create a local branch from them
 * rather than guess one.
 */
import type { WorktreeEntry } from './git-workbench-types'

export interface SwitchRow {
  /** What the row shows: the local name, or `remote/name` for a remote row. */
  readonly name: string
  /** The local branch the tree ends up on. */
  readonly branch: string
  /** The remote ref a new local branch should track; null for a local row. */
  readonly track: string | null
  readonly current: boolean
  /** The worktree that already has this branch checked out, or null. */
  readonly checkedOutAt: string | null
}

/**
 * @param locals - local branch names, in the order to show.
 * @param remotes - remote-tracking names with no local counterpart, appended
 *                  after the locals.
 * @param worktrees - every worktree and its branch.
 * @param current - the viewed tree's branch; empty when HEAD is detached.
 * @param query - a filter, matched case-insensitively against the row name.
 */
export function switchRows(
  locals: readonly string[],
  remotes: readonly string[],
  worktrees: readonly WorktreeEntry[],
  current: string,
  query: string,
): SwitchRow[] {
  const needle = query.trim().toLowerCase()
  const shown = (name: string): boolean => needle.length === 0 || name.toLowerCase().includes(needle)
  const rows: SwitchRow[] = []
  for (const name of locals) {
    if (!shown(name)) continue
    const isCurrent = name === current
    // The current branch is held by the tree being viewed — that is here, not
    // elsewhere — so it is never reported as taken.
    const holder = isCurrent ? undefined : worktrees.find(entry => entry.branch === name)
    rows.push({ name, branch: name, track: null, current: isCurrent, checkedOutAt: holder?.path ?? null })
  }
  for (const name of remotes) {
    if (!shown(name)) continue
    rows.push({ name, branch: name.slice(name.indexOf('/') + 1), track: name, current: false, checkedOutAt: null })
  }
  return rows
}

/**
 * The `switchBranch` op's payload for a picked row. A local pick carries the
 * branch alone — no `track: undefined`, since the payload is spread into RPC
 * args and an absent key is the JSON-safe spelling of "not a remote pick".
 */
export function switchPayload(row: SwitchRow): { branch: string; track?: string } {
  return row.track === null ? { branch: row.branch } : { branch: row.branch, track: row.track }
}
