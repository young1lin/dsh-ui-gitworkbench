/**
 * A closed process's exit facts, collapsed onto the 0/non-0 vocabulary every
 * RPC in this service reads.
 *
 * Node's `close` event reports `exitCode === null` exactly when the process
 * died from a signal, and dsh-subprocess passes that through untouched — its
 * own docs say the caller reads the signal it owns to classify causes. Here
 * only one thing kills git: the caller's AbortSignal (a drawer closing, a
 * source switch). Mapping a signalled death to 0 made an ABORTED read look
 * successful, and half-collected stdout then flowed through the exit-0 gates
 * into caches that never invalidate (`commitDiffCache`, `commitStatsCache`),
 * pinning a truncated diff or a wrong hasMore until restart.
 *
 * Pure: no node, no git, no React. `tests/exit-code.test.ts` loads it
 * directly.
 *
 * @module @young1lin/dsh-ui-gitworkbench/exit-code
 */

/** What a finished git run reports about how it ended. */
export interface ExitFacts {
  /** Exit code; null when the process died from a signal. */
  readonly exitCode: number | null
  /** Terminating signal; null on normal exit. */
  readonly signal: string | null
}

/**
 * The exit code the rest of the service may gate on.
 *
 * @param outcome - the process's exit facts, as dsh-subprocess reports them.
 * @returns the real exit code, or 1 for a death by signal — an aborted read
 *          is a failed read, never a successful one with less output.
 */
export function exitCodeOf(outcome: ExitFacts): number {
  if (outcome.exitCode !== null) return outcome.exitCode
  // Both-null is impossible per Node's contract; if it ever happened, calling
  // the run failed is the safe side — nothing may cache on "we do not know".
  return 1
}
