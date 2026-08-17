/**
 * The drawer header's two worktree facts: which path it is showing, and what
 * branch is checked out there.
 *
 * Both used to be derived inline in GitWorkbenchPanel.tsx, where they could not be
 * tested — importing the panel pulls CSS modules and React. The branch lookup
 * in particular is what removes the `(no branch)` flash on a source switch, so
 * it is worth an assertion that survives the next edit to the header.
 */
import { describe, expect, it } from 'vitest'
import { badgeRepeatsBranch, bindingChanged, branchOfWorktree, probesClosedBinding, samePath, showsPending, splitPath, viewedPath } from '../src/client/worktree-view.ts'

describe('samePath', () => {
  it('reads a windows path and a posix one as the same place', () => {
    // `git worktree list` reports forward slashes; the session cwd arrives with
    // backslashes. Comparing them raw made every switch look like a new path.
    expect(samePath('C:\\repo\\wt', 'C:/repo/wt')).toBe(true)
  })

  it('ignores a trailing separator', () => {
    expect(samePath('C:/repo/wt/', 'C:/repo/wt')).toBe(true)
  })

  it('separates different worktrees of one repository', () => {
    expect(samePath('C:/repo/.agents/worktrees/a', 'C:/repo/.agents/worktrees/b')).toBe(false)
  })

  it('is false when either side is missing, never true by vacancy', () => {
    expect(samePath(undefined, 'C:/repo')).toBe(false)
    expect(samePath('C:/repo', undefined)).toBe(false)
    expect(samePath(undefined, undefined)).toBe(false)
  })
})

describe('splitPath', () => {
  it('keeps the last segment whole and leaves the rest shrinkable', () => {
    // The header ellipsises `head` and never `tail`: the last segment is the
    // part that tells two worktrees apart, so it is the part that must survive
    // a narrow drawer.
    expect(splitPath('C:\\repo\\fixture-01'))
      .toEqual({ head: 'C:\\repo\\', tail: 'fixture-01' })
  })

  it('keeps the separator style the path arrived in', () => {
    expect(splitPath('/home/u/repo')).toEqual({ head: '/home/u/', tail: 'repo' })
  })

  it('names the directory, not nothing, when the path ends in a separator', () => {
    expect(splitPath('C:/repo/wt/')).toEqual({ head: 'C:/repo/', tail: 'wt' })
  })

  it('puts a bare name entirely in the tail', () => {
    expect(splitPath('repo')).toEqual({ head: '', tail: 'repo' })
    expect(splitPath('')).toEqual({ head: '', tail: '' })
  })
})

describe('viewedPath', () => {
  const SESSION = 'C:/repo/.agents/worktrees/fixture-03'
  const PINNED = 'C:/repo'

  it('reads the pinned worktree while the drawer is open', () => {
    expect(viewedPath(true, PINNED, SESSION)).toBe(PINNED)
  })

  it('falls back to the session when nothing is pinned', () => {
    expect(viewedPath(true, null, SESSION)).toBe(SESSION)
  })

  it('ignores the pin once the drawer is closed', () => {
    // The pin is a thing you do WHILE LOOKING. With the drawer shut there is no
    // way to see it, change it, or know it is there — and the header card went
    // on describing the pinned repository while still wearing the session's
    // worktree badge, which reads as "fixture-03 is on main". It is not.
    expect(viewedPath(false, PINNED, SESSION)).toBe(SESSION)
  })

  it('carries an unbound session through unchanged', () => {
    expect(viewedPath(true, null, undefined)).toBeUndefined()
    expect(viewedPath(false, PINNED, undefined)).toBeUndefined()
  })
})

describe('probesClosedBinding', () => {
  it('is true only with the drawer shut and the agent running', () => {
    // The one window where the chip can go stale unwatched: `worktree_enter` is
    // an agent tool, so a binding only ever moves inside a turn, and with the
    // drawer shut the 3-15s poll that would have caught it is not running.
    expect(probesClosedBinding(false, true)).toBe(true)
  })

  it('is false while the drawer is open, where the real poll already runs', () => {
    // Two timers asking the same question is one timer too many, and the open
    // drawer's poll fetches the whole status rather than just the binding.
    expect(probesClosedBinding(true, true)).toBe(false)
  })

  it('is false on an idle session, which is the cost rule', () => {
    // This panel is mounted in every session header. A timer per header for a
    // file that nothing is writing is the spawn nobody asked for.
    expect(probesClosedBinding(false, false)).toBe(false)
  })

  it('is false before the store has said whether the agent is running', () => {
    expect(probesClosedBinding(false, undefined)).toBe(false)
  })
})

