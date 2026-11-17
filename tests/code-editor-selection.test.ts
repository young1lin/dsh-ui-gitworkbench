import { Window } from 'happy-dom'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CodeEditor } from '../src/client/CodeEditor.tsx'
import type { EditorSelection } from '../src/client/editor-quote.ts'

vi.mock('../src/client/GitWorkbenchPanel.module.css', () => ({ default: {} }))

let window: Window
let root: Root | null = null
beforeEach(() => {
  window = new Window()
  for (const key of ['window', 'document', 'MutationObserver', 'Node', 'HTMLElement', 'Range', 'MouseEvent'] as const) {
    vi.stubGlobal(key, key === 'window' ? window : window[key])
  }
  vi.stubGlobal('getComputedStyle', window.getComputedStyle.bind(window))
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
})
afterEach(async () => {
  await act(async () => { root?.unmount(); root = null })
  await window.happyDOM.close()
  vi.unstubAllGlobals()
})

it.each(['unstaged', 'staged'] as const)('captures the displayed %s deletion before a native selection notification, without reusing current-code coordinates', async layer => {
  const parent = document.createElement('div')
  document.body.append(parent)
  let selection: EditorSelection | null = null
  root = createRoot(parent)
  await act(async () => { root!.render(createElement(CodeEditor, {
    value: 'before\ncurrent code\nafter', original: 'before\nremoved code\nafter',
    paint: null, indent: '  ', ariaLabel: 'a.ts', onChange: vi.fn(), onSave: vi.fn(), autoFocus: false,
    inlineDiff: true, readOnly: layer === 'staged', reference: { file: { path: 'a.ts' }, source: { layer, diffSha: 'frozen' } },
    onSelectionChange: value => { selection = value },
  })) })
  const main = EditorView.findFromDOM(parent.querySelector('.cm-editor')!)!
  await act(async () => { main.dispatch({ selection: { anchor: 7, head: 19 } }) })
  expect(selection!.capture()).toMatchObject({ text: 'current code', side: 'new' })
  const old = EditorView.findFromDOM(parent.querySelector('.cm-gwRemoved .cm-editor')!)!
  expect(old.state.selection.main.empty).toBe(true)
  const start = old.domAtPos(0), end = old.domAtPos(old.state.doc.length)
  window.getSelection().removeAllRanges()
  window.getSelection().setBaseAndExtent(start.node as never, start.offset, end.node as never, end.offset)
  expect(window.getSelection().toString()).toBe('removed code')
  // The Add gesture can run before CodeMirror receives selectionchange.
  expect(selection!.capture()).toMatchObject({ text: 'removed code', side: 'old', startLine: 2, layer, diffSha: 'frozen' })
  window.getSelection().removeAllRanges()
  expect(selection!.capture()).toMatchObject({ text: 'removed code', side: 'old' })
  // A selection crossing old and new editors must never fall back to new code.
  const newEnd = main.domAtPos(19)
  const mixed = document.createRange()
  mixed.setStart(start.node, start.offset)
  mixed.setEnd(newEnd.node, newEnd.offset)
  window.getSelection().removeAllRanges()
  window.getSelection().addRange(mixed as never)
  expect(selection!.capture()).toBeNull()
})
