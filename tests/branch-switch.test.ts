/**
 * The rows behind the header's branch switcher.
 *
 * Kept out of WorkbenchControls.tsx so the rules can be asserted without
 * React: which row is the current branch, which rows git would refuse because
 * another worktree holds them, and how a remote-only branch is spelled so the
 * host creates a tracking branch instead of guessing one.
 */
import { describe, expect, it } from 'vitest'
import { switchPayload, switchRows } from '../src/client/branch-switch.ts'

const worktrees = [
  { path: 'C:/repo', head: '1111111', branch: 'main' },
  { path: 'C:/repo/.agents/worktrees/demo', head: '2222222', branch: 'wt/demo' },
]

describe('switchRows', () => {
  it('marks the current branch and keeps the given order', () => {
    const rows = switchRows(['feature/x', 'main', 'hotfix'], [], worktrees, 'main', '')
    expect(rows.map(row => row.name)).toEqual(['feature/x', 'main', 'hotfix'])
    expect(rows.map(row => row.current)).toEqual([false, true, false])
  })

  it('disables a branch checked out in another worktree and says where', () => {
    // git refuses `switch` onto a branch another worktree has; the row says
    // so before the click rather than after, with the path on hand.
    const rows = switchRows(['main', 'wt/demo'], [], worktrees, 'main', '')
    expect(rows[0]?.checkedOutAt).toBeNull()
    expect(rows[1]?.checkedOutAt).toBe('C:/repo/.agents/worktrees/demo')
  })

  it('does not report the current branch as held elsewhere', () => {
    // The main worktree itself is listed with its branch; that is where the
    // drawer is, not somewhere else.
    const rows = switchRows(['main'], [], worktrees, 'main', '')
    expect(rows[0]?.checkedOutAt).toBeNull()
  })

  it('appends remote branches as create-and-track rows', () => {
    const rows = switchRows(['main'], ['origin/feature/y', 'upstream/dev'], worktrees, 'main', '')
    expect(rows.slice(1)).toEqual([
      { name: 'origin/feature/y', branch: 'feature/y', track: 'origin/feature/y', current: false, checkedOutAt: null },
      { name: 'upstream/dev', branch: 'dev', track: 'upstream/dev', current: false, checkedOutAt: null },
    ])
  })

  it('a local row carries no track', () => {
    const rows = switchRows(['feature/x'], [], worktrees, 'main', '')
    expect(rows[0]).toEqual({ name: 'feature/x', branch: 'feature/x', track: null, current: false, checkedOutAt: null })
  })

  it('filters both groups by a case-insensitive substring', () => {
    const rows = switchRows(['Feature/x', 'main'], ['origin/feature/y'], worktrees, 'main', 'FEAT')
    expect(rows.map(row => row.name)).toEqual(['Feature/x', 'origin/feature/y'])
  })

  it('a detached HEAD marks nothing current', () => {
    const rows = switchRows(['main'], [], worktrees, '', '')
    expect(rows[0]?.current).toBe(false)
  })
})

describe('switchPayload', () => {
  it('spells a local pick with the branch alone', () => {
    // No `track: undefined`: the payload is spread into RPC args, and an
    // absent key is the only JSON-safe way to say "not a remote pick".
    expect(switchPayload({ name: 'dev', branch: 'dev', track: null, current: false, checkedOutAt: null }))
      .toEqual({ branch: 'dev' })
  })
  it('carries the remote ref for a remote pick', () => {
    expect(switchPayload({ name: 'origin/dev', branch: 'dev', track: 'origin/dev', current: false, checkedOutAt: null }))
      .toEqual({ branch: 'dev', track: 'origin/dev' })
  })
})
