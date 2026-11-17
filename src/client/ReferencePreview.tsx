import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { CodeEditor, type PaintFn } from './CodeEditor.tsx'
import { DiffView } from './DiffViews.tsx'
import { FileActionsProvider } from './FileActions.tsx'
import { IconActionButton } from './IconActionButton.tsx'
import { highlightRange, shikiLangOf, shikiThemeOf, subscribeGrammarLoaded, grammarLoadCount } from './highlight.ts'
import type { WorkbenchProps } from './GitWorkbenchPanel.tsx'
import type { Translate } from './git-workbench-types.ts'
import type { WorkbenchReference } from './workbench-reference.ts'
import css from './GitWorkbenchPanel.module.css'
import type { ReferenceNavigationOptions } from './reference-navigation.ts'
import { AnnotationsPanel, AnnotationBatchReview } from './AnnotationsPanel.tsx'

export interface ReferencePreviewState extends ReferenceNavigationOptions { target: WorkbenchReference; close(): void; select?(reference: WorkbenchReference): void }
export function ReferencePreview({ target, changes, line, batch, select, onBack, t, palette, active, sessionId, referenceBridge, inputActions, fetchFileDiff, fetchFileSides }: ReferenceNavigationOptions & {
  select?: (reference: WorkbenchReference) => void
  target: WorkbenchReference; onBack: () => void; t: Translate; palette: string; active: boolean
} & Pick<WorkbenchProps, 'sessionId' | 'referenceBridge' | 'inputActions' | 'fetchFileDiff' | 'fetchFileSides'>): ReactNode {
  const [body, setBody] = useState<{ target: WorkbenchReference; kind: 'code' | 'diff' | 'error'; text: string } | null>(null)
  const grammar = useSyncExternalStore(subscribeGrammarLoaded, grammarLoadCount)
  const view = target.view
  useEffect(() => {
    if (target.code !== undefined || !active) return
    const controller = new AbortController()
    const load = async (): Promise<void> => {
      await referenceBridge.resolve(target.repository, { repoRoot: target.repository, path: target.path, deleted: target.deleted,
        view, ...target.previousPath ? { previousPath: target.previousPath } : {} }, controller.signal)
      if (changes) {
        const diff = await fetchFileDiff(target.repository, target.path, undefined, undefined, controller.signal)
        if (diff) { if (!controller.signal.aborted) setBody({ target, kind: 'diff', text: diff }); return }
      }
      if (view.kind === 'working' && !target.deleted) {
        const result = await fetchFileSides(target.repository, target.path, 'unstaged', controller.signal)
        if (!result || result.binary || result.tooLarge || result.lossyEncoding) throw new Error('reference content unavailable')
        if (!controller.signal.aborted) setBody({ target, kind: 'code', text: result.targetText })
      } else {
        if (view.kind === 'working' && target.file?.revision === null) throw new Error('index snapshot cannot be resolved by a commit')
        const diff = await fetchFileDiff(target.repository, target.path,
          view.kind === 'commit' ? view.commit : view.kind === 'working' ? target.file?.change ?? 'HEAD' : undefined,
          view.kind === 'compare' ? { base: view.base, head: view.head } : undefined, controller.signal)
        if (!diff) throw new Error('reference diff unavailable')
        if (!controller.signal.aborted) setBody({ target, kind: 'diff', text: diff })
      }
    }
    void load().catch(() => { if (!controller.signal.aborted) setBody({ target, kind: 'error', text: '' }) })
    return () => controller.abort()
  }, [target, changes, active, referenceBridge, fetchFileDiff, fetchFileSides])
  const paint = useMemo<PaintFn | null>(() => {
    const language = shikiLangOf(target.path)
    return language ? (lines, from, to) => highlightRange(`reference:${target.repository}:${target.path}`, lines, language, shikiThemeOf(palette), from, to) : null
  }, [target, palette, grammar])
  const loaded = body?.target === target ? body : null
  const code = target.code ?? (loaded?.kind === 'code' ? loaded.text : null)
  const file = { path: target.path, ...target.deleted ? { status: 'deleted' as const } : {}, ...target.previousPath ? { previousPath: target.previousPath } : {} }
  const version = view.kind === 'working' ? t('workingTree') : view.kind === 'commit' ? view.commit.slice(0, 8) : `${view.base.slice(0, 8)} → ${view.head.slice(0, 8)}`
  return <section className={css.referencePreview} aria-label={t('referencePreview')} data-gs-part="reference-preview">
    <header className={css.referencePreviewHeader}>
      <IconActionButton icon="back" label={t('referenceBack')} onClick={onBack} />
      <strong title={target.path}>{target.path.split('/').at(-1)}</strong><span>{version}</span>
    </header>
    <div className={css.referencePreviewMeta}><span title={target.repository}>{target.repository}</span><span title={target.path}>{target.path}</span></div>
    <div className={css.sideNotice}>{t(changes ? 'nativeCurrentChanges' : target.code === undefined ? 'referenceFileContext' : 'referenceFrozenCode')}</div>
    {batch && select ? <AnnotationBatchReview batch={batch} t={t} onSelect={select} /> : null}
    <FileActionsProvider t={t} sessionId={sessionId} worktreePath={target.repository} repoRoot={target.repository} view={view}
      bridge={referenceBridge} draftActions={inputActions} active={active} excerptFile={file} beforeAdd={act => act()} onAdded={() => {}}>
      {target.code !== undefined && target.displayedSnapshot?.kind === 'hunk' ? <DiffView segment={target.code} path={target.path} palette={palette} t={t} wrap={false} />
        : code !== null ? <CodeEditor key={`${target.absolutePath}:${version}:${target.displayedSnapshot?.startLine ?? 1}`} value={code} original={code} paint={paint} indent="  "
        ariaLabel={t('referencePreview')} readOnly autoFocus={false} initialLine={line} lineOffset={(target.displayedSnapshot?.startLine ?? 1) - 1}
        onChange={() => {}} onSave={() => {}} reference={{ file, source: { side: target.displayedSnapshot?.side ?? 'new', diffLines: target.displayedSnapshot?.diffLines,
          layer: target.displayedSnapshot?.layer, diffSha: target.displayedSnapshot?.diffSha, blob: target.displayedSnapshot?.blob,
          unsaved: target.displayedSnapshot?.unsaved ?? false } }} />
        : loaded?.kind === 'diff' ? <DiffView segment={loaded.text} path={target.path} palette={palette} t={t} wrap={false} initialLine={line} />
        : <div className={css.emptyState} role={loaded?.kind === 'error' ? 'status' : undefined}>{t(loaded?.kind === 'error' ? 'referenceContentUnavailable' : 'loading')}</div>}
      <AnnotationsPanel t={t} />
    </FileActionsProvider>
  </section>
}
