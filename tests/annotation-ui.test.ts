import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AddExcerptButton, FileActionsProvider } from '../src/client/FileActions.tsx'
import { AnnotationsPanel, AnnotationBatchNode } from '../src/client/AnnotationsPanel.tsx'
import { AnnotationStore, parseAnnotationBatch } from '../src/client/annotations.ts'
import { en, zh } from '../src/client/locales.ts'
vi.mock('../src/client/GitWorkbenchPanel.module.css', () => ({ default: {} }))
afterEach(() => vi.unstubAllGlobals())

describe('annotation composer integration', () => {
  it.each([en, zh])('keeps pending notes on a failed CAS and inserts the complete group once on retry', async dictionary => {
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
    vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
    const store = new AnnotationStore(), focus = vi.fn()
    const input = { insertReference: vi.fn(() => false), focus: vi.fn() }
    const bridge = { getInput: () => input, resolve: vi.fn() }
    const actions = { captureInsertion: vi.fn(() => ({ start: 2, end: 8, draftRev: 4 })), insertText: vi.fn() }
    const t = (key: string, args: Record<string, unknown> = {}) => (dictionary[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(args[name]))
    let renderer: ReturnType<typeof create>
    act(() => { renderer = create(createElement(FileActionsProvider, { t, sessionId: 'one', worktreePath: 'C:/repo/topic', repoRoot: 'C:/repo/topic',
      view: { kind: 'working' }, bridge, draftActions: actions, annotations: store, beforeAdd: action => action(), onAdded: vi.fn(),
      children: [createElement(AddExcerptButton, { key: 'quote', file: { path: 'gone.ts', status: 'deleted' }, kind: 'selection',
        capture: () => ({ kind: 'selection', side: 'old', startLine: 4, endLine: 4, text: 'removed();\r' }) }), createElement(AnnotationsPanel, { key: 'notes', t })],
    }), { createNodeMock: node => node.type === 'textarea' ? { focus } : null }) })
    try {
      const buttons = () => renderer!.root.findAllByType('button')
      await act(async () => { buttons().find(button => button.props['aria-label'] === t('annotationWrite'))!.props.onClick() })
      expect(focus).toHaveBeenCalled()
      expect(store.get('one').editing?.reference).toMatchObject({ repository: 'C:/repo/topic', deleted: true, code: 'removed();\r', displayedSnapshot: { side: 'old' } })
      act(() => renderer!.root.findByType('textarea').props.onChange({ target: { value: 'first note' } }))
      act(() => buttons().find(button => button.children.includes(t('annotationSave')))!.props.onClick())
      act(() => { store.begin('one', { ...store.get('one').items[0]!.reference, path: 'another.ts', absolutePath: 'C:/repo/topic/another.ts' }); store.write('one', 'second note'); store.save('one') })
      const add = () => buttons().find(button => button.findAllByType('span').some(span => span.children.includes(t('annotationAddDraft'))))!
      act(() => add().props.onClick())
      expect(store.get('one').items).toHaveLength(2)
      input.insertReference.mockImplementationOnce(() => { throw new Error('input unavailable') })
      act(() => add().props.onClick())
      expect(store.get('one').items).toHaveLength(2)
      expect(renderer!.root.findByProps({ role: 'status' }).children).toEqual([t('fileReferenceFailed')])
      input.insertReference.mockReturnValue(true)
      act(() => add().props.onClick())
      expect(store.get('one').items).toHaveLength(0)
      expect(input.insertReference).toHaveBeenCalledTimes(3)
      const sent = input.insertReference.mock.calls[2]![0] as { ref: string }
      const body = sent.ref.slice(sent.ref.indexOf('\n', 1) + 1, sent.ref.lastIndexOf('\n```'))
      expect(parseAnnotationBatch(body)?.annotations.map(item => item.note)).toEqual(['first note', 'second note'])
      expect(actions.insertText).not.toHaveBeenCalled()
    } finally { act(() => renderer!.unmount()) }
  })
  it('renders each sent note with its own source instead of hiding it inside the group', () => {
    const reference = { version: 1 as const, repository: 'C:/repo/topic', path: 'old.ts', absolutePath: 'C:/repo/topic/old.ts', deleted: false,
      view: { kind: 'commit' as const, commit: 'a'.repeat(40) }, code: 'old code', displayedSnapshot: { kind: 'selection' as const, side: 'old' as const, startLine: 5 } }
    const openReference = vi.fn(async () => true)
    let renderer: ReturnType<typeof create>
    act(() => { renderer = create(createElement(AnnotationBatchNode, { interactive: true, sessionId: 'one', openReference, t: key => en[key] ?? key,
      node: { id: 'git-workbench-annotations', start: 0, end: 0, data: { version: 1, annotations: [{ reference, note: 'first' }, { reference, note: 'second' }] } } as never })) })
    try {
      const json = JSON.stringify(renderer!.toJSON())
      expect(json).toContain('first'); expect(json).toContain('second')
      act(() => renderer!.root.findAllByType('button')[1]!.props.onClick())
      expect(openReference).toHaveBeenCalledWith('one', { reference })
    } finally { act(() => renderer!.unmount()) }
  })
})
