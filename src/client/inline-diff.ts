import { parsePatch } from '../patch-model.ts'

export function finalNewlineChange(original: string, current: string): 'finalNewlineAdded' | 'finalNewlineRemoved' | null {
  return original.endsWith('\n') === current.endsWith('\n') ? null : current.endsWith('\n') ? 'finalNewlineAdded' : 'finalNewlineRemoved'
}
/** Full-context patches carry the old bytes, including their final-newline marker. */
export function originalFromPatch(patch: string, unchanged: string): string {
  const hunk = parsePatch(patch)?.hunks[0]
  if (!hunk) return unchanged
  const lines: string[] = []
  let noNewline = false
  for (let i = 0; i < hunk.lines.length; i++) {
    const line = hunk.lines[i]!
    if (line.kind !== 'context' && line.kind !== 'del') continue
    lines.push(line.text)
    noNewline = hunk.lines[i + 1]?.kind === 'nonewline'
  }
  return lines.join('\n') + (lines.length > 0 && !noNewline ? '\n' : '')
}

/** A caret follows the closest saved hunk without scanning the file on a keypress. */
export function inlineBlockAt(starts: readonly number[], line: number): number | null {
  if (starts.length === 0) return null
  let low = 0
  let high = starts.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if (starts[mid]! <= line) low = mid + 1
    else high = mid
  }
  return Math.max(0, low - 1)
}
