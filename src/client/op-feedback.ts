/**
 * Pacing for the drawer's "an operation is running" appearance.
 *
 * `busy` in GitWorkbenchPanel names two different facts. The first is a guard: an
 * operation is in flight, so every control refuses to start another. That has
 * to be true on the same tick as the click, or a double click fires two git
 * calls. The second is an announcement — the drawer dims what it has disabled,
 * so the user can see why a click did nothing.
 *
 * Only the announcement is worth pacing. A tick IS a git call (`add` on the way
 * in, `restore --staged` on the way out) and it completes in about 150ms; that
 * was long enough to fade the whole sync row to `opacity: .45` and back on
 * every single click, which reads as a flicker rather than as feedback. Nobody
 * can act on a message that brief — its only effect was the blink.
 *
 * So the appearance waits, and once it arrives it stays. A threshold on its own
 * would just move the boundary: an operation finishing a little past it would
 * paint the dim for a few milliseconds, which is the same blink one notch
 * slower. The hold is what makes the dim always mean something.
 *
 * These live outside the panel so they can be tested — importing
 * GitWorkbenchPanel.tsx pulls a CSS module and React, which a node test environment
 * cannot load.
 */

/**
 * How long an operation must run before the drawer dims what it disabled.
 *
 * Above the ~150ms a stage/unstage round trip measured on the live drawer, so
 * the operation behind every tick never paints at all.
 */
export const BUSY_DELAY_MS = 220

/** Once the dim is up, the shortest time it stays — long enough to read. */
export const BUSY_HOLD_MS = 320

/**
 * Whether a control is disabled ONLY by an operation too young to report.
 *
 * Such a control keeps its full strength: it is already refusing clicks, and
 * saying so costs more than it gives when the answer arrives in 150ms.
 *
 * @param running - whether any git operation is in flight.
 * @param sustained - whether that operation has lasted long enough to report.
 * @param steady - whether this control is disabled for a reason of its own,
 *   like Pull with no upstream. Those keep their dim: it states an
 *   unavailable action, and dropping it mid-operation would be a new flicker.
 */
export function quietlyDisabled(running: boolean, sustained: boolean, steady: boolean): boolean {
  return running && !sustained && !steady
}

/**
 * Milliseconds the dim must stay up before it may be taken down.
 *
 * @param shownAt - when the dim appeared, in `Date.now()` terms.
 * @param now - the current time.
 * @param hold - the minimum visible duration.
 * @returns the remaining time, never negative — a negative delay would
 *   schedule a timer into the past and make the dim vanish on the same frame
 *   it was granted.
 */
export function holdRemaining(shownAt: number, now: number, hold: number = BUSY_HOLD_MS): number {
  return Math.max(0, hold - (now - shownAt))
}
