/**
 * Shiki's per-line tokens, restated as absolute document ranges CodeMirror can
 * decorate.
 *
 * The editor does not carry a second syntax engine. `highlightFile` already
 * lexes this file for the diff columns, and re-lexing the same text with a
 * different grammar would cost another engine in the bundle AND paint the
 * editor in colours the diff beside it does not use. So the editor borrows the
 * tokens the pane already computed; this module is the arithmetic between the
 * two — per-line runs in, absolute offsets out.
 *
 * Only runs that actually PAINT something become ranges. A plain run inherits
 * the editor's own colour, and a decoration that changes nothing still costs a
 * DOM element per token, which for a whole file is most of them.
 *
 * Pure: no CodeMirror, no React, no DOM. `tests/cm-tokens.test.ts` loads it
 * directly, and the CodeMirror glue turns these into `Decoration.mark`s.
 *
 * @module @young1lin/dsh-ui-gitworkbench/client/cm-tokens
 */

import type { HighlightRun } from './highlight.ts'

/** One painted span, in absolute offsets from the start of the document. */
export interface TokenRange {
  readonly from: number
  readonly to: number
  readonly color?: string
  readonly italic?: boolean
}

/** Whether a run paints anything the editor's own style does not already. */
function paints(run: HighlightRun): boolean {
  return run.color !== undefined || run.italic === true
}

/**
 * Turn per-line highlight runs into document ranges.
 *
 * @param lines - the document's lines, exactly as it was split on LF. Their
 *                lengths are what convert a line-relative offset to an
 *                absolute one, so they must be the SAME lines the runs
 *                describe.
 * @param runs - `highlightFile`'s answer, or undefined while a grammar is
 *               still loading — which yields no ranges rather than throwing,
 *               the same contract the diff columns read it under.
 * @returns painted ranges in document order, ready to sort into a range set.
 *          A run whose text runs past the end of its line is clipped there: a
 *          decoration crossing a line boundary is an error CodeMirror throws
 *          on, and the honest answer to disagreeing inputs is less paint, not
 *          a crash in the editor.
 */
export function tokenRanges(
  lines: readonly string[],
  runs: readonly (readonly HighlightRun[] | undefined)[] | undefined,
): TokenRange[] {
  if (runs === undefined) return []
  const out: TokenRange[] = []
  let lineStart = 0
  lines.forEach((line, index) => {
    for (const range of lineTokenRanges(line, lineStart, runs[index])) out.push(range)
    // +1 for the LF that `split('\n')` removed. The last line has none, but
    // nothing reads past it either.
    lineStart += line.length + 1
  })
  return out
}

/**
 * One line's painted ranges, in absolute offsets.
 *
 * The unit the viewport painter works in: it knows each visible line's own
 * offset from CodeMirror and never wants the arithmetic for the lines above it.
 * {@link tokenRanges} is this function walked down a whole document.
 *
 * @param text - the line, as the document holds it.
 * @param start - the line's absolute offset in the document.
 * @param runs - that line's highlight runs, or undefined for "not painted",
 *               which yields no ranges rather than throwing.
 */
export function lineTokenRanges(
  text: string,
  start: number,
  runs: readonly HighlightRun[] | undefined,
): TokenRange[] {
  if (runs === undefined) return []
  const out: TokenRange[] = []
  let at = 0
  for (const run of runs) {
    const from = start + at
    at += run.text.length
    const to = Math.min(start + at, start + text.length)
    if (to > from && paints(run)) {
      out.push({ from, to, color: run.color, italic: run.italic })
    }
    if (at >= text.length) break
  }
  return out
}
