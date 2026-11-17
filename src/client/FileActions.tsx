import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import type { ReferenceView } from '../reference-contract.ts'
import type { Translate } from './git-workbench-types.ts'
import type { WorkbenchKey } from './locales.ts'
import { prepareFileInsertion, referencePaths, type DraftActions, type ReferenceBridge } from './file-reference.ts'
import { excerptText, insertExcerpt, prepareExcerptInsertion, type CodeExcerpt } from './code-excerpt.ts'
import { WorkbenchVisibility, useWorkbenchVisible } from './workbench-visibility.ts'
import { ActionGlyph, IconActionButton } from './IconActionButton.tsx'
import { ReferenceRevealScope } from './use-reference-reveal.tsx'
import css from './GitWorkbenchPanel.module.css'
import { AnnotationStore, captureAnnotation } from './annotations.ts'

export interface ActionFile { readonly path: string; readonly status?: string; readonly previousPath?: string }
type MenuEvent = MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>
interface Actions {
  t: Translate
  canAdd: boolean
  add(file: ActionFile): void
  excerpt(file: ActionFile, excerpt: CodeExcerpt): void
  annotate(file: ActionFile, excerpt: CodeExcerpt): void
  annotations?: { store: AnnotationStore; sessionId: string; bridge: ReferenceBridge; draftActions?: DraftActions; active: boolean; report(key: WorkbenchKey): void }
  excerptMenu(file: ActionFile, excerpt: CodeExcerpt, event: MenuEvent): void
  menu(file: ActionFile, event: MenuEvent): void
  copyFile(file: ActionFile, kind: 'name' | 'relative' | 'absolute'): void
}
const Context = createContext<Actions | null>(null)

