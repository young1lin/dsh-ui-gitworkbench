import type { ReactNode } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { ToolbarMenu } from './ToolbarMenu.tsx'
import { FileActionMenuItems, type ActionFile } from './FileActions.tsx'
import { IconActionButton } from './IconActionButton.tsx'
import type { Translate } from './git-workbench-types.ts'
import css from './GitWorkbenchPanel.module.css'

/** The editor stays mounted when its toolbar wraps or the file list opens. */
export function EditorToolbar({ file, children, className }: { file?: ReactNode; children: ReactNode; className: string }): ReactNode {
  return file ? <div className={css.editorToolbar} data-gs-part="editor-toolbar">
    {file}<div className={css.editorToolbarActions}>{children}</div>
  </div> : <div className={className}>{children}</div>
}

export function EditorMenu({ t, file, children }: { t: Translate; file?: ActionFile; children?: ReactNode }): ReactNode {
  return <ToolbarMenu label={t('editorActions')}>
    {children}
    {file ? <>
      {children ? <DropdownMenu.Separator className={css.toolbarMenuSeparator} /> : null}
      <DropdownMenu.Label className={css.toolbarMenuLabel}>{t('currentFile')}</DropdownMenu.Label>
      <FileActionMenuItems file={file} />
    </> : null}
  </ToolbarMenu>
}

export function ChangeNavigation({ t, current, total, onWalk }: {
  t: Translate; current: number | null; total: number; onWalk: (direction: -1 | 1) => void
}): ReactNode {
  if (total === 0) return null
  return <span className={css.editorChangeNav}>
    <IconActionButton icon="previous" label={t('prevChange')} hint={t('prevChangeHint')} shortcut="Shift+F7" onClick={() => onWalk(-1)} />
    <span className={css.sideNavCount} aria-label={current === null ? t('changeCount', { n: total }) : t('changePosition', { current: current + 1, total })}>
      {current === null ? total : `${current + 1}/${total}`}
    </span>
    <IconActionButton icon="next" label={t('nextChange')} hint={t('nextChangeHint')} shortcut="F7" onClick={() => onWalk(1)} />
  </span>
}
