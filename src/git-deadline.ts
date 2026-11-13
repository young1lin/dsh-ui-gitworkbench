/**
 * Compose a caller's abort signal with a runtime deadline.
 *
 * dsh's subprocess layer reacts to an abort signal but owns no deadline:
 * "callers own deadlines, teardown ladders, and cause classification"
 * (dsh-subprocess-local/spawn). A git read wedged on a lock or a stalled
 * disk therefore ran until the BROWSER disconnected - and a poll that
 * stays connected waits forever. This module is the caller-owned
 * deadline: one signal that fires when EITHER the caller aborts OR the
 * runtime elapses, with nothing left running once it settles (a leaked
 * timer or listener is exactly what tests/no-leaks.test.ts exists to keep
 * out of this plugin).
 *
 * Pure: timer scheduling is injected, so vitest drives every rule without
 * waiting a real second.
 *
 * @module @young1lin/dsh-ui-gitworkbench/git-deadline
 */

/** Schedule one later call; the returned function cancels it. */
export interface TimerIo {
  readonly setTimer: (ms: number, fire: () => void) => () => void
}

export interface RuntimeDeadline {
  /** The composed signal: aborted by the caller, or by the deadline. */
  readonly signal: AbortSignal
  /** Whether the DEADLINE fired - the caller's own abort is not an expiry. */
  readonly expired: () => boolean
  /** Cancel the timer and drop the caller listener. Idempotent. */
  readonly release: () => void
}

/**
 * @param caller - the abort the spawn already listens to (the RPC's).
 * @param ms - runtime budget; Infinity means no deadline (network ops wait
 *             on a remote, not on the disk).
 * @param io - timer scheduling, injected.
 */
export function runtimeDeadline(caller: AbortSignal, ms: number, io: TimerIo): RuntimeDeadline {
  const ctrl = new AbortController()
  let expired = false
  let cancel: (() => void) | null = null
  // Whichever event fires first settles the deadline: once the caller has
  // aborted, a later timer cannot be the CAUSE of anything, so it is
  // cancelled rather than left to flip `expired` on a run the user ended.
  const forward = (): void => {
    if (cancel !== null) {
      cancel()
      cancel = null
    }
    ctrl.abort(caller.reason)
  }
  if (caller.aborted) {
    forward()
    // Nothing was ever scheduled or listened for; release stays a no-op.
    return { signal: ctrl.signal, expired: () => false, release: () => {} }
  }
  caller.addEventListener('abort', forward, { once: true })
  if (Number.isFinite(ms) && ms > 0) {
    cancel = io.setTimer(ms, () => {
      expired = true
      cancel = null
      ctrl.abort(new Error(`git exceeded its ${ms}ms runtime deadline`))
    })
  }
  return {
    signal: ctrl.signal,
    expired: () => expired,
    release: () => {
      if (cancel !== null) {
        cancel()
        cancel = null
      }
      caller.removeEventListener('abort', forward)
    },
  }
}
