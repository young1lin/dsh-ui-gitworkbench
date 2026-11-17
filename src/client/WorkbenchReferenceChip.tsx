import { useState, type ReactNode } from 'react'
import type { UserTextNodeProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { WorkbenchLink } from './workbench-reference.ts'
import type { Translate } from './git-workbench-types.ts'
import { ActionGlyph } from './IconActionButton.tsx'
import css from './GitWorkbenchPanel.module.css'

export function WorkbenchReferenceChip({ node, interactive, sessionId, openReference, t }: UserTextNodeProps<'git-workbench'> & {
  openReference: (sessionId: string, link: WorkbenchLink) => Promise<boolean>; t: Translate
}): ReactNode {
  const [failed, setFailed] = useState(false)
  const [pending, setPending] = useState(false)
  const data = node.data
  const path = 'reference' in data ? data.reference.path : data.legacyPath
  const snapshot = 'reference' in data ? data.reference.displayedSnapshot : undefined
  const lines = snapshot?.startLine === undefined ? '' : `:${snapshot.startLine}${snapshot.endLine === undefined || snapshot.endLine === snapshot.startLine ? '' : `–${snapshot.endLine}`}`
  const open = async (): Promise<void> => {
    setPending(true)
    try { setFailed(!await openReference(sessionId, data)) } catch { setFailed(true) } finally { setPending(false) }
  }
  return <span className={css.referenceInline}>
    <button type="button" className={css.referenceChip} disabled={!interactive || pending}
      title={t('referenceOpen', { path })} onClick={() => { void open() }}>
      <ActionGlyph icon={snapshot?.kind === 'hunk' ? 'changes' : 'source'} /><span>{path.split(/[\\/]/).at(-1)}{lines}</span>
      <span className={css.referenceChipKind}>{t(snapshot ? 'referenceCode' : 'workbenchTitle')}</span>
    </button>
    {failed ? <span role="status" className={css.referenceInlineError}>{t('referenceOpenFailed')}</span> : null}
  </span>
}
