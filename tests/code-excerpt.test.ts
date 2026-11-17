import { describe, expect, it, vi } from 'vitest'
import { blockBounds, editorExcerpt, excerptText, insertExcerpt, selectedExcerpt, sideHunk, unifiedHunk } from '../src/client/code-excerpt.ts'
import { Text } from '@codemirror/state'
import { alignRows } from '../src/client/side-rows.ts'
import { parsePatch } from '../src/patch-model.ts'
import { parseRows } from '../src/client/diff-model.ts'

const diff = 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1,3 +1,3 @@\n one\n-old\n+new\n three\n'
describe('code snapshots for the conversation draft', () => {
  it('preserves original old/new row numbers when a frozen unified selection is quoted again', () => {
    const doc = Text.of(['old', 'new'])
    const source = { side: 'unified' as const, diffLines: [{ old: 42, new: 0, kind: 'del' }, { old: 0, new: 44, kind: 'add' }] }
    expect(editorExcerpt(doc, 0, 5, source)).toMatchObject({ text: 'old\nn', side: 'unified', startLine: 42, endLine: 44, diffLines: source.diffLines })
  })
  it('handles large selections without spreading one argument per backtick run', () => {
    const text = '`x'.repeat(200_000)
    expect(excerptText('/repo', { path: 'large.ts' }, { kind: 'working' }, { kind: 'selection', side: 'new', text }, 'Code')).toContain(text)
  })
  it.each([
    ['@@ -10,0 +11,1 @@\n+inserted\n', [10, 0], [11, 1]],
    ['@@ -10,1 +9,0 @@\n-deleted\n', [10, 1], [9, 0]],
    ['@@ -10,1 +10,2 @@\n+inserted\n context\n', [9, 0], [10, 1]],
  ])('keeps zero-count coordinates in %s', (patch, oldRange, newRange) => {
    const rows = parseRows(patch as string)
    expect(unifiedHunk(rows, 1, 2)).toMatchObject({ oldRange, newRange })
  })
  it('quotes one changed block with both line ranges', () => {
    const rows = alignRows(parsePatch(diff)!)
    const bounds = blockBounds(rows.map(row => row.block))
    expect(sideHunk(rows, ...bounds[0]!)).toEqual({ kind: 'hunk', side: 'unified', oldRange: [2, 1], newRange: [2, 1], text: '@@ -2,1 +2,1 @@\n-old\n+new' })
    const unified = parseRows(diff)
    expect(unifiedHunk(unified, 2, 4)?.text).toBe('@@ -2,1 +2,1 @@\n-old\n+new')
  })
  it('captures reversed partial selections and rejects cross-column drags', () => {
    const cell = (i: number) => ({ text: ['abcdef', 'ghijkl'][i]!, line: i + 5, side: 'old' as const })
    const a = { row: 1, column: 3, side: 'old' as const }
    const b = { row: 0, column: 2, side: 'old' as const }
    expect(selectedExcerpt(cell, a, b)).toMatchObject({ text: 'cdef\nghi', startLine: 5, endLine: 6, startColumn: 3, endColumn: 4 })
    expect(selectedExcerpt(cell, a, { ...b, side: 'new' })).toBeNull()
  })
  it('labels historical deletions and an unsaved pinned-worktree buffer without a live mention', () => {
    const text = excerptText('C:/repo/worktrees/fix', { path: 'deleted.ts', status: 'deleted', previousPath: 'old.ts' },
      { kind: 'commit', commit: 'a'.repeat(40) }, { kind: 'selection', side: 'old', text: '```\nold code', startLine: 8, endLine: 9, unsaved: true }, 'Code')
    expect(text).toContain('C:/repo/worktrees/fix/deleted.ts')
    expect(text).toContain('"deleted": true')
    expect(text).toContain('"commit": "' + 'a'.repeat(40))
    expect(text).toContain('"side": "old"')
    expect(JSON.parse(text.split('```git-workbench\n')[1]!.split('\n```')[0]!).code).toBe('```\nold code')
    expect(text).not.toContain('@C:')
  })
  it('inserts after selected draft text, using the original revision, and never sends', () => {
    const input = { focus: vi.fn(), insertReference: vi.fn(() => true) }
    const bridge = { getInput: () => input, resolve: vi.fn() }
    const actions = { captureInsertion: () => ({ start: 2, end: 7, draftRev: 19 }), insertText: vi.fn(() => true) }
    const snapshot = excerptText('/repo', { path: 'a.ts' }, { kind: 'working' },
      { kind: 'selection', side: 'new', text: 'actual code\r\n', startLine: 8, endLine: 9 }, 'Code')
    expect(insertExcerpt(bridge, 's1', actions, snapshot)).toBe('inserted')
    expect(input.insertReference).toHaveBeenCalledWith({ source: 'git-workbench', ref: snapshot, clipboardText: snapshot,
      label: 'a.ts:8–9', appearance: 'file' }, { start: 7, end: 7, draftRev: 19 })
    expect(actions.insertText).not.toHaveBeenCalled()
    expect(input.focus).toHaveBeenCalledOnce()
    expect(bridge.resolve).not.toHaveBeenCalled()
    input.insertReference.mockReturnValue(false)
    expect(insertExcerpt(bridge, 's1', actions, snapshot)).toBe('changed')
  })
})
