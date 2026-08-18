/**
 * Exact-date rendering for the history hover card.
 *
 * The rows stay compact — abbreviated hash, name, "3 weeks ago" — and the
 * details live in the hover card. An exact date cannot be derived from git's
 * relative "%cr" prose, so the host log format carries `%cI` alongside
 * (`src/git-log.ts`); this module renders it in the viewer's own clock.
 *
 * (The person-name MATCHING that once lived here is retired: history
 * filtering is compiled into git log arguments host-side — `log-filter.ts`,
 * `log-filter-query.ts` — so it runs over all history, not the loaded pages.)
 *
 * @module @young1lin/dsh-ui-gitworkbench/commit-filter
 */

/** Options for {@link formatCommitDate}; both default to the viewer's own. */
export interface CommitDateOptions {
  /** BCP 47 locale for the formatter; undefined means the runtime default. */
  readonly locale?: string
  /** IANA timezone; undefined means the viewer's local timezone. */
  readonly timeZone?: string
}

/**
 * Render a commit's ISO 8601 date in full — "Aug 4, 2026, 5:30 PM", in the
 * viewer's locale and timezone (or the overrides, which exist for tests).
 *
 * git's relative prose ("3 weeks ago") is right for the row and useless for
 * the hover card, where the question is exactly WHEN. `%cI` is a strict ISO
 * timestamp, so `new Date` parses it and the formatter renders local time —
 * the same moment the viewer's own clock shows, which is the only timezone a
 * hover card should speak. Unparsable input yields an empty string rather
 * than a thrown RangeError: the card simply omits the line.
 * @param iso - `%cI` string from the host log, possibly empty or absent.
 * @param options - locale/timezone overrides; both optional.
 */
export function formatCommitDate(iso: string, options: CommitDateOptions = {}): string {
  if (iso.length === 0) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(options.locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...(options.timeZone !== undefined ? { timeZone: options.timeZone } : {}),
  }).format(date)
}
