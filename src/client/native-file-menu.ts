import type { ContextMenuTargetMap, MenuContribution } from '@deepseek-ai/dsh-client-ui-context-menu/client'

export function nativeFileContribution(t: (key: string) => string, open: (target: ContextMenuTargetMap['file']) => Promise<boolean>): MenuContribution<'file'> {
  return { id: 'git-workbench.view-changes', target: 'file', order: 35, resolve(target, signal) {
    if (signal.aborted || !/^(?:[a-z]:[\\/]|\/)/i.test(target.path) || /[\u0000-\u001f]/.test(target.path)) return []
    return [{ id: 'git-workbench.view-changes', label: t('nativeViewChanges'), icon: { key: 'git-workbench' },
      failureLabel: t('referenceOpenFailed'), run: async () => { if (!await open(target)) throw new Error('workbench navigation unavailable') } }]
  } }
}
