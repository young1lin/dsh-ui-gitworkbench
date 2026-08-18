/**
 * What a roll-back click does with the host's answer.
 *
 * The click never acts on its own: it asks the host what rolling this file
 * back WOULD do, and this decides what the answer means. Four answers are
 * possible and three of them used to collapse into one — the reader who
 * clicked saw the same nothing whether the file was already clean, the host
 * threw, or the request never arrived. "Nothing visibly happened" is the one
 * outcome a destructive control must never produce ambiguously: it is
 * indistinguishable from a dead button, and the natural response to a dead
 * button is to click it again.
 *
 * So a failure REPORTS and a stale row REFRESHES, and those are different
 * things. Refreshing is the honest answer to "git says this file has no
 * changes": the row disappears, which is both the feedback and the fix, and a
 * banner reading "nothing happened" would leave the row that caused it sitting
 * right there. A failure has no such self-explaining fix, so it has to be said.
 *
 * Pure so vitest can load it — the panel it serves pulls React and a CSS
 * module. The panel imports {@link DiscardPreview} from here for the same
 * reason: a decision about the shape cannot be tested where the shape lives.
 *
 * @module @young1lin/dsh-ui-gitworkbench/client/discard-flow
 */

/** What the host says rolling one file back would do. */
export interface DiscardPreview {
  /** Absent when git reports nothing to roll back for that path. */
  readonly effect?: 'restore' | 'delete' | 'recover' | 'unrename'
  readonly irreversible?: boolean
  readonly previousPath?: string
  readonly error?: string
}

/** The host's reply to `discardPlan`, failure included. */
export type DiscardAnswer =
  /** The call returned; the plan may still be empty. */
  | { readonly kind: 'plan'; readonly plan: DiscardPreview }
  /** The call did not return a plan — it errored, threw, or was refused. */
  | { readonly kind: 'failed'; readonly error: string }

/** What the drawer does next. */
export type DiscardNext =
  /** Open the confirmation naming this plan's consequence. */
  | { readonly kind: 'confirm'; readonly plan: DiscardPreview }
  /** Carry it out with no dialog — nothing is lost. */
  | { readonly kind: 'run'; readonly effect: string }
  /** The row was stale; reload the tree and let it go away. */
  | { readonly kind: 'refresh' }
  /** Say why nothing was done. */
  | { readonly kind: 'report'; readonly error: string }

/** Fallback text for a failure that arrived with nothing to say. */
export const UNKNOWN_DISCARD_ERROR = 'discardPlan failed'

/**
 * Decide what a roll-back click does with the answer it got.
 *
 * @param answer - the host's reply, or the failure that replaced it.
 * @returns the single next step; never null, because every answer including a
 *          broken one has to lead somewhere the reader can see.
 */
export function nextAfterPlan(answer: DiscardAnswer): DiscardNext {
  if (answer.kind === 'failed') {
    const error = answer.error.trim()
    return { kind: 'report', error: error.length > 0 ? error : UNKNOWN_DISCARD_ERROR }
  }
  const plan = answer.plan
  // The host reports a refusal in-band too, so a plan carrying an error is a
  // failure that happened to arrive over a successful call.
  if (typeof plan.error === 'string' && plan.error.trim().length > 0) {
    return { kind: 'report', error: plan.error.trim() }
  }
  if (plan.effect === undefined) return { kind: 'refresh' }
  // `recover` — a deleted file coming back — loses nothing, and a confirmation
  // in front of a pure gain is how people learn to dismiss confirmations
  // without reading them. Only an EXPLICIT `false` skips the dialog: a host
  // newer than this bundle can name an effect this client has no copy for, and
  // a missing flag read as "reversible" would act on it silently.
  if (plan.irreversible === false) return { kind: 'run', effect: plan.effect }
  return { kind: 'confirm', plan }
}
