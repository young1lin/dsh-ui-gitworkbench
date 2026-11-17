import { Window } from 'happy-dom'
import { EditorState, Text } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { history, undo } from '@codemirror/commands'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { revealEditorReference } from '../src/client/cm-reference-reveal.ts'
import { inlineMerge } from '../src/client/inline-merge.ts'
import { virtualDeletions } from '../src/client/merge-deletions.ts'
import type { WorkbenchReference } from '../src/client/workbench-reference.ts'

let window: Window
let view: EditorView | null = null
beforeEach(() => {
  window = new Window()
  for (const key of ['window', 'document', 'MutationObserver', 'Node', 'HTMLElement', 'Range'] as const) vi.stubGlobal(key, key === 'window' ? window : window[key])
  vi.stubGlobal('getComputedStyle', window.getComputedStyle.bind(window))
})
afterEach(async () => { view?.destroy(); view = null; await window.happyDOM.close(); vi.unstubAllGlobals() })
const target: WorkbenchReference = { version: 1, repository: 'C:/repo', path: 'a.ts', absolutePath: 'C:/repo/a.ts', deleted: false, view: { kind: 'working' },
  code: 'new', displayedSnapshot: { kind: 'selection', side: 'new', startLine: 2, endLine: 2, startColumn: 1, endColumn: 4 } }

it('restores selection without changing bytes, undo history, focus or the editor instance', () => {
  const changes = vi.fn()
  view = new EditorView({ parent: window.document.body as unknown as HTMLElement,
    state: EditorState.create({ doc: 'before\nnew\nafter', extensions: [history(), EditorView.updateListener.of(update => { if (update.docChanged) changes() })] }) })
  view.dispatch({ changes: { from: view.state.doc.length, insert: ' unsaved' } })
  changes.mockClear()
  const node = view.dom, text = view.state.doc
  expect(revealEditorReference(view, target, false, new Map())).toBe(true)
  expect(view.state.doc).toBe(text)
  expect(view.dom).toBe(node)
  expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('new')
  expect(view.hasFocus).toBe(false)
  expect(changes).not.toHaveBeenCalled()
  expect(undo(view)).toBe(true)
  expect(view.state.doc.toString()).toBe('before\nnew\nafter')
  expect(revealEditorReference(view, { ...target, code: 'stale' }, false, new Map())).toBe(false)
})

it('restores old-side selections in the original deletion editor and validates both sides of hunks', () => {
  const children = new Map<EditorView, number>()
  const merge = inlineMerge({ original: () => 'before\nold\nafter', label: count => `${count} unchanged lines` })
  view = new EditorView({ parent: window.document.body as unknown as HTMLElement,
    state: EditorState.create({ doc: 'before\nnew\nafter', extensions: [merge.extension, virtualDeletions((host, text, start) => {
      const child = new EditorView({ parent: host, state: EditorState.create({ doc: Text.of(text.split('\n')), extensions: EditorState.readOnly.of(true) }) })
      children.set(child, start - 1)
      return child
    })] }) })
  const old = { ...target, code: 'old', displayedSnapshot: { ...target.displayedSnapshot!, side: 'old' as const } }
  expect(revealEditorReference(view, old, true, children)).toBe(true)
  const child = [...children.keys()][0]!
  expect(child.state.sliceDoc(child.state.selection.main.from, child.state.selection.main.to)).toBe('old')
  expect(view.state.selection.main.empty).toBe(true)
  const hunk = { ...target, code: '@@ -2,1 +2,1 @@\n-old\n+new', displayedSnapshot: { kind: 'hunk' as const, side: 'unified' as const, oldRange: [2, 1] as const, newRange: [2, 1] as const } }
  expect(revealEditorReference(view, hunk, true, children)).toBe(true)
  expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('new')
  expect(revealEditorReference(view, { ...hunk, code: '@@ -2,1 +2,1 @@\n-stale\n+new' }, true, children)).toBe(false)
})
