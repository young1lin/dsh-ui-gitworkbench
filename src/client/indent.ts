/**
 * What the Tab key does inside the side pane's editor: insert this file's own
 * indentation, or take one level back off it.
 *
 * A textarea's default Tab moves focus, which is right for a form and wrong
 * for an editor — the reader pressing Tab in code means indentation, and
 * losing the caret instead is the kind of thing that makes a pane feel broken
 * rather than limited. So the editor handles Tab itself, and everything it
 * needs to decide lives here as text-in / text-out.
 *
 * The unit is DETECTED, not configured: a file indented with tabs gets a tab
 * and a file indented with four spaces gets four. Guessing wrong here writes
 * whitespace the project's own formatter will fight, and this pane saves whole
 * files — a mixed-indentation save is a diff on lines nobody edited.
 *
 * Pure: no React, no DOM, no git. `tests/indent.test.ts` loads it directly.
 *
 * @module @young1lin/dsh-ui-gitworkbench/client/indent
 */

/** A Tab edit's result: the new buffer and where the selection ends up. */
export interface TabEdit {
  readonly text: string
  readonly selectionStart: number
  readonly selectionEnd: number
}

/** Fallback unit for a file with no indentation to learn from. */
export const DEFAULT_INDENT = '  '

/**
 * The file's own indentation unit, learned from its lines.
 *
 * Tabs win on count, because a single tab-indented line is unambiguous while
 * spaces need a step to be inferred. For spaces the step is the most common
 * NON-ZERO difference between the indents of consecutive lines — the same
 * reasoning editors use, and the reason a file whose every line happens to sit
 * at four spaces still reports four rather than its total depth.
 *
 * @param text - the whole buffer.
 * @returns the unit to insert: `'\t'`, N spaces, or {@link DEFAULT_INDENT}.
 */
export function detectIndent(text: string): string {
  const lines = text.split('\n')
  let tabs = 0
  let spaced = 0
  const widths: number[] = []
  for (const line of lines) {
    if (line.trim().length === 0) continue
    if (line.startsWith('\t')) { tabs += 1; continue }
    const width = line.length - line.trimStart().length
    if (width > 0) spaced += 1
    widths.push(width)
  }
  if (tabs > spaced) return '\t'

  // Most common positive step between consecutive lines' indents.
  const steps = new Map<number, number>()
  for (let i = 1; i < widths.length; i += 1) {
    const step = Math.abs(widths[i]! - widths[i - 1]!)
    if (step > 0) steps.set(step, (steps.get(step) ?? 0) + 1)
  }
  let best = 0
  let bestCount = 0
  for (const [step, count] of steps) {
    // Ties go to the SMALLER step: 4 and 8 both appear in a 4-indented file,
    // and 8 is two levels of it, never the unit.
    if (count > bestCount || (count === bestCount && step < best)) { best = step; bestCount = count }
  }
  if (best > 0) return ' '.repeat(best)
  // No steps to learn from: a flat file, or one single indented line.
  const only = widths.find(width => width > 0)
  return only === undefined ? DEFAULT_INDENT : ' '.repeat(only)
}

/** Whether the selection covers more than one line, which makes Tab a block
 *  indent rather than an insertion. A caret sitting anywhere on one line is
 *  the insertion case, as it is in every editor. */
function spansLines(text: string, start: number, end: number): boolean {
  return end > start && text.slice(start, end).includes('\n')
}

/** Start offset of the line containing `offset`. */
function lineStart(text: string, offset: number): number {
  const before = text.lastIndexOf('\n', offset - 1)
  return before === -1 ? 0 : before + 1
}

/**
 * Apply a Tab (or Shift+Tab) to a buffer.
 *
 * Four cases, and the caller does not need to know which one applied:
 *
 *   - Tab with a caret or a within-line selection inserts one unit, replacing
 *     the selection as typing would;
 *   - Tab across lines indents every line it touches, keeping the same lines
 *     selected so the next Tab indents again;
 *   - Shift+Tab removes one unit from the front of every line it touches, and
 *     tolerates a partial unit (three spaces under a four-space unit) rather
 *     than refusing;
 *   - Shift+Tab with a caret outdents that one line, whatever the caret's
 *     column — the line is what is being outdented.
 *
 * @param text - the buffer.
 * @param selectionStart - the textarea's selectionStart.
 * @param selectionEnd - the textarea's selectionEnd.
 * @param unit - from {@link detectIndent}.
 * @param outdent - true for Shift+Tab.
 * @returns the new buffer and selection.
 */
export function tabEdit(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  unit: string,
  outdent: boolean,
): TabEdit {
  const start = Math.max(0, Math.min(selectionStart, text.length))
  const end = Math.max(start, Math.min(selectionEnd, text.length))

  if (!outdent && !spansLines(text, start, end)) {
    const next = `${text.slice(0, start)}${unit}${text.slice(end)}`
    const caret = start + unit.length
    return { text: next, selectionStart: caret, selectionEnd: caret }
  }

  const from = lineStart(text, start)
  // A selection ending exactly at a line start does not include that line: the
  // reader dragged to the beginning of it, not into it.
  // The edit works in WHOLE lines, so the range grows to line boundaries at
  // both ends. Growing the END matters most for a bare caret: an outdent
  // with nothing selected still has a line to take a level off, and slicing
  // at the caret hands the loop an empty body that silently changes nothing.
  const lastLine = lineStart(text, end > from && text[end - 1] === '\n' ? end - 1 : end)
  const lineBreak = text.indexOf('\n', lastLine)
  const to = lineBreak === -1 ? text.length : lineBreak
  const head = text.slice(0, from)
  const body = text.slice(from, Math.max(from, to))
  const tail = text.slice(Math.max(from, to))

  let firstDelta = 0
  let total = 0
  const lines = body.split('\n').map((line, index) => {
    if (outdent) {
      const removed = outdentWidth(line, unit)
      if (index === 0) firstDelta = -removed
      total -= removed
      return line.slice(removed)
    }
    // A blank line gains nothing: trailing whitespace on an empty line is the
    // diff noise this pane exists to avoid producing.
    if (line.length === 0) return line
    if (index === 0) firstDelta = unit.length
    total += unit.length
    return `${unit}${line}`
  })

  const next = `${head}${lines.join('\n')}${tail}`
  return {
    text: next,
    selectionStart: Math.max(from, start + firstDelta),
    selectionEnd: Math.max(from, end + total),
  }
}

/** How many characters one outdent takes off this line: a whole unit, or the
 *  partial indentation it actually has. */
function outdentWidth(line: string, unit: string): number {
  if (line.startsWith(unit)) return unit.length
  if (unit === '\t') return line.startsWith('\t') ? 1 : 0
  const width = line.length - line.trimStart().length
  return Math.min(width, unit.length)
}
