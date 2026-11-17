import type { ComponentProps, ReactNode } from 'react'
import { BranchSwitcher } from './BranchSwitcher.tsx'
import { ChromeGlyph } from './ChromeGlyph.tsx'
import { ActionGlyph, IconActionButton, type ActionIcon } from './IconActionButton.tsx'
import { ToolbarMenu } from './ToolbarMenu.tsx'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Elided, SettingsMenu, SourceChip } from './WorkbenchControls.tsx'
import { WorkbenchMore } from './WorkbenchMore.tsx'
import type { WorkbenchTab } from './dock-layout.ts'
import type { ReferenceView } from '../reference-contract.ts'
import type { Translate, WorkbenchStats } from './git-workbench-types.ts'
import css from './GitWorkbenchPanel.module.css'

const tabs = ['changes', 'history', 'compare', 'files'] as const
const labels = { changes: 'tabChanges', history: 'tabHistory', compare: 'tabCompare', files: 'tabFiles' } as const
const icons: Record<WorkbenchTab, ActionIcon> = { changes: 'changes', history: 'history', compare: 'compare', files: 'folder' }

export function WorkbenchViewMenu({ t, tab, onTab }: { t: Translate; tab: WorkbenchTab; onTab: (tab: WorkbenchTab) => void }): ReactNode {
  return <ToolbarMenu label={t('tabsLabel')} text={t(labels[tab])} icon={icons[tab]}>
    <DropdownMenu.RadioGroup value={tab} onValueChange={value => onTab(value as WorkbenchTab)}>
    {tabs.map(value => <DropdownMenu.RadioItem key={value} value={value} className={css.toolbarMenuItem}>
      <ActionGlyph icon={icons[value]} /><span>{t(labels[value])}</span>
      {tab === value ? <ActionGlyph icon="check" /> : null}
    </DropdownMenu.RadioItem>)}
    </DropdownMenu.RadioGroup>
  </ToolbarMenu>
}

export function WorkbenchChrome({ t, docked, tab, onTab, source, switcher, settings, path, view, totals, pending,
  detached, wrap, onWrap, maximized, onMaximize, onRefresh, onClose, sync, syncMenu }: {
  t: Translate; docked: boolean; tab: WorkbenchTab; onTab: (tab: WorkbenchTab) => void
  source: ComponentProps<typeof SourceChip>; switcher: ComponentProps<typeof BranchSwitcher> | null
  settings: ComponentProps<typeof SettingsMenu>; path: string; view: ReferenceView | null
  totals: Pick<WorkbenchStats, 'addedLines' | 'deletedLines' | 'addedFiles' | 'modifiedFiles' | 'deletedFiles'>
  pending: boolean; detached: boolean; wrap: boolean; onWrap: () => void
  maximized: boolean; onMaximize: () => void; onRefresh: () => void; onClose: () => void; sync: ReactNode; syncMenu: ReactNode
}): ReactNode {
  const version = view?.kind === 'commit' ? view.commit : view?.kind === 'compare' ? `${view.base} → ${view.head}` : null
  const details = <>
    {switcher === null ? null : <BranchSwitcher {...switcher} />}
    <Elided text={path} className={css.headerPathMain} title={path} />
    {detached && tab === 'changes' ? <span className={css.headerDetached}>detached HEAD</span> : null}
    {version === null ? null : <span className={css.headerView} title={version}>{version}</span>}
  </>
  const numbers = pending ? <span className={css.headerTotalsDim}>—</span> : <>
    <span className={css.headerTotals}><span className={css.headerTotalsAdd}>+{totals.addedLines}</span>{' '}<span className={css.headerTotalsDel}>−{totals.deletedLines}</span></span>
    <span className={css.headerTotalsDim}>{t('totalsDim', { added: totals.addedFiles, modified: totals.modifiedFiles, deleted: totals.deletedFiles })}</span>
  </>
  const wrapButton = <button type="button" className={wrap ? `${css.btn} ${css.btnIcon} ${css.btnIconOn}` : `${css.btn} ${css.btnIcon}`}
    aria-pressed={wrap} aria-label={t(wrap ? 'wrapLinesOff' : 'wrapLines')} title={t(wrap ? 'wrapLinesOff' : 'wrapLines')} onClick={onWrap}><ChromeGlyph of="wrap" /></button>
  const refreshButton = <button type="button" className={`${css.btn} ${css.btnIcon}`} aria-label={t('refresh')} title={t('refresh')} onClick={onRefresh}><ChromeGlyph of="refresh" /></button>
  const closeButton = <button type="button" className={`${css.btn} ${css.btnIcon} ${css.btnClose}`} aria-label={t('close')} title={t('close')} onClick={onClose}><ChromeGlyph of="close" /></button>
  return <>
    <div className={css.header} data-gs-part="header">
      {docked ? <>
        <div className={css.dockSource}><SourceChip {...source} details={<>
          <div className={css.repositoryDetails}>
            <span className={css.toolbarMenuLabel}>{t('currentSource')}</span>
            <Elided text={path} className={css.headerPathMain} title={path} />
            <div className={css.repositoryNumbers}>{numbers}</div>
            {detached && tab === 'changes' ? <span className={css.headerDetached}>detached HEAD</span> : null}
            {version === null ? null : <code className={css.headerView} title={version}>{version}</code>}
          </div>
          {switcher === null ? null : <div className={css.repositoryBranchAction}><BranchSwitcher {...switcher} /></div>}
        </>} /></div>
        <div className={css.workbenchTools}>
          <WorkbenchViewMenu t={t} tab={tab} onTab={onTab} />
          <IconActionButton icon="refresh" label={t('refresh')} onClick={onRefresh} />
          <WorkbenchMore t={t} settings={settings} wrap={wrap} onWrap={onWrap} sync={syncMenu} />
        </div>
      </> : <>
        <div className={css.headerLeft}><SourceChip {...source} />{details}{numbers}</div>
        <div className={css.headerRight}>
          <SettingsMenu {...settings} />
          <button type="button" className={`${css.btn} ${css.btnIcon}`} aria-pressed={maximized} aria-label={t(maximized ? 'restore' : 'maximize')} title={t(maximized ? 'restore' : 'maximize')} onClick={onMaximize}><ChromeGlyph of={maximized ? 'restore' : 'maximize'} /></button>
          {wrapButton}{refreshButton}{closeButton}
        </div>
      </>}
    </div>
    {docked ? null : <div className={css.tabs} role="tablist" aria-label={t('tabsLabel')} data-gs-part="tabs">
      {tabs.map(value => <button key={value} type="button" role="tab" aria-selected={tab === value}
        className={tab === value ? `${css.tab} ${css.tabActive}` : css.tab} onClick={() => onTab(value)}>{t(labels[value])}</button>)}
    </div>}
    {docked ? null : sync}
  </>
}
