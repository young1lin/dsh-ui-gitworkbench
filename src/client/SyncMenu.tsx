import { useId, useState, type ReactNode } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { ActionGlyph } from './IconActionButton.tsx'
import type { GitOpName, GitOpPayload, SyncStatus, Translate } from './git-workbench-types.ts'
import css from './GitWorkbenchPanel.module.css'

type PullMode = 'ff-only' | 'rebase' | 'merge'
const modes: readonly [PullMode, 'pullFf' | 'pullRebase' | 'pullMerge'][] = [['ff-only', 'pullFf'], ['rebase', 'pullRebase'], ['merge', 'pullMerge']]

/** Menu gestures use the drawer's existing operation and confirmation path. */
export function SyncMenu({ t, sync, busy, onOp }: {
  t: Translate; sync: SyncStatus; busy: GitOpName | null; onOp: (op: GitOpName, payload?: GitOpPayload) => void
}): ReactNode {
  const disabled = busy !== null
  const [pullOpen, setPullOpen] = useState(false)
  const pullId = useId()
  return <DropdownMenu.Group aria-label={t('syncLabel')}>
    <DropdownMenu.Label className={css.toolbarMenuLabel} title={sync.upstream ?? undefined}>
      {t('syncLabel')}<span className={css.menuUpstream}>{sync.upstream ?? t('noUpstream')}</span>
    </DropdownMenu.Label>
    <DropdownMenu.Item className={css.toolbarMenuItem} disabled={disabled} onSelect={() => onOp('fetch')}>
      <ActionGlyph icon="fetch" /><span>{t('fetch')}</span>
    </DropdownMenu.Item>
    <DropdownMenu.Item className={css.toolbarMenuItem} disabled={disabled || sync.upstream === null}
      aria-expanded={pullOpen} aria-controls={pullId} title={sync.upstream === null ? t('noUpstreamHint') : undefined}
      onSelect={event => { event.preventDefault(); setPullOpen(value => !value) }}>
      <ActionGlyph icon="pull" /><span>{t('pull')}</span>{sync.behind > 0 ? <small>{sync.behind}</small> : null}<ActionGlyph icon={pullOpen ? 'previous' : 'next'} />
    </DropdownMenu.Item>
    {pullOpen ? <DropdownMenu.Group id={pullId} aria-label={t('pullModeLabel')} className={css.menuInset}>
        <DropdownMenu.Label className={css.toolbarMenuLabel}>{t('pullModeLabel')}</DropdownMenu.Label>
        {modes.map(([mode, label]) => <DropdownMenu.Item key={mode} className={css.toolbarMenuItem} disabled={disabled || sync.upstream === null} onSelect={() => onOp('pull', { mode })}>
          <ActionGlyph icon="pull" /><span>{t(label)}</span>
        </DropdownMenu.Item>)}
    </DropdownMenu.Group> : null}
    <DropdownMenu.Item className={css.toolbarMenuItem} disabled={disabled} title={sync.upstream === null ? t('pushSetUpstream') : undefined} onSelect={() => onOp('push')}>
      <ActionGlyph icon="push" /><span>{t(sync.upstream === null ? 'publish' : 'push')}</span>{sync.ahead > 0 ? <small>{sync.ahead}</small> : null}
    </DropdownMenu.Item>
  </DropdownMenu.Group>
}
