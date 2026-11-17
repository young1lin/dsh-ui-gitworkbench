import { act, createElement } from 'react'
import { create } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { useHistoryLayout } from '../src/client/use-history-layout.ts'
import type { HistoryLayout } from '../src/client/history-layout.ts'

afterEach(() => vi.unstubAllGlobals())

it('adapts to the retained panel width, preserves hidden tabs and disconnects on unmount', () => {
  let resize!: () => void
  const observe = vi.fn()
  const disconnect = vi.fn()
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback }
    observe = observe
    disconnect = disconnect
  })
  const element = { clientWidth: 1200 }
  const panel = { current: element as HTMLElement }
  let layout!: HistoryLayout
  function Probe({ docked, preferred }: { docked: boolean; preferred: HistoryLayout }) {
    layout = useHistoryLayout(panel, docked, preferred)
    return null
  }
  let tree!: ReturnType<typeof create>
  act(() => { tree = create(createElement(Probe, { docked: true, preferred: 'stacked' })) })
  expect(layout).toBe('columns')
  expect(observe).toHaveBeenCalledWith(element)
  element.clientWidth = 419
  act(() => resize())
  expect(layout).toBe('stacked')
  element.clientWidth = 1200
  act(() => resize())
  expect(layout).toBe('columns')
  element.clientWidth = 0
  act(() => resize())
  expect(layout).toBe('columns')
  act(() => tree.update(createElement(Probe, { docked: false, preferred: 'stacked' })))
  expect(layout).toBe('stacked')
  expect(disconnect).toHaveBeenCalledOnce()
  act(() => tree.update(createElement(Probe, { docked: false, preferred: 'columns' })))
  expect(layout).toBe('columns')
  act(() => tree.update(createElement(Probe, { docked: true, preferred: 'columns' })))
  act(() => tree.unmount())
  expect(disconnect).toHaveBeenCalledTimes(2)
})
