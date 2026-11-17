import { Window } from 'happy-dom'
import { Compartment, EditorState, Text } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { inlineMerge } from '../src/client/inline-merge.ts'
import { virtualDeletions } from '../src/client/merge-deletions.ts'

let window: Window
let view: EditorView | null = null
beforeEach(() => {
  window = new Window()
  for (const key of ['window', 'document', 'MutationObserver', 'Node', 'HTMLElement', 'Range'] as const) {
    vi.stubGlobal(key, key === 'window' ? window : window[key])
  }
  vi.stubGlobal('getComputedStyle', window.getComputedStyle.bind(window))
})
afterEach(async () => { view?.destroy(); view = null; await window.happyDOM.close(); vi.unstubAllGlobals() })

it('renders a large deletion through a bounded editor and destroys it when the merge view is removed', () => {
  const original = Array.from({ length: 10_000 }, (_, i) => `deleted line ${i}`).join('\n')
  const merge = inlineMerge({ original: () => original, label: count => `${count} unchanged lines` })
  const destroy = vi.fn()
  const mount = vi.fn((host: HTMLElement, text: string, line: number, _at: number, basis: string) => {
    expect(text).toBe(original)
    expect(basis).toBe(original)
    expect(line).toBe(1)
    host.style.height = '248px'
    const child = new EditorView({ parent: host, state: EditorState.create({ doc: Text.of(text.split('\n')),
      extensions: [EditorState.readOnly.of(true), EditorView.editable.of(false),
        EditorView.theme({ '&': { height: '248px' }, '.cm-scroller': { overflow: 'auto' } })] }) })
    const release = child.destroy.bind(child)
    child.destroy = () => { destroy(); release() }
    return child
  })
  const mode = new Compartment()
  view = new EditorView({ parent: window.document.body as unknown as HTMLElement,
    state: EditorState.create({ doc: 'replacement', extensions: mode.of([merge.extension, virtualDeletions(mount)]) }) })
  expect(mount).toHaveBeenCalledOnce()
  const deletion = view.dom.querySelector('.cm-gwRemoved')!
  expect(deletion.textContent).toContain('deleted line 0')
  expect(deletion.querySelectorAll('.cm-line').length).toBeLessThan(200)
  view.dispatch({ effects: mode.reconfigure([]) })
  expect(destroy).toHaveBeenCalledOnce()
  expect(view.dom.querySelector('.cm-gwRemoved')).toBeNull()
})
