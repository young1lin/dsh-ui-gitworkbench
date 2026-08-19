/**
 * The indentation unit a file uses, learned from the file itself.
 *
 * The editor's Tab key is CodeMirror's `indentWithTab`, which inserts and
 * removes whatever `indentUnit` is configured with — so the only decision left
 * is what that unit should be, and it is not a setting. This pane saves WHOLE
 * files: indenting with two spaces inside a four-space project writes
 * whitespace the project's own formatter will fight, and shows up in the next
 * diff as a change to lines nobody edited.
 *
 * So the unit is detected: a tab-indented Go file gets a tab, four-space Java
 * gets four.
 *
 * Pure: no React, no DOM, no git. `tests/indent.test.ts` loads it directly.
 *
 * @module @young1lin/dsh-ui-gitworkbench/client/indent
 */

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
 * @returns the unit to insert: a tab, N spaces, or {@link DEFAULT_INDENT}.
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

  // The unit divides every level the file uses, so it is the GCD of the
  // indents themselves — not the most common step between consecutive lines.
  // A Java file with a text block indents its body by two levels at once, and
  // counting steps makes that 8 the winner in a file indented by 4; 12 is not
  // a multiple of 8, so a GCD cannot make that mistake.
  //
  // Widths seen only ONCE are set aside first: a single continuation line
  // aligned under an open paren is at an arbitrary column, and one of those
  // would drag the GCD down to 1. If nothing repeats there is no majority to
  // protect, so the second pass reads them all.
  const seen = new Map<number, number>()
  for (const width of widths) {
    if (width > 0) seen.set(width, (seen.get(width) ?? 0) + 1)
  }
  const repeated = [...seen].filter(([, count]) => count > 1).map(([width]) => width)
  const unit = gcdOf(repeated.length > 0 ? repeated : [...seen.keys()])
  return unit === 0 ? DEFAULT_INDENT : ' '.repeat(unit)
}

/** GCD of a list, 0 for an empty one. */
function gcdOf(values: readonly number[]): number {
  return values.reduce((a, b) => gcd(a, b), 0)
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}
