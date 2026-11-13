/**
 * The runtime deadline that ends a wedged git run at a stated bound.
 * Driven on a manual clock: the rules are about WHICH event fires and
 * what is left running afterwards, not about real seconds passing.
 */
import { describe, expect, it } from 'vitest'

import { runtimeDeadline, type TimerIo } from '../src/git-deadline.ts'

/** A clock the test advances by hand; cancelled timers never fire. */
class ManualClock implements TimerIo {
  private now = 0
  private readonly timers: { at: number; fire: () => void; cancelled: boolean }[] = []
  readonly scheduled: number[] = []

  setTimer: (ms: number, fire: () => void) => () => void = (ms, fire) => {
    this.scheduled.push(ms)
    const timer = { at: this.now + ms, fire, cancelled: false }
    this.timers.push(timer)
    return () => { timer.cancelled = true }
  }

  advance(ms: number): void {
    this.now += ms
    for (const timer of [...this.timers]) {
      if (!timer.cancelled && timer.at <= this.now) {
        timer.cancelled = true
        timer.fire()
      }
    }
  }
}

describe('runtimeDeadline', () => {
  it('aborts immediately when the caller already has', () => {
    const clock = new ManualClock()
    const caller = new AbortController()
    caller.abort(new Error('browser went away'))
    const deadline = runtimeDeadline(caller.signal, 60_000, clock)
    expect(deadline.signal.aborted).toBe(true)
    expect(deadline.expired()).toBe(false)
    expect(clock.scheduled).toEqual([])
    // Releasing an already-settled deadline must be a harmless no-op.
    expect(() => deadline.release()).not.toThrow()
  })

  it('aborts when the runtime elapses, and says it expired', () => {
    const clock = new ManualClock()
    const caller = new AbortController()
    const deadline = runtimeDeadline(caller.signal, 60_000, clock)
    expect(deadline.signal.aborted).toBe(false)
    clock.advance(60_000)
    expect(deadline.signal.aborted).toBe(true)
    expect(deadline.expired()).toBe(true)
    expect(deadline.signal.reason).toBeInstanceOf(Error)
  })

  it('lets the caller win the race without ever reading as expired', () => {
    const clock = new ManualClock()
    const caller = new AbortController()
    const reason = new Error('user cancelled')
    const deadline = runtimeDeadline(caller.signal, 60_000, clock)
    caller.abort(reason)
    clock.advance(120_000)
    expect(deadline.signal.aborted).toBe(true)
    expect(deadline.expired()).toBe(false)
    expect(deadline.signal.reason).toBe(reason)
  })

  it('schedules nothing for an unbounded run', () => {
    const clock = new ManualClock()
    const deadline = runtimeDeadline(new AbortController().signal, Infinity, clock)
    expect(clock.scheduled).toEqual([])
    clock.advance(10 ** 9)
    expect(deadline.signal.aborted).toBe(false)
  })

  it('release cancels the timer, so a finished run leaks nothing', () => {
    const clock = new ManualClock()
    const caller = new AbortController()
    const deadline = runtimeDeadline(caller.signal, 60_000, clock)
    deadline.release()
    // The clock firing past the release must not abort anything: the
    // spawn this signal belonged to is long done.
    clock.advance(60_000)
    expect(deadline.signal.aborted).toBe(false)
    // And a second release is a no-op, not a throw.
    expect(() => deadline.release()).not.toThrow()
  })

  it('stops listening to the caller once released', () => {
    const clock = new ManualClock()
    const caller = new AbortController()
    const deadline = runtimeDeadline(caller.signal, 60_000, clock)
    deadline.release()
    caller.abort()
    expect(deadline.signal.aborted).toBe(false)
  })
})
