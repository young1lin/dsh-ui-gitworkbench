/**
 * How one blame entry reads in the gutter, and in the detail strip a click
 * opens.
 *
 * The gutter carries the PERSON. A commit hash is an identifier, not an
 * answer: reading down a file, the question is who wrote this, and a column of
 * hex says nothing until you look each one up. So the gutter is names, and the
 * commit — its hash, its full timestamp, what it said it was doing — appears
 * when the reader picks a line, which is the point at which they have decided
 * this line is the one they care about.
 *
 * Dates are rendered from the parts of a local `Date` rather than through
 * `toLocaleDateString`, because the drawer's language is its own setting and
 * not the browser's: the same drawer showing English must not switch to the
 * machine's date order. `YYYY-MM-DD` reads the same in both dictionaries.
 *
 * Pure: no React, no DOM, no git. `tests/blame-view.test.ts` loads it directly.
 *
 * @module @young1lin/dsh-ui-gitworkbench/client/blame-view
 */

import type { BlameLine } from './GitWorkbenchPanel.tsx'

/** How many hex digits of a sha the gutter shows. git's own default. */
export const SHORT_HASH = 7

/** The gutter's abbreviation of a commit; '' when there is no commit. */
export function shortHash(hash: string): string {
  return /^[0-9a-f]{7,}$/.test(hash) ? hash.slice(0, SHORT_HASH) : ''
}

/**
 * `YYYY-MM-DD` in the reader's own timezone, or '' when git gave no time.
 * @param time - unix seconds.
 */
export function blameDate(time: number): string {
  if (!Number.isFinite(time) || time <= 0) return ''
  const at = new Date(time * 1000)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
}

/**
 * The one line the gutter shows: who last changed it.
 *
 * @param entry - the line's provenance, or undefined for a line the blame did
 *                not cover (a truncated file, a line added since the fetch).
 * @param notCommitted - the drawer's own wording for a line with no commit
 *                       behind it; git's English is not passed through.
 * @returns the author's name, '' when there is nothing to say.
 */
export function blameLabel(entry: BlameLine | undefined, notCommitted: string): string {
  if (entry === undefined) return ''
  if (entry.uncommitted) return notCommitted
  return entry.author
}

/**
 * `YYYY-MM-DD HH:MM` in the reader's own timezone, or '' when git gave no
 * time. The detail strip shows the clock time as well as the day: two commits
 * on one afternoon are a common thing to be telling apart.
 * @param time - unix seconds.
 */
export function blameWhen(time: number): string {
  const date = blameDate(time)
  if (date === '') return ''
  const at = new Date(time * 1000)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date} ${pad(at.getHours())}:${pad(at.getMinutes())}`
}

/**
 * The hover text: who, when, and what the commit said it was doing.
 * Empty when there is nothing more than the gutter already shows.
 */
export function blameTitle(entry: BlameLine | undefined, notCommitted: string): string {
  if (entry === undefined) return ''
  if (entry.uncommitted) return notCommitted
  const parts = [entry.author, blameDate(entry.time), entry.summary].filter(part => part.length > 0)
  return parts.join(' · ')
}
