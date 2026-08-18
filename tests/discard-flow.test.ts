import { describe, expect, it } from 'vitest'

import { nextAfterPlan, UNKNOWN_DISCARD_ERROR } from '../src/client/discard-flow.ts'

describe('nextAfterPlan', () => {
  it('confirms an irreversible plan', () => {
    expect(nextAfterPlan({ kind: 'plan', plan: { effect: 'delete', irreversible: true } }))
      .toEqual({ kind: 'confirm', plan: { effect: 'delete', irreversible: true } })
  })

  it('runs a reversible plan without a dialog', () => {
    expect(nextAfterPlan({ kind: 'plan', plan: { effect: 'recover', irreversible: false } }))
      .toEqual({ kind: 'run', effect: 'recover' })
  })

  it('refreshes when git reports nothing to roll back', () => {
    expect(nextAfterPlan({ kind: 'plan', plan: {} })).toEqual({ kind: 'refresh' })
  })

  it('reports a failed call instead of looking like a dead button', () => {
    expect(nextAfterPlan({ kind: 'failed', error: 'fatal: not a git repository' }))
      .toEqual({ kind: 'report', error: 'fatal: not a git repository' })
  })

  it('never reports an empty message', () => {
    expect(nextAfterPlan({ kind: 'failed', error: '   ' }))
      .toEqual({ kind: 'report', error: UNKNOWN_DISCARD_ERROR })
  })

  it('reports a refusal that arrived over a successful call', () => {
    expect(nextAfterPlan({ kind: 'plan', plan: { error: 'unsafe path argument: "-rf"' } }))
      .toEqual({ kind: 'report', error: 'unsafe path argument: "-rf"' })
  })

  it('confirms an effect it does not recognise rather than acting on it', () => {
    // A host newer than this bundle can name an effect this client has no copy
    // for. Acting without a dialog is the one wrong answer: `irreversible`
    // absent must not read as "reversible".
    const plan = { effect: 'shred' as unknown as 'delete' }
    expect(nextAfterPlan({ kind: 'plan', plan })).toEqual({ kind: 'confirm', plan })
  })
})
