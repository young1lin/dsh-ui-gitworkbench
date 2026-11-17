import type { UseSidebarRightTabInfo } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { GitWorkbenchPanel, type WorkbenchProps } from './GitWorkbenchPanel.tsx'
import type { WorkbenchCloseGuards } from './workbench-dock.ts'
import type { ReferenceNavigation } from './reference-navigation.ts'
import { ReferenceRevealNavigation } from './use-reference-reveal.tsx'

export const WORKBENCH_TAB = '@young1lin/dsh-ui-gitworkbench'

export function DockedWorkbench({ useTabInfo, closeGuards, references, ...props }: WorkbenchProps & { useTabInfo: UseSidebarRightTabInfo; closeGuards: WorkbenchCloseGuards; references: ReferenceNavigation }) {
  const info = useTabInfo()
  const target = useSyncExternalStore(references.subscribe, () => references.get(props.sessionId))
  const bindClose = useCallback((guard: (close: () => void) => boolean) => closeGuards.bind(props.sessionId, info.tab.id, guard), [closeGuards, props.sessionId, info.tab.id])
  const dock = useMemo(() => ({ visible: info.tab.visible, bindClose,
    close: () => closeGuards.confirmed(props.sessionId, info.tab.id, info.tab.actions.close),
  }), [closeGuards, props.sessionId, info.tab.visible, info.tab.id, info.tab.actions.close, bindClose])
  const navigation = useMemo(() => ({ navigation: references, sessionId: props.sessionId }), [references, props.sessionId])
  return <ReferenceRevealNavigation.Provider value={navigation}><GitWorkbenchPanel {...props} dock={dock}
    referencePreview={target ? { target, ...references.getOptions(props.sessionId),
      select: reference => references.open(props.sessionId, reference, references.getOptions(props.sessionId)),
      close: () => references.close(props.sessionId) } : undefined} /></ReferenceRevealNavigation.Provider>
}

export function WorkbenchTitle({ t }: { t: (key: string) => string }) {
  return <span>{t('workbenchTitle')}</span>
}