describe('bindingChanged', () => {
  const SHOWN = { worktreePath: 'C:/repo/.agents/worktrees/fixture-01', name: 'fixture-01' }

  it('is false when the probe agrees with what the chip already shows', () => {
    // The quiet case, and the one that runs every tick: it must cost nothing
    // downstream, so a matching probe never triggers the full status refetch.
    expect(bindingChanged({ worktreePath: SHOWN.worktreePath, name: SHOWN.name }, SHOWN)).toBe(false)
  })

  it('is false when the two spell the same path with different separators', () => {
    // Otherwise every tick would read the binding as moved and fire a
    // `worktree list` + `branch` pair behind a chip that is already correct.
    expect(bindingChanged({ worktreePath: 'C:\\repo\\.agents\\worktrees\\fixture-01', name: 'fixture-01' }, SHOWN)).toBe(false)
  })

  it('is true when the agent has just entered a worktree', () => {
    expect(bindingChanged({ worktreePath: SHOWN.worktreePath, name: SHOWN.name }, null)).toBe(true)
  })

  it('is true when the agent has just left one', () => {
    expect(bindingChanged({ worktreePath: null, name: null }, SHOWN)).toBe(true)
  })

  it('is false when both sides are unbound, which is most sessions', () => {
    expect(bindingChanged({ worktreePath: null, name: null }, null)).toBe(false)
  })

  it('is true when the session moved to a different worktree', () => {
    expect(bindingChanged({ worktreePath: 'C:/repo/.agents/worktrees/fixture-02', name: 'fixture-02' }, SHOWN)).toBe(true)
  })

  it('is true when the name moved under an unchanged path', () => {
    // Path and name are separate fields of the binding record, and the name is
    // what the badge prints. A re-enter that reuses the directory under another
    // name must still repaint.
    expect(bindingChanged({ worktreePath: SHOWN.worktreePath, name: 'renamed' }, SHOWN)).toBe(true)
  })
})

describe('showsPending', () => {
  it('is true only when a load has nothing to show behind it', () => {
    expect(showsPending(true, 0)).toBe(true)
  })

  it('is false while a refresh lands over data already on screen', () => {
    // Every tick stages through git and then refetches, so `loading` goes true
    // on data that is still perfectly good. Blanking on that flag alone swapped
    // the header totals for a `—` and back on every click — measured at 400ms,
    // which is exactly long enough to read as a flicker.
    expect(showsPending(true, 28)).toBe(false)
  })

  it('is false whenever nothing is loading', () => {
    expect(showsPending(false, 0)).toBe(false)
    expect(showsPending(false, 28)).toBe(false)
  })
})

describe('badgeRepeatsBranch', () => {
  it('is true for a worktree the plugin made, whose branch it derived from the name', () => {
    // The name IS the branch now — `feature+20260810` enters as a branch of
    // the same spelling, no prefix. Bindings from the wt/<name> era derive
    // just as directly. Either way the card would print the same word twice
    // (branch chip and badge), so the badge steps aside.
    expect(badgeRepeatsBranch('demo', 'demo')).toBe(true)
    expect(badgeRepeatsBranch('feature+20260810', 'feature+20260810')).toBe(true)
    expect(badgeRepeatsBranch('wt/demo', 'demo')).toBe(true) // legacy binding
  })

  it('is false when the two names are independent, so the badge still earns its place', () => {
    // A worktree made outside dsh has no such relation — the directory is
    // called whatever, and the branch in it is whatever.
    expect(badgeRepeatsBranch('feature/login', 'scratch')).toBe(false)
    expect(badgeRepeatsBranch('wt/a', 'b')).toBe(false)
  })

  it('is false for a prefix that only looks like one', () => {
    expect(badgeRepeatsBranch('wt/fixture-03-old', 'fixture-03')).toBe(false)
    expect(badgeRepeatsBranch('feature-20260810-old', 'feature-20260810')).toBe(false)
  })

  it('is false for a detached worktree, which has no branch to repeat', () => {
    expect(badgeRepeatsBranch('', 'fixture-03')).toBe(false)
  })
})

describe('branchOfWorktree', () => {
  const worktrees = [
    { path: 'C:/repo', branch: 'main' },
    { path: 'C:/repo/.agents/worktrees/demo', branch: 'wt/demo' },
    { path: 'C:/repo/.agents/worktrees/det', branch: '' },
  ]

  it('names the branch the panel is about to switch to', () => {
    // This is the whole point: the placeholder stats a switch installs can
    // carry the real branch instead of an empty string, so the header never
    // passes through `(no branch)` on its way to the answer.
    expect(branchOfWorktree('C:\\repo\\.agents\\worktrees\\demo', worktrees)).toBe('wt/demo')
  })

  it('returns empty for a detached worktree, which genuinely has no branch', () => {
    expect(branchOfWorktree('C:/repo/.agents/worktrees/det', worktrees)).toBe('')
  })

  it('returns empty rather than guessing when the path is unknown or absent', () => {
    expect(branchOfWorktree('C:/elsewhere', worktrees)).toBe('')
    expect(branchOfWorktree(undefined, worktrees)).toBe('')
    expect(branchOfWorktree('C:/repo', [])).toBe('')
  })
})
