import type { UserTextRule } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { parseAnnotationBatch, type AnnotationBatch } from './annotations.ts'

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface UserTextDataMap { 'git-workbench-annotations': AnnotationBatch }
}
export const annotationRule: UserTextRule<'git-workbench-annotations'> = {
  id: 'git-workbench-annotations', order: 19,
  match(text, from) {
    const blocks = /^```git-workbench-annotations\r?\n([\s\S]*?)\r?\n```(?=\r?\n|$)/gm
    blocks.lastIndex = from
    for (let match = blocks.exec(text); match; match = blocks.exec(text)) {
      const batch = parseAnnotationBatch(match[1]!)
      if (batch) return { id: 'git-workbench-annotations', start: match.index, end: match.index + match[0].length, data: batch }
    }
    return undefined
  },
}
export function annotationInputSource(open: (sessionId: string, batch: AnnotationBatch) => Promise<boolean>): InputTriggerSource {
  return {
    name: 'git-workbench-annotations', trigger: '@', showGroupTitle: false, candidates: async () => [], onPick: () => undefined,
    codec: { clipboardText: ref => ref, serialize: async (ref, signal) => {
      signal.throwIfAborted()
      if (!annotationRule.match(ref, 0, { read: () => undefined })) throw new Error('invalid annotation batch')
      return ref
    } },
    openReference: (session, ref) => {
      const node = annotationRule.match(ref.ref, 0, { read: () => undefined })
      if (!node || !('annotations' in node.data)) return false
      void open(session.sessionId, node.data).catch(() => {})
      return true
    },
  }
}
