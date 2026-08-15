import { describe, expect, it } from 'vitest'
import {
  fileCheckState, nextAction, nextBatch, pathsFor, rollUp, settledTicks, tickedFlags, withPendingTicks,
  type CheckState, type TickAction,
} from '../src/client/stage-tree.ts'

/** A file as the status parser reports it. */
function file(path: string, staged?: boolean, unstaged?: boolean): { path: string; staged?: boolean; unstaged?: boolean } {
  return { path, staged, unstaged }
}

describe('fileCheckState', () => {
  it('ticks a file whose whole change is in the index', () => {
    expect(fileCheckState({ staged: true })).toBe('on')
    expect(fileCheckState({ staged: true, unstaged: false })).toBe('on')
  })

  it('leaves a file that has never been added unticked', () => {
    expect(fileCheckState({ unstaged: true })).toBe('off')
    expect(fileCheckState({})).toBe('off')
  })

  it('calls a staged-then-edited file indeterminate, not ticked', () => {
    // Porcelain `MM`. Only part of this file would reach the commit, so a full
    // tick would misstate what Commit is about to do.
    expect(fileCheckState({ staged: true, unstaged: true })).toBe('partial')
  })
})

describe('rollUp', () => {
  it('is off for a directory with nothing in it', () => {
    expect(rollUp([])).toBe('off')
  })

  it('ticks a directory only when every descendant is ticked', () => {
    expect(rollUp(['on', 'on', 'on'])).toBe('on')
    expect(rollUp(['on', 'on', 'off'])).toBe('partial')
    expect(rollUp(['off', 'off'])).toBe('off')
  })

  it('does not round a lopsided mix away', () => {
    // One ticked file among two hundred is still "some of this directory";
    // rounding to off would hide it from the commit set on screen.
    const many: CheckState[] = Array.from({ length: 200 }, () => 'off')
    many[137] = 'on'
    expect(rollUp(many)).toBe('partial')
  })

  it('propagates a single indeterminate descendant all the way up', () => {
    expect(rollUp(['on', 'partial', 'on'])).toBe('partial')
    expect(rollUp(['partial'])).toBe('partial')
  })
})

describe('nextAction', () => {
  it('unticks what is fully ticked', () => {
    expect(nextAction('on')).toBe('unstage')
  })

  it('stages from both off and indeterminate', () => {
    // A half-ticked box invites finishing it. Reading the click as "discard
    // what is already staged" would make a checkbox destructive.
    expect(nextAction('off')).toBe('stage')
    expect(nextAction('partial')).toBe('stage')
  })
})

describe('pathsFor', () => {
  const files = [
    file('a.ts', true, false),   // fully staged
    file('b.ts', false, true),   // never added
    file('c.ts', true, true),    // staged then edited
  ]

  it('sends git only the files an action would change', () => {
    expect(pathsFor(files, 'stage')).toEqual(['b.ts', 'c.ts'])
    expect(pathsFor(files, 'unstage')).toEqual(['a.ts', 'c.ts'])
  })

  it('returns nothing when the action has nothing to do', () => {
    expect(pathsFor([file('a.ts', true, false)], 'stage')).toEqual([])
    expect(pathsFor([file('b.ts', false, true)], 'unstage')).toEqual([])
    expect(pathsFor([], 'stage')).toEqual([])
  })

  it('includes a half-staged file in both directions', () => {
    // It has content on both sides, so either action has real work to do.
    expect(pathsFor([file('c.ts', true, true)], 'stage')).toEqual(['c.ts'])
    expect(pathsFor([file('c.ts', true, true)], 'unstage')).toEqual(['c.ts'])
  })
})

describe('tickedFlags', () => {
  it('shows a staged tick as fully in the commit set', () => {
    expect(tickedFlags('stage')).toEqual({ staged: true, unstaged: false })
  })

  it('shows an unstaged tick as back out of it', () => {
    expect(tickedFlags('unstage')).toEqual({ staged: false, unstaged: true })
  })
})