/** One menu and one pending request per drawer, never one listener per file. */
export function FileActionsProvider({ children, t, sessionId, worktreePath, repoRoot, view, bridge, draftActions, beforeAdd, onAdded, onReveal, excerptFile, annotations, active = true }: {
  annotations?: AnnotationStore
  active?: boolean
  excerptFile?: ActionFile | null
  children: ReactNode
  t: Translate
  sessionId: string
  worktreePath: string
  repoRoot: string | null
  view: ReferenceView | null
  bridge: ReferenceBridge
  draftActions: DraftActions | undefined
  beforeAdd: (act: () => void) => void
  onAdded: () => void
  onReveal?: () => void
}): ReactNode {
  const inherited = useContext(Context)?.annotations?.store
  const store = annotations ?? inherited
  const [menu, setMenu] = useState<{ file: ActionFile; x: number; y: number; trigger: HTMLElement; excerpt?: { code: string; insert: () => void; annotate: () => void } } | null>(null)
  const [notice, setNotice] = useState<WorkbenchKey | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const opened = useRef<typeof menu>(null)
  const pending = useRef<AbortController | null>(null)
  const alive = useRef(true)
  const current = useRef({ t, sessionId, worktreePath, repoRoot, view, bridge, draftActions, beforeAdd, onAdded, excerptFile, active })
  useLayoutEffect(() => { current.current = { t, sessionId, worktreePath, repoRoot, view, bridge, draftActions, beforeAdd, onAdded, excerptFile, active } })
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; pending.current?.abort() }
  }, [])
  useEffect(() => {
    if (notice !== 'filePathCopied' && notice !== 'codeAdded') return
    const timer = setTimeout(() => setNotice(null), 1800)
    return () => clearTimeout(timer)
  }, [notice])

  useEffect(() => { if (!active) { pending.current?.abort(); pending.current = null; setMenu(null) } }, [active])

  const dismiss = useCallback((restore: boolean): void => {
    if (restore && opened.current?.trigger.isConnected) opened.current.trigger.focus()
    opened.current = null
    setMenu(null)
  }, [])
  useEffect(() => {
    if (menu === null) return
    const outside = (event: PointerEvent): void => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) dismiss(false)
    }
    const moved = (): void => dismiss(false)
    document.addEventListener('pointerdown', outside, true)
    window.addEventListener('resize', moved)
    // Scrolling either tree can recycle the row the menu belongs to.
    document.addEventListener('scroll', moved, true)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('resize', moved)
      document.removeEventListener('scroll', moved, true)
    }
  }, [menu, dismiss])
  useLayoutEffect(() => {
    const element = menuRef.current
    if (menu === null || element === null) return
    const box = element.getBoundingClientRect()
    element.style.left = `${Math.max(8, Math.min(menu.x, window.innerWidth - box.width - 8))}px`
    element.style.top = `${Math.max(8, Math.min(menu.y, window.innerHeight - box.height - 8))}px`
    element.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }, [menu])

  const openMenu = useCallback((file: ActionFile, event: MenuEvent, excerpt?: { code: string; insert: () => void; annotate: () => void }): void => {
    event.preventDefault()
    event.stopPropagation()
    const trigger = event.currentTarget
    const box = trigger.getBoundingClientRect()
    const pointer = 'clientX' in event && event.type === 'contextmenu'
    const next = { file, trigger, x: pointer ? event.clientX : box.left, y: pointer ? event.clientY : box.bottom, excerpt }
    opened.current = next
    setMenu(next)
    setNotice(null)
  }, [])

  const add = useCallback((requestedFile: ActionFile): void => {
    const { t, sessionId, worktreePath, repoRoot, view, bridge, draftActions, onAdded, excerptFile } = current.current
    const file = excerptFile?.path === requestedFile.path ? excerptFile : requestedFile
    dismiss(false)
    if (pending.current !== null || !alive.current || !current.current.active) return
    if (!view || !repoRoot) { setNotice('fileReferenceUnavailable'); return }
    const ctrl = new AbortController()
    pending.current = ctrl
    setNotice('fileReferenceLoading')
    prepareFileInsertion(bridge, sessionId, worktreePath, { repoRoot, path: file.path, deleted: file.status === 'deleted', view,
      ...file.previousPath === undefined ? {} : { previousPath: file.previousPath } }, draftActions, t('fileReferenceHeading'), ctrl.signal)
      .then(result => {
        if (ctrl.signal.aborted || !alive.current || !current.current.active) return
        if (result.kind !== 'ready') {
          setNotice('fileReferenceUnavailable')
          return
        }
        setNotice(null)
        // Ask with the editor's latest dirty flag, after the async read.
        // Admission, insertion and closing then happen in the same gesture.
        current.current.beforeAdd(() => {
          if (ctrl.signal.aborted || !alive.current || !current.current.active) return
          try {
            const inserted = result.insert()
            if (inserted.kind !== 'inserted') { setNotice('fileReferenceChanged'); return }
            onAdded()
            queueMicrotask(() => inserted.input.focus())
          } catch { setNotice('fileReferenceFailed') }
        })
      })
      .catch(() => { if (!ctrl.signal.aborted && alive.current) setNotice('fileReferenceFailed') })
      .finally(() => { if (pending.current === ctrl) pending.current = null })
  }, [dismiss])

  const writeClipboard = useCallback((value: string): void => {
    try {
      navigator.clipboard.writeText(value)
        .then(() => { if (alive.current) setNotice('filePathCopied') })
        .catch(() => { if (alive.current) setNotice('fileCopyFailed') })
    } catch { setNotice('fileCopyFailed') }
  }, [])
  const copyFile = useCallback((file: ActionFile, kind: 'name' | 'relative' | 'absolute'): void => {
    const value = kind === 'name' ? file.path.slice(file.path.lastIndexOf('/') + 1)
      : kind === 'relative' ? file.path : referencePaths(current.current.repoRoot ?? '', file.path).absolute
    writeClipboard(value)
  }, [writeClipboard])
  const copy = (kind: 'name' | 'relative' | 'absolute' | 'code'): void => {
    if (menu === null) return
    const file = menu.file
    dismiss(true)
    if (kind === 'code') writeClipboard(menu.excerpt?.code ?? '')
    else copyFile(file, kind)
  }

  const keyboard = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(true); return }
    if (event.key === 'Tab') { dismiss(true); return }
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : event.key === 'ArrowDown' ? (at + 1) % buttons.length
      : event.key === 'ArrowUp' ? (at + buttons.length - 1) % buttons.length : -1
    if (next < 0) return
    event.preventDefault()
    event.stopPropagation()
    buttons[next]?.focus()
  }
  const canAdd = view !== null && repoRoot !== null
  const insertQuote = useCallback((target: typeof current.current, file: ActionFile, excerpt: CodeExcerpt): void => {
    const { t, repoRoot, worktreePath, view, bridge, sessionId, draftActions, excerptFile } = target
    if (!current.current.active || current.current.sessionId !== sessionId || !repoRoot || !view || !alive.current) return
    const canonical = excerptFile?.path === file.path ? excerptFile : file
    const report = (result: ReturnType<typeof insertExcerpt>): void =>
      setNotice(result === 'inserted' ? 'codeAdded' : result === 'changed' ? 'fileReferenceChanged' : 'fileReferenceUnavailable')
    if (view.kind === 'commit' && !/^[0-9a-f]{40,64}$/i.test(view.commit)) {
      if (pending.current) return
      const ctrl = new AbortController()
      pending.current = ctrl
      setNotice('fileReferenceLoading')
      prepareExcerptInsertion(bridge, sessionId, worktreePath, { repoRoot, path: canonical.path, deleted: canonical.status === 'deleted', view,
        ...canonical.previousPath === undefined ? {} : { previousPath: canonical.previousPath } }, excerpt, draftActions, t('codeReferenceHeading'), ctrl.signal)
        .then(result => {
          if (ctrl.signal.aborted || !alive.current || !current.current.active || current.current.sessionId !== sessionId) return
          if (result.kind !== 'ready') { setNotice('fileReferenceUnavailable'); return }
          const inserted = result.insert()
          if (inserted !== 'aborted') report(inserted)
        })
        .catch(() => { if (!ctrl.signal.aborted && alive.current) setNotice('fileReferenceFailed') })
        .finally(() => { if (pending.current === ctrl) pending.current = null })
      return
    }
    try {
      report(insertExcerpt(bridge, sessionId, draftActions, excerptText(repoRoot, canonical, view, excerpt, t('codeReferenceHeading'))))
    } catch { setNotice('fileReferenceFailed') }
  }, [])
  const excerpt = useCallback((file: ActionFile, value: CodeExcerpt): void => insertQuote(current.current, file, value), [insertQuote])
  const annotateQuote = useCallback((target: typeof current.current, file: ActionFile, value: CodeExcerpt): void => {
    if (!store || !target.repoRoot || !target.view || !current.current.active || target.sessionId !== current.current.sessionId || !alive.current) return
    if (store.get(target.sessionId).editing) { setNotice('annotationFinish'); return }
    if (pending.current) return
    const canonical = target.excerptFile?.path === file.path ? target.excerptFile : file
    const ctrl = new AbortController()
    pending.current = ctrl
    void captureAnnotation(target.bridge, target.worktreePath, { repoRoot: target.repoRoot, path: canonical.path,
      deleted: canonical.status === 'deleted', view: target.view, ...canonical.previousPath ? { previousPath: canonical.previousPath } : {} }, value, ctrl.signal)
      .then(reference => {
        if (ctrl.signal.aborted || !alive.current || !current.current.active || target.sessionId !== current.current.sessionId) return
        try { if (!store.begin(target.sessionId, reference)) setNotice('annotationFinish') }
        catch { setNotice('annotationCapacity') }
      })
      .catch(() => { if (!ctrl.signal.aborted && alive.current) setNotice('fileReferenceFailed') })
      .finally(() => { if (pending.current === ctrl) pending.current = null })
  }, [store])
  const annotate = useCallback((file: ActionFile, value: CodeExcerpt): void => annotateQuote(current.current, file, value), [annotateQuote])
  const excerptMenu = useCallback((file: ActionFile, value: CodeExcerpt, event: MenuEvent): void => {
    const target = current.current
    if (!target.active || !target.repoRoot || !target.view) return
    const canonical = target.excerptFile?.path === file.path ? target.excerptFile : file
    openMenu(canonical, event, { code: value.text, insert: () => insertQuote(target, canonical, value), annotate: () => annotateQuote(target, canonical, value) })
  }, [openMenu, insertQuote, annotateQuote])
  // The framework may rebind t on a poll. Only a changed dictionary should
  // invalidate every row's context and the Files tab's memoized row array.
  const language = t('fileActions')
  const annotationActions = useMemo(() => store ? { store, sessionId, bridge, draftActions, active, report: setNotice } : undefined, [store, sessionId, bridge, draftActions, active])
  const value = useMemo(() => ({ t, canAdd, add, excerpt, annotate, annotations: annotationActions, excerptMenu, menu: openMenu, copyFile }), [language, canAdd, add, excerpt, annotate, annotationActions, excerptMenu, openMenu, copyFile])
  return (
    <ReferenceRevealScope repository={repoRoot} view={view} active={active} onReveal={onReveal}>
    <WorkbenchVisibility.Provider value={active}><Context.Provider value={value}>
      {children}
      {menu === null ? null : (
        <div ref={menuRef} className={css.fileMenu} role="menu" aria-label={t('fileActions')}
          style={{ left: menu.x, top: menu.y }} onKeyDown={keyboard} onClick={event => event.stopPropagation()}
          onContextMenu={event => event.preventDefault()}>
          <div className={css.fileMenuPath} title={menu.file.path}>{menu.file.path}</div>
          <button type="button" role="menuitem" disabled={!canAdd || !active} onClick={() => {
            if (menu.excerpt) { const insert = menu.excerpt.insert; dismiss(false); insert() }
            else add(menu.file)
          }}><ActionGlyph icon="conversation" /><span>{t(menu.excerpt ? 'codeAddSelection' : 'fileAddToChat')}</span></button>
          {menu.excerpt ? <button type="button" role="menuitem" onClick={() => copy('code')}><ActionGlyph icon="copy" /><span>{t('codeCopy')}</span></button> : null}
          {menu.excerpt && store ? <button type="button" role="menuitem" disabled={!canAdd || !active} onClick={() => {
            const annotate = menu.excerpt!.annotate; dismiss(false); annotate()
          }}><ActionGlyph icon="annotate" /><span>{t('annotationWrite')}</span></button> : null}
          <div className={css.fileMenuSeparator} role="separator" />
          <button type="button" role="menuitem" onClick={() => copy('name')}><ActionGlyph icon="file" /><span>{t('fileCopyName')}</span></button>
          <button type="button" role="menuitem" onClick={() => copy('relative')}><ActionGlyph icon="folder" /><span>{t('fileCopyRelative')}</span></button>
          <button type="button" role="menuitem" onClick={() => copy('absolute')}><ActionGlyph icon="link" /><span>{t('fileCopyAbsolute')}</span></button>
        </div>
      )}
      {notice === null ? null : <div className={css.fileActionNotice} role="status" onClick={event => event.stopPropagation()}>{t(notice)}</div>}
    </Context.Provider></WorkbenchVisibility.Provider></ReferenceRevealScope>
  )
}

