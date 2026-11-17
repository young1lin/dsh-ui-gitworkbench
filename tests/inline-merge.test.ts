import { EditorState, Text } from '@codemirror/state'
import { getChunks, getOriginalDoc } from '@codemirror/merge'
import { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { inlineMerge } from '../src/client/inline-merge.ts'
import { mergeDiff } from '../src/client/merge-line-endings.ts'

function create(original: string, next: string) {
  let basis = original
  const merge = inlineMerge({ original: () => basis, label: n => `${n} unchanged lines` })
  let state = EditorState.create({ doc: Text.of(next.split('\n')), extensions: merge.extension })
  const view = { get state() { return state }, dispatch: (spec: Parameters<EditorState['update']>[0]) => { state = state.update(spec).state } } as EditorView
  return { view, basis: (text: string) => { basis = text; merge.collapse(view) } }
}

describe('official CodeMirror merge integration', () => {
  it('leaves eight unchanged lines visible before and after a change while folding distant code', () => {
    const lines = Array.from({ length: 60 }, (_, i) => `const item${i + 1} = ${i + 1}`)
    const next = [...lines]; next[25] = 'const changed = true'
    const { view } = create(lines.join('\n'), next.join('\n'))
    const folds: [number, number][] = []
    for (const decorations of view.state.facet(EditorView.decorations)) {
      if (typeof decorations === 'function') continue
      decorations.between(0, view.state.doc.length, (from, to, decoration) => {
        if (from < to && decoration.spec.widget) folds.push([from, to])
      })
    }
    expect(folds).toHaveLength(2)
    for (let line = 18; line <= 34; line++) {
      const from = view.state.doc.line(line).from
      expect(folds.some(([start, end]) => start <= from && from < end), `line ${line} is context`).toBe(false)
    }
  })
  it('keeps CRLF documents intact and reports just the changed Java lines', () => {
    const lines = Array.from({ length: 500 }, (_, i) => `    public String value${i} = "${i}";`)
    const next = [...lines]; next[66] = '    public String changed = "new";'
    const { view } = create(lines.join('\n'), next.join('\r\n'))
    const chunks = getChunks(view.state)!.chunks
    expect(chunks).toHaveLength(1)
    expect(view.state.doc.lineAt(chunks[0]!.fromB).number).toBe(67)
    expect(view.state.doc.lineAt(chunks[0]!.endB).number).toBe(67)
    expect(view.state.doc.line(1).text.endsWith('\r')).toBe(true)
    expect(getOriginalDoc(view.state).line(1).text.endsWith('\r')).toBe(false)
  })
  it('updates the original through the library effect without replacing the buffer or its selection', () => {
    const { view, basis } = create('one\nold\nthree', 'one\nnew\nthree')
    view.dispatch({ selection: { anchor: 4, head: 7 } })
    const doc = view.state.doc
    basis('one\nnew\nthree')
    expect(getChunks(view.state)!.chunks).toHaveLength(0)
    expect(view.state.doc).toBe(doc)
    expect(view.state.selection.main).toMatchObject({ from: 4, to: 7 })
  })
  it('recomputes chunks incrementally after an edit', () => {
    const { view } = create('one\nold\nthree', 'one\nnew\nthree')
    view.dispatch({ changes: { from: 4, to: 7, insert: 'old' } })
    expect(getChunks(view.state)!.chunks).toHaveLength(0)
  })
  it('ignores only CRLF differences and maps changed spans to original character offsets', () => {
    expect(mergeDiff('a\nb\nc', 'a\r\nb\r\nc')).toEqual([])
    const before = 'a\r\nold\r\nc', after = 'a\nnew\nc'
    const [change] = mergeDiff(before, after)
    expect(before.slice(change!.fromA, change!.toA)).toBe('old')
    expect(after.slice(change!.fromB, change!.toB)).toBe('new')
    expect(mergeDiff('a\rb', 'ab')).toHaveLength(1)
  })
})
