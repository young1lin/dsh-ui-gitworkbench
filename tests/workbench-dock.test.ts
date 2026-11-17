import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { WorkbenchCloseGuards } from '../src/client/workbench-dock.ts'
import { ReferenceNavigation } from '../src/client/reference-navigation.ts'
import { en, zh } from '../src/client/locales.ts'

vi.mock('../src/client/GitWorkbenchPanel.tsx', () => ({ GitWorkbenchPanel: props => createElement('panel-probe', props) }))
import { apply } from '../src/client/index.ts'
import { DockedWorkbench, WORKBENCH_TAB } from '../src/client/DockedWorkbench.tsx'

function harness(available = true, text = false, native = false) {
  const slots: { registration: any; component: any }[] = []
  const disposers: (() => void)[] = []
  let language: 'zh' | 'en' = 'zh'
  let foreground = 'session-a'
  let definition: any
  let close: ((sessionId: string, tab: { id: string }) => void) | undefined
  const sidebar = {
    mounted: { getSnapshot: () => foreground }, openTab: vi.fn(), closeIn: vi.fn(),
    focus: vi.fn(), isExpanded: () => false, toggleExpanded: vi.fn(),
    registerCloseHandler: (_kind: string, callback: typeof close) => { close = callback; return () => { close = undefined } },
  }
  const ctx = {
    connection: { rpc: { call: vi.fn() } },
    uiConversation: text ? { userText: { register: vi.fn(() => () => {}) } } : undefined,
    inputTriggers: text ? { registerSource: vi.fn(() => () => {}) } : undefined,
    contextMenus: native ? { register: vi.fn(() => () => {}) } : undefined,
    locale: { register: () => () => {}, bind: () => (key: string) => (language === 'zh' ? zh : en)[key] },
    sessions: { scope: vi.fn() }, conversation: { input: { for: vi.fn() } },
    effect: (run: () => (() => void) | void) => { const dispose = run(); if (dispose) disposers.push(dispose); return dispose },
    inject: (_services: string[], callback: (context: unknown) => void) => { if (available) callback(ctx) },
    sidebarRight: sidebar,
    sidebarRightTabs: { register: (value: unknown) => { definition = value; return () => { definition = undefined } } },
    slots: {
      inject: (_name: string, run: () => void) => run(),
      register: (registration: unknown, component: unknown) => {
        const value = { registration, component }; slots.push(value)
        disposers.push(() => { const at = slots.indexOf(value); if (at >= 0) slots.splice(at, 1) })
        return () => {}
      },
    },
  }
  apply(ctx as never)
  return { slots, sidebar, ctx, definition: () => definition, close: (...args: Parameters<NonNullable<typeof close>>) => close?.(...args),
    language: (value: typeof language) => { language = value }, foreground: (value: string) => { foreground = value },
    dispose: () => { for (const dispose of disposers.reverse()) dispose() } }
}

