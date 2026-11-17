import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AddExcerptButton, AddFileButton, FileActionMenuItems, FileActionsProvider, FileMenuButton, useExcerptMenu, useFileActions } from '../src/client/FileActions.tsx'
import { WorkbenchVisibility } from '../src/client/workbench-visibility.ts'
import { LeaveEditsConfirm } from '../src/client/LeaveEditsConfirm.tsx'
import { DiscardConfirm } from '../src/client/WorkbenchControls.tsx'
import { FileTree } from '../src/client/ChangesFileTree.tsx'
import { en, zh } from '../src/client/locales.ts'
import type { FileReference, ReferenceView } from '../src/reference-contract.ts'

vi.mock('../src/client/GitWorkbenchPanel.module.css', () => ({ default: {} }))

let renderer: ReactTestRenderer | null
let writeText: ReturnType<typeof vi.fn>
let firstFocus: ReturnType<typeof vi.fn>
let menuNode: { style: Record<string, string>; getBoundingClientRect: () => { width: number; height: number }; querySelector: () => { focus: () => void } }
const trigger = { isConnected: true, focus: vi.fn(), getBoundingClientRect: () => ({ left: 70, bottom: 90 }) }
const event = (extra = {}) => ({ currentTarget: trigger, preventDefault: vi.fn(), stopPropagation: vi.fn(), type: 'contextmenu', clientX: 1000, clientY: 750, ...extra })
const file = { path: 'src/文件 name.ts', status: 'modified' as const, addedLines: 1, deletedLines: 0, binary: false }
const resolved: FileReference = { repoRoot: 'C:/repo/selected tree', path: file.path, absolutePath: `C:/repo/selected tree/${file.path}`,
  kind: 'file', deleted: false, revision: null, revisionPath: file.path, blob: null, change: null }
