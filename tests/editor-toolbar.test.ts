import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DockFileNavigation } from '../src/client/DockNavigation.tsx'
import { ChangeNavigation } from '../src/client/EditorToolbar.tsx'
import { en, zh } from '../src/client/locales.ts'
import type { Translate } from '../src/client/git-workbench-types.ts'

vi.mock('../src/client/GitWorkbenchPanel.module.css', () => ({ default: {} }))
let renderer: ReactTestRenderer | null = null
afterEach(() => { if (renderer) act(() => renderer!.unmount()); renderer = null })

describe('compact editor controls', () => {
  it.each([en, zh])('keeps the full file and immutable version discoverable', dictionary => {
    const t: Translate = (key, args = {}) => dictionary[key].replace(/\{(\w+)\}/g, (_, key) => String(args[key]))
    const onList = vi.fn()
    const file = { path: 'src/很长的目录/renamed.ts', previousPath: 'old.ts', status: 'deleted' }
    const commit = 'abcdef01'.repeat(5)
    act(() => { renderer = create(createElement(DockFileNavigation, { t, file, version: { kind: 'commit', commit }, onList })) })
    const picker = renderer!.root.findByType('button')
    expect(picker.props.title).toBe(file.path)
    expect(picker.props['aria-label']).toBe(t('dockBackFiles'))
    expect(renderer!.root.findByType('code').props.title).toBe(commit)
    expect(renderer!.root.findByType('code').children).toEqual(['abcdef01'])
    act(() => picker.props.onClick())
    expect(onList).toHaveBeenCalledOnce()
    const head = '12345678'.repeat(5)
    act(() => renderer!.update(createElement(DockFileNavigation, { t, file, version: { kind: 'compare', base: commit, head }, onList })))
    expect(renderer!.root.findByType('code').props.title).toBe(`${commit} → ${head}`)
    expect(renderer!.root.findByType('code').children).toEqual(['abcdef01 → 12345678'])
  })
  it('walks hunks through the existing callback, with a count that explains the position', () => {
    const onWalk = vi.fn()
    const t: Translate = (key, args = {}) => en[key].replace(/\{(\w+)\}/g, (_, key) => String(args[key]))
    act(() => { renderer = create(createElement(ChangeNavigation, { t, current: 1, total: 3, onWalk })) })
    const buttons = renderer!.root.findAllByType('button')
    act(() => buttons[0]!.props.onClick())
    act(() => buttons[1]!.props.onClick())
    expect(onWalk.mock.calls).toEqual([[-1], [1]])
    expect(renderer!.root.findByProps({ 'aria-label': t('changePosition', { current: 2, total: 3 }) }).children).toEqual(['2/3'])
    act(() => renderer!.update(createElement(ChangeNavigation, { t, current: null, total: 0, onWalk })))
    expect(renderer!.toJSON()).toBeNull()
  })
})
