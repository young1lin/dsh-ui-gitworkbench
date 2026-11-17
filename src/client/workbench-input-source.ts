import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { workbenchReferenceRule, type WorkbenchLink } from './workbench-reference.ts'

/** The composer owns editing and persistence; this source owns model serialization. */
export function workbenchInputSource(open: (sessionId: string, link: WorkbenchLink) => Promise<boolean>): InputTriggerSource {
  return {
    name: 'git-workbench', trigger: '@', showGroupTitle: false,
    candidates: async () => [], onPick: () => undefined,
    codec: {
      clipboardText: ref => ref,
      serialize: async (ref, signal) => {
        signal.throwIfAborted()
        const node = workbenchReferenceRule.match(ref, 0, { read: () => undefined })
        if (!node || !('reference' in node.data)) throw new Error('invalid workbench reference')
        return ref
      },
    },
    openReference: (session, ref) => {
      const node = workbenchReferenceRule.match(ref.ref, 0, { read: () => undefined })
      if (!node || !('reference' in node.data || 'legacyPath' in node.data)) return false
      void open(session.sessionId, node.data).catch(() => {})
      return true
    },
  }
}
