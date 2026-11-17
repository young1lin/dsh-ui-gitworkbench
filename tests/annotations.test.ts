import { describe, expect, it, vi } from 'vitest'
import { AnnotationStore, captureAnnotation, insertAnnotations, parseAnnotationBatch, serializeAnnotationBatch } from '../src/client/annotations.ts'
import { annotationInputSource, annotationRule } from '../src/client/annotation-source.ts'
import type { WorkbenchReference } from '../src/client/workbench-reference.ts'

const sha = 'a'.repeat(40)
const ref = (): WorkbenchReference => ({ version: 1, repository: 'C:/repo/.agents/worktrees/topic', path: 'old.ts',
  absolutePath: 'C:/repo/.agents/worktrees/topic/old.ts', view: { kind: 'working' }, deleted: true,
  code: 'deleted();\r\n', displayedSnapshot: { kind: 'selection', side: 'old', startLine: 7, endLine: 8 } })

describe('annotation capture and bounded pending state', () => {
  it('freezes selected bytes and resolves historical identity without reading current file content', async () => {
    const bridge = { getInput: () => null, resolve: vi.fn(async () => ({ repoRoot: ref().repository, path: 'old.ts', deleted: true,
      absolutePath: ref().absolutePath, kind: 'git' as const, revision: 'b'.repeat(40), revisionPath: 'before.ts', blob: sha, change: sha })) }
    const value = await captureAnnotation(bridge, ref().repository, { repoRoot: ref().repository, path: 'old.ts', previousPath: 'before.ts',
      deleted: true, view: { kind: 'commit', commit: 'aaaaaaa' } }, { ...ref().displayedSnapshot!, text: ref().code! }, new AbortController().signal)
    expect(value.view).toEqual({ kind: 'commit', commit: sha })
    expect(value.code).toBe('deleted();\r\n')
    expect(value.displayedSnapshot?.side).toBe('old')
    expect(value.previousPath).toBe('before.ts')
    expect(bridge.resolve).toHaveBeenCalledOnce()
  })
  it('retains notes across sources, sessions and cancellation; never silently evicts unsent notes', () => {
    const store = new AnnotationStore({ sessions: 2, items: 2, bytes: 2048 })
    const original = ref()
    store.begin('one', original)
    original.code = 'changed later'
    store.write('one', 'keep deletion')
    expect(store.save('one')).toBe(true)
    expect(store.get('one').items[0]?.reference.code).toBe('deleted();\r\n')
    store.begin('one', ref()); store.write('one', 'unfinished')
    expect(store.begin('one', ref())).toBe(false)
    expect(store.get('one').editing?.note).toBe('unfinished')
    store.cancel('one')
    expect(store.get('one').items).toHaveLength(1)
    store.begin('two', ref()); store.write('two', 'other session'); store.save('two')
    expect(() => store.begin('three', ref())).toThrow()
    expect(store.size().sessions).toBe(2)
    store.dispose()
    expect(store.size()).toEqual({ sessions: 0, items: 0, bytes: 0 })
  })
  it('does not remove edited or newly added notes when completing an older batch', () => {
    const store = new AnnotationStore()
    store.begin('one', ref()); store.write('one', 'first'); store.save('one')
    const snapshot = store.get('one').items
    store.edit('one', snapshot[0]!.id); store.write('one', 'updated'); store.save('one')
    store.complete('one', snapshot)
    expect(store.get('one').items[0]?.note).toBe('updated')
  })
  it('does not serialize captured code again while typing a note', () => {
    const store = new AnnotationStore()
    store.begin('one', { ...ref(), code: 'captured source'.repeat(10000) })
    const stringify = vi.spyOn(JSON, 'stringify')
    try {
      store.write('one', 'a'); store.write('one', 'a longer note')
      expect(stringify).not.toHaveBeenCalled()
      expect(store.get('one').editing?.note).toBe('a longer note')
    } finally { stringify.mockRestore() }
  })
})

describe('one atomic draft insertion for multiple notes', () => {
  const batch = () => ({ version: 1 as const, annotations: [{ reference: ref(), note: 'keep this deletion' },
    { reference: { ...ref(), view: { kind: 'commit' as const, commit: sha }, code: 'historical();' }, note: 'check historical code' }] })
  it('round trips notes, CRLF, old side and each independent worktree/version through both native codecs', async () => {
    const text = serializeAnnotationBatch(batch())
    expect(parseAnnotationBatch(JSON.stringify(batch()))).toEqual(batch())
    const match = annotationRule.match(text, 0, { read: () => undefined })!
    expect(match.data).toEqual(batch())
    const open = vi.fn(async () => true)
    const source = annotationInputSource(open)
    expect(await source.codec!.serialize(text, new AbortController().signal)).toBe(text)
    expect(source.openReference!({ sessionId: 'one' } as never, { ref: text } as never)).toBe(true)
    expect(open).toHaveBeenCalledWith('one', batch())
    const bad = batch(); bad.annotations[0]!.reference.absolutePath = 'C:/another/old.ts'
    expect(parseAnnotationBatch(JSON.stringify(bad))).toBeNull()
    expect(parseAnnotationBatch(JSON.stringify({ ...batch(), annotations: [] }))).toBeNull()
  })
  it('collapses draft selection, inserts once and leaves existing draft and chips to DSH', () => {
    const input = { insertReference: vi.fn(() => true), focus: vi.fn() }
    const actions = { captureInsertion: () => ({ start: 2, end: 9, draftRev: 12 }), insertText: vi.fn() }
    const bridge = { getInput: () => input, resolve: vi.fn() }
    expect(insertAnnotations(bridge, 'one', actions, batch(), '2 annotations')).toBe('inserted')
    expect(input.insertReference).toHaveBeenCalledOnce()
    expect(input.insertReference.mock.calls[0]?.[1]).toEqual({ start: 9, end: 9, draftRev: 12 })
    expect(actions.insertText).not.toHaveBeenCalled()
    input.insertReference.mockReturnValue(false)
    expect(insertAnnotations(bridge, 'one', actions, batch(), '2 annotations')).toBe('changed')
    bridge.getInput = vi.fn().mockReturnValueOnce(input).mockReturnValueOnce(null)
    expect(insertAnnotations(bridge, 'one', actions, batch(), '2 annotations')).toBe('changed')
    expect(input.insertReference).toHaveBeenCalledTimes(2)
  })
})
