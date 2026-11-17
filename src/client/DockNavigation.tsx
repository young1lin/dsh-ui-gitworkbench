import { useId, type ReactNode } from 'react'
import { ActionGlyph, IconActionButton } from './IconActionButton.tsx'
import type { ActionFile } from './FileActions.tsx'
import type { ReferenceView } from '../reference-contract.ts'
import type { Translate } from './git-workbench-types.ts'
import css from './GitWorkbenchPanel.module.css'

export function DockListHeader({ t, history = false, onBack, onResume, canResume }: {
  t: Translate; history?: boolean; onBack?: () => void; onResume: () => void; canResume: boolean
}): ReactNode {
  return <div className={css.dockListHeader}>
    {history ? <IconActionButton icon="back" label={t('dockShowCommits')} onClick={onBack!} /> : null}
    <span>{t('tabFiles')}</span>
    <button type="button" className={css.blockBtn} disabled={!canResume} onClick={onResume}>{t('dockResumeCode')}</button>
  </div>
}

export function DockFileNavigation({ t, file, version, onList }: {
  t: Translate; file: ActionFile; version: ReferenceView | null
  onList: () => void
}): ReactNode {
  const short = (sha: string): string => sha.slice(0, 8)
  const label = version === null ? t('loading') : version.kind === 'working' ? t('workingTree')
    : version.kind === 'commit' ? short(version.commit) : `${short(version.base)} → ${short(version.head)}`
  const full = version === null || version.kind === 'working' ? label : version.kind === 'commit'
    ? version.commit : `${version.base} → ${version.head}`
  const parent = file.path.lastIndexOf('/')
  return <div className={css.editorFile} data-gs-part="file-navigation">
    <button type="button" className={css.dockFilePicker} aria-label={t('dockBackFiles')} title={file.path} onClick={onList}>
      <ActionGlyph icon="files" /><span>{file.path.slice(parent + 1)}</span><ActionGlyph icon="chevron" />
    </button>
    {version?.kind === 'working' ? null : <code className={css.editorVersion} title={full}>{label}</code>}
  </div>
}

export function DockCommitPanel({ t, count, children }: { t: Translate; count: number; children: ReactNode }): ReactNode {
  const id = useId()
  return <details className={css.dockCommitPanel} data-gs-part="commit-panel">
    <summary aria-controls={id}><ActionGlyph icon="changes" /><span>{t('commit')}</span><span className={css.dockStagedCount} title={t('stagedCount', { count })}>{count}</span><span className={css.dockDisclosure} aria-hidden="true"><ActionGlyph icon="previous" /></span></summary>
    <div id={id} className={css.dockCommitBody}>{children}</div>
  </details>
}
