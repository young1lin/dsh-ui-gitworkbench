import { describe, expect, it } from 'vitest'

import { exitCodeOf } from '../src/exit-code.js'

describe('exitCodeOf', () => {
  it('passes a real exit code through', () => {
    expect(exitCodeOf({ exitCode: 0, signal: null })).toBe(0)
    expect(exitCodeOf({ exitCode: 128, signal: null })).toBe(128)
  })

  it('reports a death by signal as failure, never as success', () => {
    // The bug this pins: a nullish-coalesced 0 turned an aborted git run
    // into exit 0, and the truncated stdout it left behind was cached as
    // complete output by every exit-0 gate downstream.
    expect(exitCodeOf({ exitCode: null, signal: 'SIGTERM' })).toBe(1)
    expect(exitCodeOf({ exitCode: null, signal: 'SIGKILL' })).toBe(1)
  })

  it('treats both-null as failure rather than success', () => {
    // Impossible per Node's close-event contract, but unknown must not
    // gate any cache write on the optimistic side.
    expect(exitCodeOf({ exitCode: null, signal: null })).toBe(1)
  })
})
