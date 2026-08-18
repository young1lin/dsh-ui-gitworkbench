/**
 * The history filter, compiled into `git log` arguments.
 *
 * This is the pushdown half of the IDEA-style filter: matching runs inside
 * `git log` over ALL history, not client-side over the loaded pages — the
 * loaded-pages blind spot is the reason this module exists. Everything here is
 * pure so the argument matrix is testable without spawning git.
 *
 * DIALECT RULE: whenever any pattern is emitted, the flags are `-i -E` and
 * every literal input is escaped for POSIX ERE. Mixing `--fixed-strings` with
 * `-E` is not possible (one overrides the other for EVERY pattern on the
 * command line), so a single dialect keeps users literal no matter what the
 * text criterion's regex toggle says; regex text alone is passed raw.
 *
 * Dates pass through verbatim: approxidate ("2 weeks ago") is git's language,
 * and reimplementing even a slice of it client-side is how the dual-semantics
 * bug farm starts. An invalid date is git's error to raise, surfaced by the
 * host's usual exit-code + stderr format.
 *
 * @module @young1lin/dsh-ui-gitworkbench/log-filter
 */

/** One history query, as the client sends it. JSON-safe: strings and booleans only. */
export interface LogFilter {
  /** Author names, matched case-insensitively as literal substrings. Multiple = OR (git semantics, IDEA parity). */
  readonly users: readonly string[]
  /** Commit-message pattern. Empty string means no text criterion. */
  readonly text: string
  /** Interpret {@link text} as an ERE instead of a literal substring. */
  readonly textRegex: boolean
  /** Pathspecs, multiple = union (a commit touching ANY of them matches). */
  readonly paths: readonly string[]
  /** Inclusive lower bound, approxidate text. Empty means unbounded. */
  readonly after: string
  /** Exclusive upper bound, approxidate text. Empty means unbounded. */
  readonly before: string
}

/** The filter that filters nothing — also the default when a client sends none. */
export function emptyLogFilter(): LogFilter {
  return { users: [], text: '', textRegex: false, paths: [], after: '', before: '' }
}

/** POSIX ERE metacharacters, escaped so each matches itself. */
function escapeEre(literal: string): string {
  return literal.replace(/[\\.[\]*+?(){}|^$-]/g, '\\$&')
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Expand a bare calendar day into an explicit moment. Git's approxidate
 * parses `--since=2026-08-18` against an implementation-defined timezone,
 * which on Windows silently excludes that very day's commits; `T00:00:00`
 * pins it to local midnight (a picker day means the whole day, so `before`
 * gets the day's last second instead).
 */
function expandDay(bound: string, endOfDay: boolean): string {
  if (!DAY_RE.test(bound)) return bound
  return endOfDay ? `${bound}T23:59:59` : `${bound}T00:00:00`
}

/**
 * Compile a filter into the argument segment inserted after the log command's
 * own flags. Pathspecs come last behind a bare `--`, so the CALLER must place
 * this segment at the end of the argument list.
 * @param filter - the query; blank entries are dropped, not turned into empty
 *   patterns (an empty `--author=` would match nothing).
 */
export function logFilterArgs(filter: LogFilter): string[] {
  const users = filter.users.map(user => user.trim()).filter(user => user.length > 0)
  const paths = filter.paths.map(path => path.trim()).filter(path => path.length > 0)
  const text = filter.text.trim()
  const after = filter.after.trim()
  const before = filter.before.trim()

  const args: string[] = []
  if (users.length > 0 || text.length > 0) {
    args.push('-i', '-E')
    for (const user of users) args.push(`--author=${escapeEre(user)}`)
    if (text.length > 0) args.push(`--grep=${filter.textRegex ? text : escapeEre(text)}`)
  }
  if (after.length > 0) args.push(`--since=${expandDay(after, false)}`)
  if (before.length > 0) args.push(`--until=${expandDay(before, true)}`)
  if (paths.length > 0) args.push('--', ...paths)
  return args
}
