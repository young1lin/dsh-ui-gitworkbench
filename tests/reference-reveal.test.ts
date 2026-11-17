import { Text } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { matchesReferenceSource, savedHunkRanges, savedSelectionRange } from '../src/client/reference-reveal.ts'
import type { WorkbenchReference } from '../src/client/workbench-reference.ts'

const target: WorkbenchReference = { version: 1, repository: 'C:/repo/worktrees/review', path: 'src/a.ts',
  absolutePath: 'C:/repo/worktrees/review/src/a.ts', view: { kind: 'working' }, deleted: false,
  displayedSnapshot: { kind: 'selection', side: 'new', startLine: 2, endLine: 3, startColumn: 2, endColumn: 4,
    layer: 'unstaged', diffSha: 'diff-a', blob: 'blob-a' }, code: 'bc\r\ndef' }
const scope = { repository: target.repository, view: target.view, active: true }
const source = { layer: 'unstaged' as const, diffSha: 'diff-a', blob: 'blob-a' }
const doc = Text.of(['before', 'abc\r', 'defghi', 'after'])

describe('returning a reference to its displayed source', () => {
  it('requires the exact worktree, path, view, layer and captured source versions', () => {
    expect(matchesReferenceSource(target, scope, target.path, source)).toBe(true)
    expect(matchesReferenceSource(target, { ...scope, repository: 'C:\\repo\\worktrees\\review\\' }, target.path, source)).toBe(true)
    expect(matchesReferenceSource(target, { ...scope, repository: 'C:/repo' }, target.path, source)).toBe(false)
    expect(matchesReferenceSource(target, scope, 'other/a.ts', source)).toBe(false)
    expect(matchesReferenceSource(target, { ...scope, active: false }, target.path, source)).toBe(false)
    expect(matchesReferenceSource(target, scope, target.path, { ...source, layer: 'staged' })).toBe(false)
    expect(matchesReferenceSource(target, scope, target.path, { ...source, diffSha: 'diff-b' })).toBe(false)
    expect(matchesReferenceSource(target, scope, target.path, { ...source, blob: 'blob-b' })).toBe(false)
  })

  it('keeps historical and compare references pinned to immutable endpoints', () => {
    const commit = { kind: 'commit' as const, commit: 'a'.repeat(40) }
    const history = { ...target, view: commit, deleted: true }
    expect(matchesReferenceSource(history, { ...scope, view: commit }, target.path, source)).toBe(true)
    expect(matchesReferenceSource(history, scope, target.path, source)).toBe(false)
    expect(matchesReferenceSource(history, { ...scope, view: { ...commit, commit: 'b'.repeat(40) } }, target.path, source)).toBe(false)
    const compare = { kind: 'compare' as const, base: 'a'.repeat(40), head: 'b'.repeat(40) }
    expect(matchesReferenceSource({ ...target, view: compare }, { ...scope, view: compare }, target.path, source)).toBe(true)
    expect(matchesReferenceSource({ ...target, view: compare }, { ...scope, view: { ...compare, base: 'c'.repeat(40) } }, target.path, source)).toBe(false)
    expect(matchesReferenceSource(history, { ...scope, view: null }, target.path, source)).toBe(false)
  })

  it('restores a partial multiline selection without normalizing its CRLF bytes', () => {
    expect(savedSelectionRange(doc, target, 'new')).toEqual({ from: 8, to: 15 })
    expect(savedSelectionRange(doc, { ...target, code: 'bc\ndef' }, 'new')).toBe(null)
    expect(savedSelectionRange(doc, target, 'old')).toBe(null)
  })

  it('refuses stale coordinates and changed code rather than selecting a nearby match', () => {
    expect(savedSelectionRange(Text.of(['before', 'changed', 'defghi']), target, 'new')).toBe(null)
    expect(savedSelectionRange(Text.of(['before', 'abc\r']), target, 'new')).toBe(null)
    expect(savedSelectionRange(doc, { ...target, displayedSnapshot: { ...target.displayedSnapshot!, startColumn: 90 } }, 'new')).toBe(null)
    expect(savedSelectionRange(doc, { ...target, displayedSnapshot: { ...target.displayedSnapshot!, endColumn: 90 } }, 'new')).toBe(null)
  })

  it('checks only the captured range, preserving unrelated unsaved edits and original line offsets', () => {
    const old = { ...target, displayedSnapshot: { ...target.displayedSnapshot!, side: 'old' as const, startLine: 42, endLine: 43 } }
    expect(savedSelectionRange(Text.of(['abc\r', 'defghi']), old, 'old', 41)).toEqual({ from: 1, to: 8 })
    expect(savedSelectionRange(Text.of(['different before', 'abc\r', 'defghi', 'unsaved after']), target, 'new')).not.toBe(null)
  })

  it('validates both sides of a hunk including insertion and deletion anchors', () => {
    const hunk = { ...target, code: '@@ -2,1 +2,2 @@\n-old\r\n+new\r\n+added\r',
      displayedSnapshot: { kind: 'hunk' as const, side: 'unified' as const, oldRange: [2, 1] as const, newRange: [2, 2] as const } }
    const old = Text.of(['before\r', 'old\r', 'after'])
    const next = Text.of(['before\r', 'new\r', 'added\r', 'after'])
    expect(savedHunkRanges(old, next, hunk)).toEqual({ old: { from: 8, to: 12 }, new: { from: 8, to: 19 } })
    expect(savedHunkRanges(Text.of(['before\r', 'wrong\r', 'after']), next, hunk)).toBe(null)
    expect(savedHunkRanges(old, Text.of(['before\r', 'wrong\r', 'added\r', 'after']), hunk)).toBe(null)
    const deletion = { ...hunk, code: '@@ -2,1 +1,0 @@\n-old\r', displayedSnapshot: { ...hunk.displayedSnapshot, newRange: [1, 0] as const } }
    expect(savedHunkRanges(old, Text.of(['before\r', 'after']), deletion)).toEqual({ old: { from: 8, to: 12 }, new: { from: 8, to: 8 } })
    const insertion = { ...hunk, code: '@@ -1,0 +2,1 @@\n+new\r', displayedSnapshot: { ...hunk.displayedSnapshot, oldRange: [1, 0] as const, newRange: [2, 1] as const } }
    expect(savedHunkRanges(Text.of(['before\r', 'after']), Text.of(['before\r', 'new\r', 'after']), insertion)).not.toBe(null)
  })
})
