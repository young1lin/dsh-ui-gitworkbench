import { useWorkbenchVisible } from './workbench-visibility.ts'
import { useEffect, useRef, type ReactNode } from 'react'
import type { Translate } from './git-workbench-types.ts'
import css from './GitWorkbenchPanel.module.css'

/**
 * The unsaved-edits guard, rendered at both sites that defer a gesture on the
 * buffer's answer: the pane's layer-tab switch, and the drawer level (file
 * selection, main tab, source switch, close) for every gesture that would
 * drop the buffer. Same reason as the roll-back confirmation — the click it
 * answers to is one gesture away from losing work. Cancel holds the initial
 * focus and Escape closes, because the default answer to losing edits is no.
 */
export function LeaveEditsConfirm({ t, path, onCancel, onConfirm }: {
  t: Translate
  path: string
  onCancel: () => void
  onConfirm: () => void
}): ReactNode {
  const visible = useWorkbenchVisible()
  const stayRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (visible) stayRef.current?.focus() }, [visible])
  useEffect(() => {
    if (!visible) return
    // Capture phase, like the roll-back dialog: while a question about edits
    // is open, Escape answers it and nothing else — consumed here, before it
    // can reach the page's other Escape handlers (an open picker's dismiss,
    // the commit box's undo).
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onCancel()
    }
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('keydown', onKey, true) }
  }, [onCancel, visible])
  if (!visible) return null
  return (
    <div className={css.confirmScrim} onClick={onCancel}>
      <div
        className={css.confirmBox}
        role="alertdialog"
        aria-modal="true"
        aria-label={t('unsavedTitle')}
        onClick={event => event.stopPropagation()}
      >
        <div className={css.confirmTitle}>{t('unsavedTitle')}</div>
        <div className={css.confirmBody}>{t('unsavedBody', { path })}</div>
        <div className={css.confirmActions}>
          <button ref={stayRef} type="button" className={css.btn} onClick={onCancel}>{t('unsavedStay')}</button>
          <button type="button" className={`${css.btn} ${css.btnDanger}`} onClick={onConfirm}>{t('unsavedLeave')}</button>
        </div>
      </div>
    </div>
  )
}
