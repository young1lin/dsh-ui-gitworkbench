import type { Text } from '@codemirror/state'

/** Folded ranges can sit inside the viewport; only paint the exposed lines. */
export function visibleLineRanges(doc: Text, ranges: readonly { from: number; to: number }[]): { from: number; to: number }[] {
  const lines: { from: number; to: number }[] = []
  for (const range of ranges) {
    const from = doc.lineAt(range.from).number - 1
    const to = doc.lineAt(range.to).number
    const previous = lines[lines.length - 1]
    if (previous && from <= previous.to) previous.to = Math.max(previous.to, to)
    else lines.push({ from, to })
  }
  return lines
}