describe('native DSH workbench tab', () => {
  it('registers and disposes the native file action, rejects late requests after the foreground session changes', async () => {
    const app = harness(true, true, true)
    const entry = app.ctx.contextMenus!.register.mock.calls[0]![0]
    const target = { sessionId: 'session-a', path: 'C:/repo/worktrees/topic/a.ts', line: 9 }
    const actions = entry.resolve(target, new AbortController().signal)
    let complete: (value: unknown) => void
    app.ctx.connection.rpc.call.mockImplementation(() => new Promise(resolve => { complete = resolve }))
    const first = actions[0].run()
    app.foreground('session-b')
    complete!({ ok: true, value: { repository: 'C:/repo/worktrees/topic', path: 'a.ts', absolutePath: target.path, deleted: false } })
    await expect(first).rejects.toThrow()
    const service = app.slots.find(slot => slot.registration.name === 'sidebar.right.pane.tab')!.registration.inject().references as ReferenceNavigation
    expect(service.size()).toBe(0)
    app.foreground('session-a')
    app.ctx.connection.rpc.call.mockResolvedValue({ ok: true, value: { repository: 'C:/repo/worktrees/topic', path: 'a.ts', absolutePath: target.path, deleted: false } })
    await actions[0].run()
    expect(service.get('session-a')?.view).toEqual({ kind: 'working' })
    expect(service.getOptions('session-a')).toEqual({ changes: true, line: 9 })
    const codec = app.ctx.inputTriggers!.registerSource.mock.calls.map(call => call[0]).find(source => source.name === 'git-workbench-annotations')
    expect(codec).toBeDefined()
    app.dispose()
    expect(service.size()).toBe(0)
  })
  it('registers a business reference renderer and routes it only to the originating foreground workbench', async () => {
    const app = harness(true, true)
    expect(app.ctx.uiConversation!.userText.register).toHaveBeenCalledTimes(2)
    expect(app.ctx.uiConversation!.userText.register).toHaveBeenCalledWith(expect.objectContaining({ id: 'git-workbench-annotations' }))
    expect(app.ctx.inputTriggers!.registerSource).toHaveBeenCalledWith(expect.objectContaining({ name: 'git-workbench-annotations', codec: expect.any(Object) }))
    expect(app.ctx.inputTriggers!.registerSource).toHaveBeenCalledWith(expect.objectContaining({ name: 'git-workbench', codec: expect.any(Object) }))
    const node = app.slots.find(slot => slot.registration.name === 'conversation.user.text.node')!
    const body = app.slots.find(slot => slot.registration.name === 'sidebar.right.pane.tab')!
    const references = body.registration.inject().references as ReferenceNavigation
    const reference = { version: 1, repository: 'C:/repo/worktrees/fix', path: 'a.ts', absolutePath: 'C:/repo/worktrees/fix/a.ts',
      view: { kind: 'commit', commit: 'a'.repeat(40) }, deleted: true, code: 'frozen code', displayedSnapshot: { kind: 'selection', side: 'old', startLine: 12, endLine: 12 } }
    expect(await node.registration.inject().openReference('session-a', { reference })).toBe(true)
    expect(references.get('session-a')).toBe(reference)
    app.foreground('session-b')
    expect(await node.registration.inject().openReference('session-a', { reference: { ...reference, code: 'late' } })).toBe(false)
    expect(references.get('session-a')).toBe(reference)
    app.dispose()
    expect(references.size()).toBe(0)
  })

  it('registers a retained body and localized native metadata, with an unchanged header fallback', () => {
    const app = harness()
    expect(app.definition()).toMatchObject({ id: WORKBENCH_TAB, kind: WORKBENCH_TAB, keepMounted: true })
    expect(app.definition().title('')).toBe(zh.workbenchTitle)
    app.language('en')
    expect(app.definition().title('')).toBe(en.workbenchTitle)
    expect(app.slots.map(s => s.registration.name)).toEqual(['sidebar.right.pane.tab', 'sidebar.right.pane.tab.title', 'conversation.session.header.actions'])
    const header = app.slots[2]!.registration.inject()
    expect(header.openDock('session-a')).toBe(true)
    expect(app.sidebar.openTab).toHaveBeenCalledWith(WORKBENCH_TAB)
    app.foreground('session-b')
    expect(header.openDock('session-a')).toBe(false)
    expect(app.sidebar.openTab).toHaveBeenCalledOnce()
    app.dispose()
    expect(header.openDock('session-b')).toBe(false)
    expect(app.slots).toHaveLength(0)
    const legacy = harness(false)
    expect(legacy.slots[0]!.registration.inject().openDock('session-a')).toBe(false)
    legacy.dispose()
  })
  it('reveals an inactive dirty tab before asking to close it', () => {
    const app = harness()
    const guards = app.slots[0]!.registration.inject().closeGuards as WorkbenchCloseGuards
    const unbind = guards.bind('session-a', 'tab-a', () => false)
    expect(() => app.close('session-a', { id: 'tab-a' })).toThrow('unsaved edits')
    expect(app.sidebar.focus).toHaveBeenCalledWith('tab-a')
    expect(app.sidebar.toggleExpanded).toHaveBeenCalledOnce()
    unbind(); app.dispose()
  })
  it('passes native visibility and session actions through to the retained panel', () => {
    const guards = new WorkbenchCloseGuards()
    const close = vi.fn()
    const info = { tab: { id: 'tab-a', visible: true, actions: { close } } }
    const props = { sessionId: 'session-a', useTabInfo: () => info, closeGuards: guards, references: new ReferenceNavigation(), inputActions: { captureInsertion: vi.fn() } }
    let renderer: ReturnType<typeof create>
    act(() => { renderer = create(createElement(DockedWorkbench, props as never)) })
    const panel = () => renderer!.root.findByType('panel-probe' as never)
    expect(panel().props.inputActions).toBe(props.inputActions)
    expect(panel().props.dock.visible).toBe(true)
    info.tab.visible = false
    act(() => renderer!.update(createElement(DockedWorkbench, { ...props } as never)))
    expect(panel().props.dock.visible).toBe(false)
    panel().props.dock.close()
    expect(close).toHaveBeenCalledOnce()
    act(() => renderer!.unmount())
  })
  it('retains a dirty native tab until its existing confirmation permits that exact close', () => {
    const guards = new WorkbenchCloseGuards()
    let confirm: (() => void) | undefined
    const unbind = guards.bind('s1', 't1', action => { confirm = action; return false })
    const commit = vi.fn()
    const close = () => { guards.beforeClose('s1', 't1', close); commit() }
    expect(close).toThrow('unsaved edits require confirmation')
    expect(commit).not.toHaveBeenCalled()
    expect(confirm).toBeTypeOf('function')
    confirm!()
    expect(commit).toHaveBeenCalledOnce()
    expect(close).toThrow()
    guards.beforeClose('s2', 't1', vi.fn())
    unbind()
    expect(guards.size()).toBe(0)
    close()
    expect(commit).toHaveBeenCalledTimes(2)
  })
})
