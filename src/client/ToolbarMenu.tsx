import { useEffect, useState, type ReactNode } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { ActionGlyph, ActionMenuContext, type ActionIcon } from './IconActionButton.tsx'
import { useWorkbenchVisible } from './workbench-visibility.ts'
import css from './GitWorkbenchPanel.module.css'

/** Small themed menus share focus and dismissal behavior with the workbench. */
export function ToolbarMenu({ label, icon = 'more', text, children }: {
  label: string; icon?: ActionIcon; text?: string; children: ReactNode
}): ReactNode {
  const [open, setOpen] = useState(false)
  const visible = useWorkbenchVisible()
  useEffect(() => { if (!visible) setOpen(false) }, [visible])
  return <DropdownMenu.Root open={open} onOpenChange={setOpen} modal={false}><div className={css.toolbarMenu}>
    <DropdownMenu.Trigger asChild><button type="button" className={text === undefined ? css.toolbarMenuIcon : css.toolbarMenuTrigger}
      aria-label={label} title={label}>
      <ActionGlyph icon={icon} />{text === undefined ? null : <><span>{text}</span><ActionGlyph icon="chevron" /></>}
    </button></DropdownMenu.Trigger>
    <DropdownMenu.Content aria-label={label} className={css.toolbarMenuPop} align="end" sideOffset={6} collisionPadding={10} loop
      onEscapeKeyDown={event => event.stopPropagation()}>
      <ActionMenuContext.Provider value={true}>{children}</ActionMenuContext.Provider>
    </DropdownMenu.Content>
  </div></DropdownMenu.Root>
}
