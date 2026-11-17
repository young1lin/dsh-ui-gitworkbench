import { Window } from 'happy-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { codePoint, codeSelection } from '../src/client/code-selection-dom.ts'
import { selectedExcerpt } from '../src/client/code-excerpt.ts'

let window: Window
beforeEach(() => { window = new Window(); vi.stubGlobal('Element', window.Element) })
afterEach(async () => { vi.unstubAllGlobals(); await window.happyDOM.close() })
describe('source offsets in rendered diff selections', () => {
  it('captures a whole deleted line when triple-click ends at the next row boundary', () => {
    const root = window.document.createElement('div')
    root.innerHTML = '<div><span class="gutter">−</span><span data-quote-row="0" data-quote-side="unified"><b>removed</b> code</span></div><div><span class="gutter">+</span><span data-quote-row="1" data-quote-side="unified">current code</span></div>'
    const native = window.document.createRange()
    native.setStart(root.firstChild!, 0)
    native.setEnd(root.lastChild!, 0)
    const selection = { isCollapsed: false, rangeCount: 1, getRangeAt: () => native } as unknown as Selection
    const range = codeSelection(root as never, selection)!
    expect(selectedExcerpt(i => ({ text: i === 0 ? 'removed code' : 'current code', line: 10, side: 'unified', oldLine: i === 0 ? 10 : 0, newLine: i === 0 ? 0 : 10, kind: i === 0 ? 'del' : 'add' }), range.from, range.to))
      .toMatchObject({ text: 'removed code', diffLines: [{ old: 10, new: 0, kind: 'del' }] })
  })
  it('maps nested tokens and hidden CR marks back to original characters', () => {
    const root = window.document.createElement('div')
    root.innerHTML = '<span class="gutter">44</span><span data-quote-row="3" data-quote-side="old"><span>a</span><span aria-hidden="true" data-quote-chars="1">↵</span><span><i>b</i></span></span>'
    const selected = root.querySelector('i')!.firstChild!
    const start = codePoint(root as never, selected as never, 0)!
    const end = codePoint(root as never, selected as never, 1)!
    expect(start).toEqual({ row: 3, side: 'old', column: 2 })
    expect(selectedExcerpt(() => ({ text: 'a\rb', line: 44, side: 'old' }), start, end)).toMatchObject({ text: 'b', startLine: 44, startColumn: 3, endColumn: 4 })
    expect(codePoint(root as never, root.firstChild!.firstChild as never, 1)).toBeNull()
    const detached = window.document.createTextNode('outside')
    expect(codePoint(root as never, detached as never, 0)).toBeNull()
  })
  it('retains column offsets on element boundaries without copying hidden decorations', () => {
    const root = window.document.createElement('div')
    root.innerHTML = '<span data-quote-row="0" data-quote-side="new"><b>abc</b><em>def</em></span>'
    const code = root.firstChild!
    expect(codePoint(root as never, code as never, 1)).toEqual({ row: 0, side: 'new', column: 3 })
    expect(codePoint(root as never, code as never, 2)).toEqual({ row: 0, side: 'new', column: 6 })
  })
})
