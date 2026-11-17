import { Window } from 'happy-dom'
import { act, createElement, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useCodeSelection } from '../src/client/use-code-selection.ts'

let window: Window
let root: Root | null = null
beforeEach(() => {
  window = new Window()
  for (const key of ['window', 'document', 'Node', 'Element', 'HTMLElement'] as const) vi.stubGlobal(key, key === 'window' ? window : window[key])
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
})
afterEach(async () => {
  await act(async () => { root?.unmount(); root = null })
  await window.happyDOM.close()
  vi.unstubAllGlobals()
})

it('quotes the live deleted row in history/compare and side panes before the mouseup render, retaining it after focus leaves', async () => {
  let capture!: ReturnType<typeof useCodeSelection>
  function Pane() {
    const host = useRef<HTMLDivElement>(null)
    capture = useCodeSelection(host, 'frozen-range', (i, side) => ({ text: i === 0 ? 'removed code' : 'current code', line: 20, side,
      oldLine: i === 0 ? 20 : 0, newLine: i === 0 ? 0 : 20, kind: i === 0 ? 'del' : 'add' }))
    return createElement('div', { ref: host }, [0, 1].map(i => createElement('div', { key: i }, createElement('span', {
      'data-quote-row': i, 'data-quote-side': 'unified',
    }, i === 0 ? 'removed code' : 'current code'))))
  }
  const parent = document.createElement('div')
  document.body.append(parent)
  root = createRoot(parent)
  await act(async () => { root!.render(createElement(Pane)) })
  const cells = parent.querySelectorAll('[data-quote-row]')
  const select = (index: number): void => {
    const range = document.createRange()
    range.selectNodeContents(cells[index]!)
    window.getSelection().removeAllRanges()
    window.getSelection().addRange(range as never)
  }
  select(1)
  await act(async () => { capture.update() })
  expect(capture.capture()!.text).toBe('current code')
  select(0)
  expect(capture.capture()).toMatchObject({ text: 'removed code', diffLines: [{ old: 20, new: 0, kind: 'del' }] })
  window.getSelection().removeAllRanges()
  expect(capture.capture()!.text).toBe('removed code')
  select(0)
  await act(async () => { capture.update() })
  window.getSelection().removeAllRanges()
  expect(capture.capture()!.text).toBe('removed code')
})
