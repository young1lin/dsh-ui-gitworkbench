import { useEffect, useState, type ComponentProps, type ReactNode } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { ActionGlyph } from './IconActionButton.tsx'
import { ToolbarMenu } from './ToolbarMenu.tsx'
import { SettingsMenu } from './WorkbenchControls.tsx'
import { useWorkbenchVisible } from './workbench-visibility.ts'
import type { Translate } from './git-workbench-types.ts'
import css from './GitWorkbenchPanel.module.css'

export function WorkbenchMore({ t, settings, wrap, onWrap, sync }: {
  t: Translate; settings: ComponentProps<typeof SettingsMenu>; wrap: boolean; onWrap: () => void; sync: ReactNode
}): ReactNode {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const visible = useWorkbenchVisible()
  useEffect(() => { if (!visible) setSettingsOpen(false) }, [visible])
  return <div className={css.workbenchMore}>
    <ToolbarMenu label={t('dockMore')}>
      <DropdownMenu.Label className={css.toolbarMenuLabel}>{t('appearance')}</DropdownMenu.Label>
      <DropdownMenu.CheckboxItem className={css.toolbarMenuItem} checked={wrap} onCheckedChange={onWrap}>
        <ActionGlyph icon="wrap" /><span>{t('wrapLines')}</span>{wrap ? <ActionGlyph icon="check" /> : null}
      </DropdownMenu.CheckboxItem>
      <DropdownMenu.Item className={css.toolbarMenuItem} onSelect={() => setSettingsOpen(true)}>
        <ActionGlyph icon="settings" /><span>{t('settings')}</span>
      </DropdownMenu.Item>
      {sync ? <><DropdownMenu.Separator className={css.toolbarMenuSeparator} />{sync}</> : null}
    </ToolbarMenu>
    <div className={css.dockSettings}><SettingsMenu {...settings} control={{ open: settingsOpen, onOpenChange: setSettingsOpen }} /></div>
  </div>
}
