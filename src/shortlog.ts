/**
 * Author roster from `git shortlog -sne --all`, for the filter popup's
 * user picker.
 *
 * shortlog already did the aggregation over every ref; this module only
 * parses its fixed shape (`<count>  <name> <<email>>`), sorts by activity and
 * applies the cap — with the cap VISIBLE, because a filter popup that
 * silently lost the long tail of occasional committers would be quietly
 * wrong about who exists.
 *
 * @module @young1lin/dsh-ui-gitworkbench/shortlog
 */

/** One author as the picker shows them. JSON-safe; count is a plain number. */
export interface AuthorEntry {
  readonly name: string
  readonly email: string
  /** Commits across all refs — the picker's sort key. */
  readonly count: number
}

/**
 * Parse shortlog output into busiest-first authors, capped.
 * @param stdout - `git shortlog -sne --all` output.
 * @param limit - how many authors to keep; the busier half survives.
 * @returns the roster and whether it was cut short.
 */
export function parseShortlog(stdout: string, limit: number): { authors: AuthorEntry[]; truncated: boolean } {
  const authors: AuthorEntry[] = []
  for (const line of stdout.split('\n')) {
    const match = /^\s*(\d+)\s+(.+)$/.exec(line)
    if (match === null) continue
    const count = Number(match[1])
    const who = match[2]!
    // The email is the LAST <...> on the line; a name may legally contain
    // anything else.
    const emailMatch = /<([^>]*)>\s*$/.exec(who)
    if (emailMatch === null) continue
    const name = who.slice(0, emailMatch.index).trim()
    if (name.length === 0) continue
    authors.push({ name, email: emailMatch[1]!, count })
  }
  authors.sort((a, b) => b.count - a.count)
  const truncated = authors.length > limit
  return { authors: truncated ? authors.slice(0, limit) : authors, truncated }
}
