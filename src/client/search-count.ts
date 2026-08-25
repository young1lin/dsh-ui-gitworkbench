/**
 * How many matches the find panel found, and which one you are on.
 *
 * The panel ships without a count, which leaves the one question a reader
 * actually has unanswered: a query that highlights nothing on screen might
 * have no matches at all, or two hundred of them below the fold, and the panel
 * looks identical either way.
 *
 * Counting is proportional to the DOCUMENT, and this drawer does not put work
 * proportional to the document on the keystroke path. Two things keep that
 * true, and both live here rather than in the wiring:
 *
 * - the walk stops at {@link MATCH_CAP}. A cap that turns a feature off would
 *   be no fix, so this one bounds the WORK and keeps the feature: past the cap
 *   the total reads `5000+`, which answers "is my query too broad" as well as
 *   an exact number would. It bounds memory the same way — a single-letter
 *   search over 20,000 lines of real TypeScript finds 71,515 matches, and an
 *   array of those is half a megabyte kept alive for a number nobody reads.
 * - the offsets are KEPT, so moving between matches is a binary search rather
 *   than a second walk. Measured on this repo's own client sources: a full
 *   count costs 3-5ms at 300 lines, 9-11ms at 2,000, 12ms at 4,000, and 60ms
 *   at 20,000 (`SIDE_LINE_CAP`, the ceiling the pane will load). Recounting on
 *   every Enter would put that 60ms on the navigation path; recounting when
 *   the typing stops puts it nowhere the reader can feel it.
 *
 * The index belongs to one query over one document, and the caller throws it
 * away when either changes — see `SearchCount` in `CodeEditor.tsx`.
 *
 * @module @young1lin/dsh-ui-gitworkbench/client/search-count
 */

/**
 * How many match positions are kept.
 *
 * 5,000 is past any count a reader distinguishes from "lots" and well inside
 * what the pane can hold: at 8 bytes an offset it is 40KB, against the half a
 * megabyte an uncapped single-letter search over the ceiling would take.
 */
export const MATCH_CAP = 5000

/** Where every match starts, and whether the walk stopped early. */
export interface MatchIndex {
  /** Ascending start offsets, at most {@link MATCH_CAP} of them. */
  readonly offsets: readonly number[]
  /** There were more matches than were kept; the total reads `N+`. */
  readonly capped: boolean
}

/** No query, or a query with nothing to find. */
export const EMPTY_INDEX: MatchIndex = { offsets: [], capped: false }

/** One match start, however it is handed over. */
interface Match { readonly from: number }

/**
 * Anything that yields matches in order.
 *
 * Both halves of the union are here for a reason: `SearchQuery.getCursor` is
 * DECLARED as an iterator and is also iterable at runtime, while a test wants
 * to hand over a plain array. Accepting either keeps the rule readable without
 * a document, a view or a DOM behind it.
 */
export type MatchWalk = Iterable<Match> | Iterator<Match>

/**
 * Walk matches into an index, stopping at `cap`.
 *
 * The walk is driven by hand rather than with `for…of`, because the union
 * above may arrive already unwrapped. A cursor reuses ONE object across
 * iterations, which is safe here only because nothing but the number is kept.
 */
export function indexMatches(matches: MatchWalk, cap: number = MATCH_CAP): MatchIndex {
  const step: Iterator<Match> = Symbol.iterator in matches
    ? matches[Symbol.iterator]()
    : matches
  const offsets: number[] = []
  for (;;) {
    if (offsets.length >= cap) {
      // Ask once more: `capped` has to mean "there are more", not "there might
      // have been", or a total that lands exactly on the cap reads as `5000+`.
      return { offsets, capped: step.next().done !== true }
    }
    const next = step.next()
    if (next.done === true) return { offsets, capped: false }
    offsets.push(next.value.from)
  }
}

/**
 * Which match the position `from` is on or before, 1-based; 0 when there are
 * none.
 *
 * The first match at or after the caret, because that is the one the panel
 * will land on — which makes the answer right in both of the states the reader
 * sees it in. Straight after typing the caret has not moved and the count
 * should already read `1/128`, not `0/128`; after Enter the selection sits
 * exactly on a match and the lower bound IS that match. Past the last one the
 * panel wraps, so the answer wraps with it.
 */
export function ordinalAt(index: MatchIndex, from: number): number {
  const { offsets } = index
  if (offsets.length === 0) return 0
  let low = 0
  let high = offsets.length
  while (low < high) {
    const mid = (low + high) >> 1
    if (offsets[mid]! < from) low = mid + 1
    else high = mid
  }
  return low === offsets.length ? 1 : low + 1
}

/**
 * The label: `3/128`, `3/5000+` when the walk stopped early, `0/0` for a query
 * that finds nothing.
 *
 * No words, in a panel whose own labels are the library's English and are not
 * translated either — a pair of numbers says it in every language the drawer
 * ships (see `locales.ts` for the strings that do need both).
 */
export function formatCount(index: MatchIndex, ordinal: number): string {
  const total = index.offsets.length
  if (total === 0) return '0/0'
  return `${ordinal}/${total}${index.capped ? '+' : ''}`
}