describe('withPendingTicks', () => {
  const files = [
    { ...file('a.ts', false, true), status: 'modified' as const, addedLines: 3 },
    file('b.ts', true, false),
  ]

  it('hands back the very same array when nothing is pending', () => {
    // The tree re-renders on this value and a fresh array every poll would
    // throw its memoisation away, so identity is the contract.
    expect(withPendingTicks(files, new Map<string, TickAction>())).toBe(files)
  })

  it('overlays the tick the click asked for, keeping the rest of the file', () => {
    const pending = new Map<string, TickAction>([['a.ts', 'stage']])
    const shown = withPendingTicks(files, pending)
    expect(shown[0]).toEqual({ path: 'a.ts', status: 'modified', addedLines: 3, staged: true, unstaged: false })
    expect(shown[1]).toBe(files[1])
  })

  it('ignores pending paths the payload no longer lists', () => {
    // The payload is the authority on what exists; a tick for a path it does
    // not carry is settled, not overlaid onto nothing.
    const pending = new Map<string, TickAction>([['gone.ts', 'stage']])
    expect(withPendingTicks(files, pending)).toBe(files)
  })
})

describe('settledTicks', () => {
  it('settles a stage the payload confirms in full', () => {
    const pending = new Map<string, TickAction>([['a.ts', 'stage']])
    expect(settledTicks([file('a.ts', true, false)], pending).get('a.ts')).toBe('stage')
  })

  it('settles a stage that landed and was then edited again', () => {
    // The add landed — a newer edit on top does not undo it. Demanding
    // full-flag agreement would freeze the overlay over a file the agent is
    // still editing, hiding the very edit the payload came to report.
    const pending = new Map<string, TickAction>([['a.ts', 'stage']])
    expect(settledTicks([file('a.ts', true, true)], pending).get('a.ts')).toBe('stage')
  })

  it('keeps a stage the payload has not reflected yet', () => {
    const pending = new Map<string, TickAction>([['a.ts', 'stage']])
    expect(settledTicks([file('a.ts', false, true)], pending).size).toBe(0)
  })

  it('settles an unstage once the index no longer holds the file', () => {
    const pending = new Map<string, TickAction>([['a.ts', 'unstage']])
    expect(settledTicks([file('a.ts', false, true)], pending).get('a.ts')).toBe('unstage')
  })

  it('keeps an unstage while the index still holds the file', () => {
    const pending = new Map<string, TickAction>([['a.ts', 'unstage']])
    expect(settledTicks([file('a.ts', true, true)], pending).size).toBe(0)
  })

  it('settles a path the payload no longer lists at all', () => {
    // Committed or reverted elsewhere — either way the tick's work is done,
    // and an overlay for a path that is gone would stick forever.
    const pending = new Map<string, TickAction>([['a.ts', 'stage'], ['b.ts', 'unstage']])
    expect(settledTicks([file('c.ts', false, true)], pending).size).toBe(2)
  })
})

describe('nextBatch', () => {
  it('has nothing to say about an empty queue', () => {
    expect(nextBatch([])).toBe(null)
  })

  it('takes every entry that shares the first action, past an opposite one', () => {
    // Batch by action, not by contiguity: a tick that arrived between two of
    // the same kind must not split them into two git calls.
    const queue = [
      { path: 'a.ts', action: 'stage' as const },
      { path: 'b.ts', action: 'unstage' as const },
      { path: 'c.ts', action: 'stage' as const },
    ]
    expect(nextBatch(queue)).toEqual({ action: 'stage', paths: ['a.ts', 'c.ts'] })
  })

  it('never mixes the two actions into one batch', () => {
    const queue = [
      { path: 'a.ts', action: 'unstage' as const },
      { path: 'b.ts', action: 'stage' as const },
    ]
    expect(nextBatch(queue)).toEqual({ action: 'unstage', paths: ['a.ts'] })
  })
})