export function useAnnotationActions() { return useContext(Context)?.annotations }

export function useExcerptMenu() {
  const actions = useContext(Context)
  return useCallback((file: ActionFile, excerpt: CodeExcerpt | null, event: MenuEvent): void => {
    if (excerpt) actions?.excerptMenu(file, excerpt, event)
  }, [actions])
}

export function useFileActions() {
  const actions = useContext(Context)
  return useCallback((file: ActionFile) => ({
    onContextMenu: (event: MouseEvent<HTMLElement>): void => actions?.menu(file, event),
    onKeyDown: (event: KeyboardEvent<HTMLElement>): void => {
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) actions?.menu(file, event)
    },
  }), [actions])
}

export function FileMenuButton({ file }: { file: ActionFile }): ReactNode {
  const actions = useContext(Context)
  const fileActions = useFileActions()
  if (!actions) return null
  return <button type="button" className={css.fileMenuTrigger} aria-label={actions.t('fileActionsFor', { path: file.path })}
    title={actions.t('fileActions')} aria-haspopup="menu" {...fileActions(file)} onClick={event => actions.menu(file, event)}>⋯</button>
}

export function AddFileButton({ file }: { file: ActionFile }): ReactNode {
  const actions = useContext(Context)
  const visible = useWorkbenchVisible()
  if (!actions) return null
  return <IconActionButton icon="conversation" preserveSelection label={actions.t('fileAddToChat')} hint={actions.t('fileAddHint')}
    disabled={!actions.canAdd || !visible} onClick={() => actions.add(file)} />
}

