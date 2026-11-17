import { useContext, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { UserTextNodeProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { insertAnnotations, type AnnotationBatch } from './annotations.ts'
import { useAnnotationActions } from './FileActions.tsx'
import { ActionGlyph, IconActionButton } from './IconActionButton.tsx'
import { ReferenceRevealNavigation } from './use-reference-reveal.tsx'
import { WorkbenchReferenceChip } from './WorkbenchReferenceChip.tsx'
import type { WorkbenchLink, WorkbenchReference } from './workbench-reference.ts'
import type { Translate } from './git-workbench-types.ts'
import css from './GitWorkbenchPanel.module.css'

export function annotationLabel(reference: WorkbenchReference): string {
  const first = reference.displayedSnapshot?.startLine, last = reference.displayedSnapshot?.endLine
  return reference.path.split('/').at(-1)! + (first === undefined ? '' : `:${first}${last && last !== first ? `–${last}` : ''}`)
}
function Source({ reference, t }: { reference: WorkbenchReference; t: Translate }): ReactNode {
  const view = reference.view
  const side = useMemo(() => {
    const snapshot = reference.displayedSnapshot
    if (snapshot?.side !== 'unified' || !snapshot.diffLines?.length) return snapshot?.side
    return snapshot.diffLines.every(row => row.kind === 'del') ? 'old' : snapshot.diffLines.every(row => row.kind === 'add') ? 'new' : 'unified'
  }, [reference])
  const version = view.kind === 'working' ? t('workingTree') : view.kind === 'commit' ? view.commit.slice(0, 8) : `${view.base.slice(0, 8)} → ${view.head.slice(0, 8)}`
  return <span className={css.annotationSource} title={`${reference.repository}\n${reference.path}`}>
    {version} · {t(side === 'old' ? 'annotationOld' : side === 'new' ? 'annotationNew' : 'annotationDiff')}
    {reference.deleted ? ` · ${t('annotationDeleted')}` : ''}{reference.displayedSnapshot?.unsaved ? ` · ${t('annotationUnsaved')}` : ''}
  </span>
}

/** A collapsed footer unless a note is being written or the user expands the list. */
export function AnnotationsPanel({ t }: { t: Translate }): ReactNode {
  const actions = useAnnotationActions()
  return actions ? <PendingAnnotations t={t} actions={actions} /> : null
}
function PendingAnnotations({ t, actions }: { t: Translate; actions: NonNullable<ReturnType<typeof useAnnotationActions>> }): ReactNode {
  const { store, sessionId } = actions
  const state = useSyncExternalStore(store.subscribe, () => store.get(sessionId))
  const [expanded, setExpanded] = useState(false)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const navigation = useContext(ReferenceRevealNavigation)
  const editing = state.editing
  useLayoutEffect(() => { if (editing && actions.active) textarea.current?.focus() }, [editing?.id, actions.active])
  if (!state.items.length && !editing) return null
  const attempt = (action: () => void): void => { try { action() } catch { actions.report('annotationCapacity') } }
  const add = (): void => {
    if (!actions.active || !state.items.length || editing) return
    const items = state.items
    try {
      const result = insertAnnotations(actions.bridge, sessionId, actions.draftActions,
        { version: 1, annotations: items.map(({ reference, note }) => ({ reference, note })) }, t('annotationCount', { n: items.length }))
      if (result === 'inserted') { store.complete(sessionId, items); setExpanded(false) }
      else actions.report(result === 'changed' ? 'fileReferenceChanged' : 'fileReferenceUnavailable')
    } catch { actions.report('fileReferenceFailed') }
  }
  return <section className={css.annotationsPanel} aria-label={t('annotations')} data-gs-part="annotations">
    <header className={css.annotationsHeader}>
      <button type="button" className={css.annotationsToggle} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
        <ActionGlyph icon="annotate" /><span>{t('annotationCount', { n: state.items.length })}</span><ActionGlyph icon={expanded ? 'previous' : 'next'} />
      </button>
      <button type="button" className={css.annotationAdd} disabled={!actions.active || !state.items.length || !!editing} onClick={add}>
        <ActionGlyph icon="conversation" /><span>{t('annotationAddDraft')}</span>
      </button>
    </header>
    {expanded && state.items.length ? <div className={css.annotationsList}>
      {state.items.map(item => <div className={css.annotationItem} key={item.id}>
        <div className={css.annotationItemHeading}><button type="button" className={css.annotationLocation} title={item.reference.path}
          disabled={!navigation} onClick={() => navigation?.navigation.open(sessionId, item.reference)}>{annotationLabel(item.reference)}</button>
          <IconActionButton icon="edit" label={t('annotationEdit')} disabled={!!editing || !actions.active} onClick={() => store.edit(sessionId, item.id)} />
          <IconActionButton icon="remove" label={t('annotationRemove')} disabled={!actions.active} onClick={() => store.remove(sessionId, item.id)} />
        </div><Source reference={item.reference} t={t} /><p>{item.note}</p>
      </div>)}
    </div> : null}
    {editing ? <div className={css.annotationComposer}>
      <strong title={editing.reference.path}>{annotationLabel(editing.reference)}</strong><Source reference={editing.reference} t={t} />
      <textarea ref={textarea} value={editing.note} maxLength={8192} placeholder={t('annotationPlaceholder')} aria-label={t('annotationWrite')}
        disabled={!actions.active} onChange={event => attempt(() => store.write(sessionId, event.target.value))}
        onKeyDown={event => {
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); attempt(() => { store.save(sessionId) }) }
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); textarea.current?.blur() }
        }} />
      <div className={css.annotationComposerFooter}><span>{t('annotationDraftHint')}</span>
        <button type="button" disabled={!actions.active} onClick={() => store.cancel(sessionId)}>{t('cancel')}</button>
        <button type="button" disabled={!actions.active || !editing.note.trim()} onClick={() => attempt(() => { store.save(sessionId) })}>{t('annotationSave')}</button>
      </div>
    </div> : null}
  </section>
}

/** The sent message shows every note; each source remains independently navigable. */
export function AnnotationBatchNode({ node, interactive, sessionId, t, openReference }: UserTextNodeProps<'git-workbench-annotations'> & {
  t: Translate; openReference: (sessionId: string, link: WorkbenchLink) => Promise<boolean>
}): ReactNode {
  return <span className={css.annotationBatch}>
    <strong>{t('annotationCount', { n: node.data.annotations.length })}</strong>
    {node.data.annotations.map((item, index) => <span className={css.annotationBatchItem} key={index}>
      <WorkbenchReferenceChip sessionId={sessionId} interactive={interactive} t={t} openReference={openReference}
        node={{ id: 'git-workbench', start: 0, end: 0, data: { reference: item.reference } }} />
      <Source reference={item.reference} t={t} /><span className={css.annotationNote}>{item.note}</span>
    </span>)}
  </span>
}

export function AnnotationBatchReview({ batch, t, onSelect }: { batch: AnnotationBatch; t: Translate; onSelect(reference: WorkbenchReference): void }): ReactNode {
  return <div className={css.annotationReview} aria-label={t('annotations')}>
    <strong>{t('annotationCount', { n: batch.annotations.length })}</strong>
    {batch.annotations.map((item, index) => <div className={css.annotationItem} key={index}>
      <button type="button" className={css.annotationLocation} title={`${item.reference.repository}\n${item.reference.path}`} onClick={() => onSelect(item.reference)}>{annotationLabel(item.reference)}</button>
      <Source reference={item.reference} t={t} /><p>{item.note}</p>
    </div>)}
  </div>
}
