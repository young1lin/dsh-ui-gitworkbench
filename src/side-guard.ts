/**
 * The side-by-side diff pane's size guard, as a decision rather than two
 * scattered comparisons.
 *
 * The guard exists for the wire, not the reader: a full-context patch carries
 * the WHOLE file, so past these caps "a 2 MB patch per click is not a
 * reasonable wire payload and the side-by-side DOM would be enormous" (the
 * design spec's own words for why the pane declines).
 *
 * Two measurements, because they bound different things:
 *
 *   - the TARGET (right-hand) file's byte size and line count — checked
 *     BEFORE the diff is produced, so declining a pathological file never
 *     means reading it whole first;
 *   - the produced diff text itself — checked AFTER, because the target-side
 *     check has two blind spots the review caught: a file DELETED from the
 *     working tree has no target to measure while its diff is the entire old
 *     file as del lines, and a huge LEFT side behind a small target (a 5 MB
 *     index blob trimmed to 50 lines) passes the target guard while the patch
 *     still carries the 5 MB old side. Only the diff text sees both.
 *
 * Pure: no React, no CSS, no git, no node. `tests/side-guard.test.ts` loads
 * it directly, defeat cases included.
 *
 * @module @young1lin/dsh-ui-gitworkbench/side-guard
 */

/** Target side past this many bytes is declined. */
export const SIDE_BYTE_CAP = 2_000_000
/** Target side past this many lines is declined. */
export const SIDE_LINE_CAP = 20_000
/** Diff text past this many characters is declined — the guard's own 2 MB
 *  budget applied to the payload itself, `clipDiff`'s character convention. */
export const SIDE_DIFF_CHAR_CAP = 2_000_000

/**
 * The before-the-diff half: does the layer's right-hand file already exceed
 * the guard?
 *
 * @param byteLength - the target's size in bytes.
 * @param lineCount - the target's line count.
 * @returns true when the pane should decline without producing a diff.
 */
export function targetTooLarge(byteLength: number, lineCount: number): boolean {
  return byteLength > SIDE_BYTE_CAP || lineCount > SIDE_LINE_CAP
}

/**
 * The after-the-diff half: does the patch text itself exceed the guard? This
 * is what bounds the wire payload when the target measurement cannot — a
 * deleted working-tree file, or a huge left side behind a small target.
 *
 * @param diff - the layer's full-context diff, exactly as it would be returned.
 * @returns true when the pane should decline instead of shipping it.
 */
export function diffTooLarge(diff: string): boolean {
  return diff.length > SIDE_DIFF_CHAR_CAP
}
