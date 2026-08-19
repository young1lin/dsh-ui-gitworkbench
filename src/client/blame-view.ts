/**
 * How one blame entry reads in the gutter.
 *
 * The gutter is narrow and sits beside code, so it carries the least that
 * still answers "who and when": a short sha and a date. Everything else — the
 * author's name, the commit subject — goes in the title, which is where a
 * reader looks once they have decided this line is the one they care about.
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
 * The one line the gutter shows.
 *
 * @param entry - the line's provenance, or undefined for a line the blame did
 *                not cover (a truncated file, a line added since the fetch).
 * @param notCommitted - the drawer's own wording for a line with no commit
 *                       behind it; git's English is not passed through.
 * @returns the gutter text, '' when there is nothing to say.
 */
export function blameLabel(entry: BlameLine | undefined, notCommitted: string): string {
  if (entry === undefined) return ''
  if (entry.uncommitted) return notCommitted
  const hash = shortHash(entry.hash)
  const date = blameDate(entry.time)
  if (hash === '') return date
  return date === '' ? hash : `${hash} ${date}`
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
