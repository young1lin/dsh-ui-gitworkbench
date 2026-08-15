/**
 * When the drawer is allowed to LOOK busy.
 *
 * `busy` carries two facts under one name. One is a guard — an operation is in
 * flight, so do not start another — and it has to take effect on the same tick
 * as the click. The other is an announcement: "the drawer is working". Only the
 * second one is worth pacing, and pacing it is what stops the flicker.
 *
 * Measured on the live drawer: ticking a file runs `git add` and refetches in
 * ~148ms, and for every one of those the whole sync row faded to `opacity:
 * .45` and back. Nobody can read a 148ms message; they can only see it blink.
 */
import { describe, expect, it } from 'vitest'
import { BUSY_DELAY_MS, BUSY_HOLD_MS, holdRemaining, quietlyDisabled } from '../src/client/op-feedback.ts'

describe('the delay before the drawer says it is working', () => {
  it('outlasts a tick, which is the operation that flickered', () => {
    // The measurement, kept as an assertion: a stage/unstage round trip took
    // 148ms and 149ms. A threshold under that repaints on every tick again.
    expect(BUSY_DELAY_MS).toBeGreaterThan(150)
  })

  it('holds long enough that appearing is not itself a blink', () => {
    // A threshold alone would only move the problem: an operation finishing
    // just past it would paint the dim for a few milliseconds. Once shown it
    // stays shown, so the dim always reads as a state.
    expect(BUSY_HOLD_MS).toBeGreaterThanOrEqual(BUSY_DELAY_MS)
  })
})

describe('quietlyDisabled', () => {
  it('is true while an operation is young: inert, but not yet dimmed', () => {
    // The button still refuses the click — the guard is immediate, only the
    // appearance waits.
    expect(quietlyDisabled(true, false, false)).toBe(true)
  })

  it('is false once the operation has lasted long enough to report', () => {
    expect(quietlyDisabled(true, true, false)).toBe(false)
  })

  it('is false when the control is disabled for a reason of its own', () => {
    // Pull with no upstream is disabled whether or not anything is running, and
    // that dim must survive: suppressing it would make an unavailable action
    // look available, and un-dimming it mid-operation would be a NEW flicker.
    expect(quietlyDisabled(true, false, true)).toBe(false)
    expect(quietlyDisabled(false, false, true)).toBe(false)
  })

  it('is false when nothing is running at all', () => {
    expect(quietlyDisabled(false, false, false)).toBe(false)
    expect(quietlyDisabled(false, true, false)).toBe(false)
  })
})

describe('holdRemaining', () => {
  it('keeps the dim up for the rest of its minimum', () => {
    expect(holdRemaining(1_000, 1_100, 300)).toBe(200)
  })

  it('is zero once the minimum has already passed', () => {
    expect(holdRemaining(1_000, 1_900, 300)).toBe(0)
  })

  it('never goes negative, so the timer is never scheduled into the past', () => {
    expect(holdRemaining(1_000, 5_000, 300)).toBe(0)
  })

  it('asks for the whole hold when the operation ends the instant it appeared', () => {
    expect(holdRemaining(1_000, 1_000, 300)).toBe(300)
  })
})
