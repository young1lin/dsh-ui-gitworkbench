/**
 * The line-ending phantom: a file git lists as modified forever while every
 * content diff is empty (autocrlf / eol attributes make the stat check and
 * the clean filter disagree — the classic always-modified file of a Windows
 * checkout). The pane it opens must EXPLAIN that, not fall to the generic
 * "no text changes" that reads as a broken blank.
 */
import { describe, expect, it } from 'vitest'
import { isPhantomModified } from '../src/client/diff-model.ts'

describe('isPhantomModified', () => {
  it('flags a listed-modified file whose whole-file segment is empty', () => {
    expect(isPhantomModified('modified', '')).toBe(true)
  })

  it('does not flag a modified file that has content to show', () => {
    // A fully-staged file has an empty UNSTAGED layer, but its whole-file
    // segment (HEAD vs worktree) is not empty — the reader is one click
    // from the content, which is not the phantom.
    expect(isPhantomModified('modified', 'diff --git a/f b/f\n')).toBe(false)
  })

  it('does not flag other statuses with an empty segment', () => {
    // 'untracked' synthesizes a new-file segment (never empty when it shows);
    // 'added'/'deleted'/'renamed' always produce a diff.
    expect(isPhantomModified('untracked', '')).toBe(false)
    expect(isPhantomModified('added', '')).toBe(false)
    expect(isPhantomModified('deleted', '')).toBe(false)
    expect(isPhantomModified('renamed', '')).toBe(false)
  })

  it('does not flag when the row carries no status', () => {
    expect(isPhantomModified(undefined, '')).toBe(false)
  })
})
