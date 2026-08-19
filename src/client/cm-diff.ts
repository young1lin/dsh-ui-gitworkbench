/**
 * Which lines of the editor's buffer differ from the side it is being edited
 * against — recomputed as the reader types.
 *
 * Arming the editor used to take the diff colours away: the buffer rendered as
 * one undifferentiated block, because the pane's add/delete tints come from
 * git's diff and git has not seen a keystroke. That is the wrong trade. The
 * reason to edit inside a diff view at all is to watch the change take shape,
 * and a view that goes blank the moment you touch it is a view you have to
 * leave to check your work.
 *
 * So the tint is recomputed client-side from the text on both sides. This is
 * NOT the diff any git operation uses — the block actions still send line
 * indices against the host's own `diffSha`-stamped patch, and nothing here
 * reaches git. It is a reading aid, and it is allowed to be approximate at the
 * exact moment a keystroke lands.
 *
 * The diff itself is CodeMirror's (`presentableDiff`, already aligned to line
 * boundaries); this module is the arithmetic from its character offsets to
 * line numbers.
 *
 * Pure: no React, no DOM, no git. `tests/cm-diff.test.ts` loads it directly.
 *
 * @module @young1lin/dsh-ui-gitworkbench/client/cm-diff
 */

import { presentableDiff } from '@codemirror/merge'

/** Which of the buffer's lines the reader has changed, 1-based as an editor
 *  counts them. */
export interface BufferDiff {
  /** Lines carrying text that is not on the other side: added or rewritten. */
  readonly changed: readonly number[]
  /** Lines that text was removed just BEFORE. A pure deletion leaves nothing
   *  in the buffer to tint, so the marker goes on the line that closed over
   *  the gap — which is where a reader looks for what went missing. */
  readonly deletedBefore: readonly number[]
}

/** Offsets at which each line of `text` starts. */
function lineStarts(text: string): number[] {
  const starts = [0]
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) {
    starts.push(at + 1)
  }
  return starts
}

/** 1-based line number containing `offset`, by binary search. */
function lineAt(starts: readonly number[], offset: number): number {
  let low = 0
  let high = starts.length - 1
  while (low < high) {
    const mid = (low + high + 1) >> 1
    if (starts[mid]! <= offset) low = mid
    else high = mid - 1
  }
  return low + 1
}

/**
 * Compare the buffer against the side it is edited against.
 *
 * @param original - the other side's whole text (the index side, for the
 *                   unstaged layer this editor lives on).
 * @param doc - the editor's buffer.
 * @returns the buffer's changed lines and its deletion points. Both are
 *          ascending and free of duplicates, which is what a decoration set
 *          wants and what makes two calls comparable.
 */
export function bufferDiff(original: string, doc: string): BufferDiff {
  if (original === doc) return { changed: [], deletedBefore: [] }
  const lines = doc.split('\n')
  const starts = lineStarts(doc)
  const changed = new Set<number>()
  const deletedBefore = new Set<number>()

  for (const change of presentableDiff(original, doc)) {
    if (change.fromB === change.toB) {
      // Nothing was INSERTED — but that does not mean a line disappeared. A
      // line the reader shortened (`example.com/taskqueue` to `example.com`)
      // is a pure deletion too, and it is still on screen, changed. Reading
      // every empty insertion as a vanished line is what left a shortened
      // line untinted until the next keystroke happened to add a character.
      const line = lineAt(starts, change.fromB)
      const removed = original.slice(change.fromA, change.toA)
      // Whole lines went only if the removed text both starts at a line
      // boundary and takes its newline with it.
      const wholeLines = removed.endsWith('\n')
        && (change.fromA === 0 || original[change.fromA - 1] === '\n')
      // An emptied line has nothing left to tint either way, so it reads as a
      // gap rather than as a coloured blank.
      if (wholeLines || (lines[line - 1] ?? '').length === 0) deletedBefore.add(line)
      else changed.add(line)
      continue
    }
    const first = lineAt(starts, change.fromB)
    // `toB` is exclusive. A change ending exactly at a line start stopped at
    // the previous line's newline and does not reach into the line after it.
    const last = lineAt(starts, Math.max(change.fromB, change.toB - 1))
    for (let line = first; line <= last; line += 1) changed.add(line)
  }

  return {
    changed: [...changed].sort((a, b) => a - b),
    deletedBefore: [...deletedBefore].filter(line => !changed.has(line)).sort((a, b) => a - b),
  }
}