/** File actions share the same source and draft guards in every menu. */
export function FileActionMenuItems({ file }: { file: ActionFile }): ReactNode {
  const actions = useContext(Context)
  if (!actions) return null
  return <>
    <AddFileButton file={file} />
    <IconActionButton icon="copy" label={actions.t('fileCopyName')} onClick={() => actions.copyFile(file, 'name')} />
    <IconActionButton icon="copy" label={actions.t('fileCopyRelative')} onClick={() => actions.copyFile(file, 'relative')} />
    <IconActionButton icon="copy" label={actions.t('fileCopyAbsolute')} onClick={() => actions.copyFile(file, 'absolute')} />
  </>
}

export function AddExcerptButton({ file, kind, capture, disabled = false }: {
  file: ActionFile
  kind: 'selection' | 'hunk'
  capture: () => CodeExcerpt | null
  disabled?: boolean
}): ReactNode {
  const actions = useContext(Context)
  const visible = useWorkbenchVisible()
  if (!actions) return null
  return <><IconActionButton icon="conversation" preserveSelection label={actions.t(kind === 'selection' ? 'codeAddSelection' : 'codeAddHunk')}
    hint={actions.t('codeAddHint')} disabled={!actions.canAdd || !visible || disabled}
    onClick={() => { const value = capture(); if (value) actions.excerpt(file, value) }} />
    {actions.annotations ? <IconActionButton icon="annotate" preserveSelection label={actions.t('annotationWrite')}
      disabled={!actions.canAdd || !visible || disabled} onClick={() => { const value = capture(); if (value) actions.annotate(file, value) }} /> : null}</>
}