beforeEach(() => {
  renderer = null
  writeText = vi.fn(async () => {})
  firstFocus = vi.fn()
  menuNode = { style: {}, getBoundingClientRect: () => ({ width: 250, height: 160 }), querySelector: () => ({ focus: firstFocus }) }
  vi.stubGlobal('navigator', { clipboard: { writeText } })
  vi.stubGlobal('window', { innerWidth: 1024, innerHeight: 768, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn(), activeElement: null })
  vi.stubGlobal('Node', class {})
})
afterEach(() => {
  if (renderer) act(() => renderer!.unmount())
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function mount(options: { locale?: 'en' | 'zh'; view?: ReferenceView | null; deferGuard?: boolean; tree?: boolean; snippet?: boolean; codeMenu?: boolean; active?: boolean; toolbar?: boolean } = {}) {
  const dictionary = options.locale === 'zh' ? zh : en
  const t = (key: string, args: Record<string, string | number> = {}) => (dictionary[key] ?? key).replace(/\{(\w+)\}/g, (_, key) => String(args[key]))
  const input = { insertReference: vi.fn(() => true), focus: vi.fn() }
  const actions = { captureInsertion: vi.fn(() => ({ start: 2, end: 5, draftRev: 7 })), insertText: vi.fn(() => true), setDraft: vi.fn(), submit: vi.fn() }
  const bridge = { getInput: () => input, resolve: vi.fn(async () => resolved) }
  const onAdded = vi.fn()
  const onSelect = vi.fn()
  const onCheck = vi.fn()
  let confirm: (() => void) | undefined
  let renders = 0
  function Row() {
    renders++
    const bind = useFileActions()
    const quoteMenu = useExcerptMenu()
    return createElement('button', { 'data-probe': true, ...bind(file), ...options.codeMenu ? {
      onContextMenu: event => quoteMenu(file, { kind: 'selection', side: 'old', text: 'frozen code', startLine: 12, endLine: 12 }, event),
    } : {} }, 'file')
  }
  act(() => {
    renderer = create(createElement(FileActionsProvider, {
      t, sessionId: 'target-session', worktreePath: 'C:/repo/selected tree/subdirectory', repoRoot: resolved.repoRoot,
      view: options.view === undefined ? { kind: 'working' } : options.view,
      bridge, draftActions: actions, onAdded, active: options.active, excerptFile: options.snippet ? { ...file, status: 'deleted', previousPath: 'src/old.ts' } : null,
      beforeAdd: action => { if (options.deferGuard) confirm = action; else action() },
      children: options.tree
        ? createElement(FileTree, { t, files: [file], active: file.path, onSelect, onCheck, collapsed: new Set(), onCollapsedChange: vi.fn(), scopeKey: 'test' })
        : [createElement(Row, { key: 'row' }), ...(options.toolbar ? [createElement(FileActionMenuItems, { key: 'toolbar', file })] : []), ...(options.snippet ? [createElement(AddExcerptButton, { key: 'snippet', file: { path: file.path }, kind: 'selection',
          capture: () => ({ kind: 'selection', side: 'old', text: 'deleted code', startLine: 12, endLine: 12 }) })] : []), createElement(AddFileButton, { key: 'add', file }), createElement(FileMenuButton, { key: 'menu', file })],
    }), { createNodeMock: element => element.props.role === 'menu' ? menuNode : null })
  })
  const root = () => renderer!.root
  const row = () => options.tree ? root().findByProps({ title: file.path }) : root().findByProps({ 'data-probe': true })
  const open = () => act(() => row().props.onContextMenu(event()))
  const items = () => root().findAllByProps({ role: 'menuitem' })
  const add = () => root().findByType(AddFileButton).findByType('button')
  return { root, row, open, items, add, bridge, actions, input, onAdded, onSelect, onCheck, confirm: () => confirm?.(), renders: () => renders, t }
}

describe('file actions interaction', () => {
  it.each([false, true])('resolves abbreviated historical code quotes through %s context menus', async codeMenu => {
    const view = { kind: 'commit' as const, commit: 'a'.repeat(7) }
    const ui = mount({ snippet: true, codeMenu, view })
    ui.bridge.resolve.mockResolvedValue({ ...resolved, kind: 'git', deleted: true,
      revision: 'b'.repeat(40), change: 'a'.repeat(40), previousPath: 'src/old.ts' })
    if (codeMenu) ui.open()
    await act(async () => {
      if (codeMenu) ui.items()[0]!.props.onClick()
      else ui.root().findByType(AddExcerptButton).findByType('button').props.onClick()
    })
    expect(ui.bridge.resolve).toHaveBeenCalledWith('C:/repo/selected tree/subdirectory', expect.objectContaining({
      view, deleted: true, previousPath: 'src/old.ts', path: file.path,
    }), expect.any(AbortSignal))
    const [reference, span] = ui.input.insertReference.mock.calls[0]!
    expect(reference.ref).toContain('"commit": "' + 'a'.repeat(40))
    expect(reference.ref).toContain(codeMenu ? 'frozen code' : 'deleted code')
    expect(reference.ref).toContain('"previousPath": "src/old.ts"')
    expect(span).toEqual({ start: 5, end: 5, draftRev: 7 })
    expect(ui.actions.captureInsertion).toHaveBeenCalledOnce()
    expect(ui.actions.setDraft).not.toHaveBeenCalled()
    expect(ui.actions.submit).not.toHaveBeenCalled()
  })
  it.each(['en', 'zh'] as const)('copies paths from the viewed worktree through the editor menu in %s', async locale => {
    const ui = mount({ locale, toolbar: true, view: { kind: 'commit', commit: 'a'.repeat(40) } })
    const menu = ui.root().findByType(FileActionMenuItems)
    for (const [key, value] of [
      ['fileCopyName', '文件 name.ts'],
      ['fileCopyRelative', file.path],
      ['fileCopyAbsolute', resolved.absolutePath],
    ]) {
      const button = menu.findAllByType('button').find(button => button.props['aria-label'] === ui.t(key))!
      await act(async () => button.props.onClick())
      expect(writeText).toHaveBeenLastCalledWith(value)
    }
    expect(ui.bridge.resolve).not.toHaveBeenCalled()
    expect(ui.input.insertReference).not.toHaveBeenCalled()
    expect(ui.actions.setDraft).not.toHaveBeenCalled()
    expect(ui.actions.submit).not.toHaveBeenCalled()
  })
  it('adds a historical file through the editor menu with the existing draft admission guard', async () => {
    const view = { kind: 'commit' as const, commit: 'a'.repeat(40) }
    const ui = mount({ toolbar: true, view, deferGuard: true })
    ui.actions.captureInsertion.mockReturnValue({ start: 30, end: 40, draftRev: 19 })
    const button = ui.root().findByType(FileActionMenuItems).findByType(AddFileButton).findByType('button')
    await act(async () => button.props.onClick())
    expect(ui.bridge.resolve).toHaveBeenCalledWith('C:/repo/selected tree/subdirectory', expect.objectContaining({ view }), expect.any(AbortSignal))
    expect(ui.input.insertReference).not.toHaveBeenCalled()
    act(() => ui.confirm())
    expect(ui.input.insertReference).toHaveBeenCalledWith(expect.anything(), { start: 40, end: 40, draftRev: 19 })
    expect(ui.actions.setDraft).not.toHaveBeenCalled()
    expect(ui.actions.submit).not.toHaveBeenCalled()
  })
  it('retains deleted and renamed history metadata for the editor menu file reference', async () => {
    const view = { kind: 'compare' as const, base: 'a'.repeat(40), head: 'b'.repeat(40) }
    const ui = mount({ toolbar: true, snippet: true, view })
    const button = ui.root().findByType(FileActionMenuItems).findByType(AddFileButton).findByType('button')
    await act(async () => button.props.onClick())
    expect(ui.bridge.resolve).toHaveBeenCalledWith('C:/repo/selected tree/subdirectory', expect.objectContaining({
      repoRoot: resolved.repoRoot, path: file.path, deleted: true, previousPath: 'src/old.ts', view,
    }), expect.any(AbortSignal))
    expect(ui.actions.submit).not.toHaveBeenCalled()
  })

  it.each(['en', 'zh'] as const)('freezes the right-click snapshot but appends to the latest draft in %s', locale => {
    const ui = mount({ locale, snippet: true, codeMenu: true, view: { kind: 'commit', commit: 'a'.repeat(40) } })
    ui.open()
    expect(ui.items()[0]!.findByType('span').children).toEqual([ui.t('codeAddSelection')])
    const props = ui.root().findByType(FileActionsProvider).props
    act(() => renderer!.update(createElement(FileActionsProvider, { ...props, repoRoot: 'C:/other/worktree', view: { kind: 'commit', commit: 'b'.repeat(40) } })))
    ui.actions.captureInsertion.mockReturnValue({ start: 30, end: 40, draftRev: 19 })
    act(() => ui.items()[0]!.props.onClick())
    const [reference, span] = ui.input.insertReference.mock.calls[0]!
    const text = reference.clipboardText
    expect(text).toContain('"commit": "' + 'a'.repeat(40))
    expect(text).toContain('C:/repo/selected tree')
    expect(text).not.toContain('C:/other/worktree')
    expect(text).toContain('frozen code')
    expect(text).toContain('"deleted": true')
    expect(span).toEqual({ start: 40, end: 40, draftRev: 19 })
    expect(ui.actions.setDraft).not.toHaveBeenCalled()
    expect(ui.actions.submit).not.toHaveBeenCalled()
  })
  it.each(['en', 'zh'] as const)('inserts the selected historical deletion into the original draft in %s', locale => {
    const ui = mount({ locale, snippet: true, view: { kind: 'commit', commit: 'b'.repeat(40) } })
    const quote = ui.root().findByType(AddExcerptButton).findByType('button')
    expect(quote.props['aria-label']).toBe(ui.t('codeAddSelection'))
    act(() => quote.props.onClick())
    const [reference, span] = ui.input.insertReference.mock.calls[0]!
    const text = reference.clipboardText
    expect(text).toContain('"previousPath": "src/old.ts"')
    expect(text).toContain('"deleted": true')
    expect(text).toContain('"commit": "' + 'b'.repeat(40))
    expect(text).toContain('"side": "old"')
    expect(text).toContain('deleted code')
    expect(span).toEqual({ start: 5, end: 5, draftRev: 7 })
    expect(ui.actions.setDraft).not.toHaveBeenCalled()
    expect(ui.actions.submit).not.toHaveBeenCalled()
    expect(ui.bridge.resolve).not.toHaveBeenCalled()
    expect(ui.onAdded).not.toHaveBeenCalled()
  })
  it.each([LeaveEditsConfirm, DiscardConfirm])('suspends hidden confirmation dialogs and their Escape listener', Component => {
    const props = { t: (key: string) => key, path: 'a.ts', body: 'discard?', onCancel: vi.fn(), onConfirm: vi.fn() }
    const node = (visible: boolean) => createElement(WorkbenchVisibility.Provider, { value: visible }, createElement(Component as any, props))
    act(() => { renderer = create(node(true)) })
    expect(vi.mocked(window.addEventListener)).toHaveBeenCalledWith('keydown', expect.any(Function), true)
    const handler = vi.mocked(window.addEventListener).mock.calls[0]![1]
    act(() => renderer!.update(node(false)))
    expect(renderer!.toJSON()).toBeNull()
    expect(window.removeEventListener).toHaveBeenCalledWith('keydown', handler, true)
  })
  it('disables quoting for a retained but hidden dock', () => {
    const ui = mount({ snippet: true, active: false })
    expect(ui.root().findByType(AddExcerptButton).findByType('button').props.disabled).toBe(true)
  })
  it.each(['en', 'zh'] as const)('names the compact icon and explains it in %s', locale => {
    const ui = mount({ locale })
    expect(ui.add().props['aria-label']).toBe(ui.t('fileAddToChat'))
    expect(ui.add().findByType('svg').props['aria-hidden']).toBe('true')
    const description = ui.root().findByProps({ id: ui.add().props['aria-describedby'] })
    expect(description.children).toEqual([ui.t('fileAddHint')])
    const tooltip = ui.root().findByProps({ role: 'tooltip' })
    expect(tooltip.findAllByType('span').at(-1)!.children).toEqual([ui.t('fileAddToChat')])
    expect(tooltip.findAllByType('button')).toHaveLength(0)
  })
  it('dismisses the focused hint with Escape without consuming subsequent Escape events', () => {
    const ui = mount()
    const escape = event({ key: 'Escape', type: 'keydown' })
    act(() => ui.add().props.onKeyDown(escape))
    expect(ui.root().findByProps({ role: 'tooltip' }).props.hidden).toBe(true)
    expect(escape.stopPropagation).toHaveBeenCalledOnce()
    const next = event({ key: 'Escape', type: 'keydown' })
    act(() => ui.add().props.onKeyDown(next))
    expect(next.stopPropagation).not.toHaveBeenCalled()
    act(() => ui.add().props.onBlur())
    expect(ui.root().findByProps({ role: 'tooltip' }).props.hidden).toBe(false)
  })
  it.each(['en', 'zh'] as const)('shows all four localized actions in %s', locale => {
    const ui = mount({ locale })
    ui.open()
    expect(ui.items().map(item => item.findByType('span').children.join(''))).toEqual(['fileAddToChat', 'fileCopyName', 'fileCopyRelative', 'fileCopyAbsolute'].map(ui.t))
    for (const item of ui.items()) expect(item.findByType('svg').props['aria-hidden']).toBe('true')
    expect(menuNode.style).toEqual({ left: '766px', top: '600px' })
    expect(firstFocus).toHaveBeenCalled()
    expect(ui.renders()).toBe(1)
  })
  it.each([
    [1, '文件 name.ts'], [2, file.path], [3, resolved.absolutePath],
  ])('copies action %s from the displayed worktree', async (at, expected) => {
    const ui = mount()
    ui.open()
    await act(async () => { ui.items()[at as number]!.props.onClick() })
    expect(writeText).toHaveBeenCalledWith(expected)
    expect(ui.items()).toHaveLength(0)
    expect(ui.root().findByProps({ role: 'status' }).children).toEqual(['Copied'])
    expect(ui.bridge.resolve).not.toHaveBeenCalled()
    expect(ui.actions.setDraft).not.toHaveBeenCalled()
    expect(ui.actions.submit).not.toHaveBeenCalled()
    expect(ui.renders()).toBe(1)
  })
  it('clears successful copy feedback after a short delay and releases its timer on close', async () => {
    vi.useFakeTimers()
    const ui = mount()
    ui.open()
    await act(async () => ui.items()[1]!.props.onClick())
    act(() => vi.advanceTimersByTime(1799))
    expect(ui.root().findAllByProps({ role: 'status' })).toHaveLength(1)
    act(() => vi.advanceTimersByTime(1))
    expect(ui.root().findAllByProps({ role: 'status' })).toHaveLength(0)
    ui.open()
    await act(async () => ui.items()[1]!.props.onClick())
    expect(vi.getTimerCount()).toBe(1)
    act(() => renderer!.unmount())
    renderer = null
    expect(vi.getTimerCount()).toBe(0)
  })
  it('keeps copy failures visible when a prior success message expires', async () => {
    vi.useFakeTimers()
    const ui = mount()
    ui.open()
    await act(async () => ui.items()[1]!.props.onClick())
    ui.open()
    writeText.mockRejectedValueOnce(new Error('clipboard blocked'))
    await act(async () => ui.items()[1]!.props.onClick())
    act(() => vi.advanceTimersByTime(2000))
    expect(ui.root().findByProps({ role: 'status' }).children).toEqual([en.fileCopyFailed])
    expect(vi.getTimerCount()).toBe(0)
  })
  it('opens a real changes row menu without selecting or staging the file', () => {
    const ui = mount({ tree: true })
    ui.open()
    expect(ui.items()).toHaveLength(4)
    expect(ui.onSelect).not.toHaveBeenCalled()
    expect(ui.onCheck).not.toHaveBeenCalled()
  })
  it('does not invalidate file rows when the framework rebinds the same dictionary', () => {
    const ui = mount()
    const props = ui.root().findByType(FileActionsProvider).props
    act(() => renderer!.update(createElement(FileActionsProvider, { ...props, t: (...args) => props.t(...args) })))
    expect(ui.renders()).toBe(1)
  })
  it('supports the menu key and Escape, restoring focus to the triggering row', () => {
    const ui = mount()
    act(() => ui.row().props.onKeyDown(event({ key: 'F10', shiftKey: true, type: 'keydown' })))
    expect(ui.items()).toHaveLength(4)
    act(() => ui.root().findByProps({ role: 'menu' }).props.onKeyDown(event({ key: 'Escape' })))
    expect(ui.items()).toHaveLength(0)
    expect(trigger.focus).toHaveBeenCalled()
  })
  it('waits for the unsaved-editor guard before inserting, then returns without sending', async () => {
    const ui = mount({ deferGuard: true })
    await act(async () => ui.add().props.onClick())
    expect(ui.input.insertReference).not.toHaveBeenCalled()
    expect(ui.onAdded).not.toHaveBeenCalled()
    await act(async () => ui.confirm())
    expect(ui.bridge.resolve).toHaveBeenCalledWith('C:/repo/selected tree/subdirectory', expect.objectContaining({ path: file.path, view: { kind: 'working' } }), expect.any(AbortSignal))
    expect(ui.input.insertReference).toHaveBeenCalledWith(expect.objectContaining({ source: 'git-workbench', ref: expect.stringContaining('C:/repo/selected tree/src/文件 name.ts') }), { start: 5, end: 5, draftRev: 7 })
    expect(ui.onAdded).toHaveBeenCalledOnce()
    expect(ui.input.focus).toHaveBeenCalledOnce()
    expect(ui.actions.setDraft).not.toHaveBeenCalled()
    expect(ui.actions.submit).not.toHaveBeenCalled()
  })
  it('keeps the drawer and draft when insertion is refused', async () => {
    const ui = mount()
    ui.input.insertReference.mockReturnValue(false)
    await act(async () => ui.add().props.onClick())
    expect(ui.onAdded).not.toHaveBeenCalled()
    expect(ui.root().findByProps({ role: 'status' }).children).toEqual([en.fileReferenceChanged])
    expect(ui.actions.setDraft).not.toHaveBeenCalled()
  })
  it('disables insertion until the selected Git version is known', () => {
    const ui = mount({ view: null })
    expect(ui.add().props.disabled).toBe(true)
    ui.open()
    expect(ui.items()[0]!.props.disabled).toBe(true)
    expect(ui.items().slice(1).every(item => !item.props.disabled)).toBe(true)
  })
  it('aborts an unresolved reference when the drawer is disposed', async () => {
    const ui = mount()
    let release!: (file: FileReference) => void
    ui.bridge.resolve.mockImplementation(() => new Promise(resolve => { release = resolve }))
    act(() => ui.add().props.onClick())
    const signal = ui.bridge.resolve.mock.calls[0]![2] as AbortSignal
    act(() => renderer!.unmount())
    renderer = null
    expect(signal.aborted).toBe(true)
    await act(async () => release(resolved))
    expect(ui.input.insertReference).not.toHaveBeenCalled()
    expect(ui.onAdded).not.toHaveBeenCalled()
  })
  it('inserts the historical object as a workbench reference after the guard', async () => {
    const ui = mount({ view: { kind: 'commit', commit: 'a'.repeat(40) } })
    ui.bridge.resolve.mockResolvedValue({ ...resolved, kind: 'git', deleted: true, revision: 'b'.repeat(40), blob: 'c'.repeat(40), change: 'a'.repeat(40) })
    await act(async () => ui.add().props.onClick())
    expect(ui.input.insertReference).toHaveBeenCalledWith(expect.objectContaining({ source: 'git-workbench', ref: expect.stringContaining('"blob": "' + 'c'.repeat(40) + '"') }), { start: 5, end: 5, draftRev: 7 })
    expect(ui.actions.insertText).not.toHaveBeenCalled()
    expect(ui.onAdded).toHaveBeenCalledOnce()
    expect(ui.actions.submit).not.toHaveBeenCalled()
  })
  it('releases all listeners when the drawer closes', () => {
    const ui = mount()
    ui.open()
    const added = [...vi.mocked(document.addEventListener).mock.calls, ...vi.mocked(window.addEventListener).mock.calls]
    act(() => renderer!.unmount())
    renderer = null
    const removed = [...vi.mocked(document.removeEventListener).mock.calls, ...vi.mocked(window.removeEventListener).mock.calls]
    expect(removed).toEqual(added)
  })
})
