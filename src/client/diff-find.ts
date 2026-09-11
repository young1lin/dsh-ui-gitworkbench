/**
 * Find in a rendered diff — the rules behind the unified pane's Ctrl+F.
 *
 * The Files tab and the Changes pane get their find panel from CodeMirror,
 * because they hold an editor. History and Compare hold a windowed diff with
 * no editor under it, so they had no find at all — and the browser's own
 * Ctrl+F cannot stand in, because a windowed pane keeps only the rows near
 * the viewport in the DOM and native find searches the DOM.
 *
 * Same discipline as `search-count.ts`, which this shares its cap with: the
 * walk is proportional to the diff, so it never runs on the keystroke path —
 * the pane defers it until typing stops — and it stops at {@link MATCH_CAP}
 * so a one-letter query over a long diff is bounded in time and memory. The
 * hits are KEPT, so stepping between them is an index lookup, and painting
 * asks per VISIBLE row ({@link rowHitRanges}), which is proportional to the
 * viewport.
 *
 * Literal and case-insensitive, no options. A diff is read, not edited, and
 * the question is "where does this word appear", which needs no dialect.
 *
 * Pure: `tests/diff-find.test.ts` loads it directly.
 *
 * @module @young1lin/dsh-ui-gitworkbench/client/diff-find
 */

import { MATCH_CAP } from './search-count.ts'
import type { PaintedTok } from './diff-model.ts'

/** One match: which row, and the character it starts at. */
export interface FindHit {
  readonly row: number
  readonly col: number
}

/** Every hit up to the cap, in row-then-column order. */
export interface FindIndex {
  readonly hits: readonly FindHit[]
  /** There were more than were kept; the total reads `N+`. */
  readonly capped: boolean
}

/** No query, or nothing found. */
export const EMPTY_FIND: FindIndex = { hits: [], capped: false }

/** Regex metacharacters, escaped so the query matches itself. */
function escapeRegExp(literal: string): string {
  return literal.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')
}

/** The matcher for a query, or null when the query is blank. Global so
 *  `exec` walks a row; case-insensitive because that is the only mode. */
function matcherFor(query: string): RegExp | null {
  const trimmed = query.trim()
  return trimmed.length === 0 ? null : new RegExp(escapeRegExp(trimmed), 'gi')
}

/**
 * Walk every row for the query, stopping at `cap` hits.
 *
 * Non-overlapping, the way every editor's find counts: "aa" in "aaaa" is two.
 * A zero-width match cannot happen (the query is a non-empty literal), so the
 * `exec` loop always advances.
 */
export function findInTexts(texts: readonly string[], query: string, cap: number = MATCH_CAP): FindIndex {
  const re = matcherFor(query)
  if (re === null) return EMPTY_FIND
  const hits: FindHit[] = []
  for (let row = 0; row < texts.length; row += 1) {
    re.lastIndex = 0
    for (let m = re.exec(texts[row]!); m !== null; m = re.exec(texts[row]!)) {
      // One past the cap answers "are there more" without walking on: `capped`
      // must mean there ARE more, or a total landing on the cap reads `5000+`.
      if (hits.length >= cap) return { hits, capped: true }
      hits.push({ row, col: m.index })
    }
  }
  return { hits, capped: false }
}

/** The character ranges of one row's matches — asked per visible row, so the
 *  painting cost is the viewport's, not the diff's. */
export function rowHitRanges(text: string, query: string): readonly (readonly [number, number])[] {
  const re = matcherFor(query)
  if (re === null) return []
  const out: (readonly [number, number])[] = []
  for (let m = re.exec(text); m !== null; m = re.exec(text)) out.push([m.index, m.index + m[0].length])
  return out
}

/** A painted token with its find state: 0 none, 1 a hit, 2 the current hit. */
export interface HitTok extends PaintedTok {
  readonly hit: 0 | 1 | 2
}

/**
 * Split already-painted tokens at hit boundaries, keeping their colour and
 * word mark. The same walk `overlayRanges` does for word changes, run once
 * more on top of its output rather than folded into it: the word ranges come
 * from the diff and the hit ranges from the reader, and the two are not
 * decided at the same time.
 *
 * @param currentCol - the column of the current hit on this row, when it is
 *   on this row; that hit is tagged 2 so it can be drawn apart.
 */
export function overlayHits(
  painted: readonly PaintedTok[],
  ranges: readonly (readonly [number, number])[],
  currentCol: number | null,
): HitTok[] {
  if (ranges.length === 0) return painted.map(tok => ({ ...tok, hit: 0 }))
  const out: HitTok[] = []
  let offset = 0
  let ri = 0
  for (const tok of painted) {
    let local = 0
    while (local < tok.text.length) {
      const abs = offset + local
      while (ri < ranges.length && ranges[ri]![1] <= abs) ri += 1
      const range = ranges[ri]
      const inside = range !== undefined && abs >= range[0] && abs < range[1]
      const cut = inside
        ? Math.min(tok.text.length, range[1] - offset)
        : range !== undefined && range[0] > abs
          ? Math.min(tok.text.length, range[0] - offset)
          : tok.text.length
      if (cut > local) {
        const hit: 0 | 1 | 2 = !inside ? 0 : range[0] === currentCol ? 2 : 1
        out.push({ ...tok, text: tok.text.slice(local, cut), hit })
      }
      local = cut > local ? cut : local + 1
    }
    offset += tok.text.length
  }
  return out
}

/** The bar's readout: `3/128`, `3/5000+` when the walk stopped early, `0/0`
 *  for a query that finds nothing. Numbers only, like the editor panel's. */
export function formatHits(index: FindIndex, current: number): string {
  const total = index.hits.length
  if (total === 0) return '0/0'
  return `${current < 0 ? 0 : current + 1}/${total}${index.capped ? '+' : ''}`
}

/** The next hit index in a direction, wrapping; -1 from nowhere goes to the
 *  first (forward) or the last (back). -1 when there are none. */
export function stepHit(total: number, current: number, direction: 1 | -1): number {
  if (total <= 0) return -1
  if (current < 0 || current >= total) return direction === 1 ? 0 : total - 1
  return (current + direction + total) % total
}

/** The first hit at or after `row` — where a fresh query lands, so the reader
 *  is taken to the nearest match below what they are looking at rather than
 *  back to the top. Wraps to the first when every hit is above. -1 with none. */
export function nearestHit(hits: readonly FindHit[], row: number): number {
  if (hits.length === 0) return -1
  let low = 0
  let high = hits.length
  while (low < high) {
    const mid = (low + high) >> 1
    if (hits[mid]!.row < row) low = mid + 1
    else high = mid
  }
  return low === hits.length ? 0 : low
}
