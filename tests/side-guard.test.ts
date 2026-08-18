import { describe, expect, it } from 'vitest'

import { SIDE_DIFF_CHAR_CAP, diffTooLarge, targetTooLarge } from '../src/side-guard.ts'

/** A deletion's diff as git prints it: whole old side as del lines, `+0,0` new. */
function deletionDiff(oldBytes: number): string {
  const head = 'diff --git a/big.txt b/big.txt\n--- a/big.txt\n+++ b/big.txt\n@@ -1,60000 +0,0 @@\n'
  const line = '-'.padEnd(41, 'x')
  const lines = Math.ceil(oldBytes / (line.length + 1))
  return head + `${line}\n`.repeat(lines)
}

describe('targetTooLarge', () => {
  it('trips past 2 MB or 20 000 lines, and not under either', () => {
    expect(targetTooLarge(2_000_001, 1)).toBe(true)
    expect(targetTooLarge(1, 20_001)).toBe(true)
    expect(targetTooLarge(2_000_000, 20_000)).toBe(false)
  })
})

describe('diffTooLarge', () => {
  it('bounds the patch text itself, at the guard\'s own 2 MB budget', () => {
    const wrap = (body: string): string => `@@ -1 +1 @@\n-${body}\n`
    // wrap adds exactly 14 chars around the body: land ON the cap (not over),
    // then one char past it.
    const filler = 'x'.repeat(SIDE_DIFF_CHAR_CAP - 14)
    expect(wrap(filler)).toHaveLength(SIDE_DIFF_CHAR_CAP)
    expect(diffTooLarge(wrap(filler))).toBe(false)
    expect(diffTooLarge(wrap(`${filler}x`))).toBe(true)
  })

  it('catches a worktree-deleted large file, where there is no target to measure', () => {
    // Review defeat (a): deleting a 2.4 MB tracked file leaves stat/readFile
    // nothing to guard on — the target-side check never runs — while the diff
    // is the whole old file as del lines. The diff cap is what bounds it.
    const diff = deletionDiff(2_400_000)
    expect(diff.length).toBeGreaterThan(SIDE_DIFF_CHAR_CAP)
    expect(diffTooLarge(diff)).toBe(true)
  })

  it('catches a huge left side behind a small target', () => {
    // Review defeat (b): a 5 MB index blob trimmed to a 50-line working file.
    // The target (the 50-line file) passes its guard; the diff still carries
    // the 5 MB old side as deletions, and only the diff cap sees it.
    const trimmed = 'x'.repeat(1_800)
    expect(targetTooLarge(trimmed.length, 50)).toBe(false)
    const diff = deletionDiff(5_000_000)
    expect(diffTooLarge(diff)).toBe(true)
  })
})
