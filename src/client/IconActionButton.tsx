import { createContext, useContext, useEffect, useId, useRef, useState, type MouseEventHandler, type ReactNode } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { tooltipPlacement } from './tooltip-placement.ts'
import css from './GitWorkbenchPanel.module.css'

export const ActionMenuContext = createContext(false)
export type ActionIcon = 'annotate' | 'remove' | 'conversation' | 'stage' | 'unstage' | 'unstageFile' | 'revert' | 'edit' | 'save' | 'blame' | 'source' | 'image' | 'inline' | 'columns' | 'files' | 'back' | 'previous' | 'next' | 'changes' | 'history' | 'compare' | 'folder' | 'more' | 'refresh' | 'chevron' | 'check' | 'copy' | 'search' | 'wrap' | 'settings' | 'fetch' | 'pull' | 'push' | 'file' | 'link'

const paths: Record<ActionIcon, string> = {
  annotate: 'M8 2H3a1 1 0 0 0-1 1v11l3-3h8a1 1 0 0 0 1-1V8 M6 8l1-3 5-4 2 2-5 4Z',
  remove: 'm4 4 8 8M12 4l-8 8',
  file: 'M4 1.5h5l3.5 3.5v9.5H4Z M9 1.5V5h3.5',
  link: 'm6 10 4-4M6 5 8 3a3 3 0 0 1 4 4l-2 2M10 11l-2 2a3 3 0 0 1-4-4l2-2',
  copy: 'M5 5h8v9H5Z M10 5V2H2v9h3',
  search: 'M11.5 6.5a5 5 0 1 1-10 0 5 5 0 0 1 10 0Z M10 10l4 4',
  wrap: 'M2 3h12M2 7h9a3 3 0 0 1 0 6H8M10 11l-2 2 2 2M2 11h3',
  settings: 'M6 2h4l.5 2 2 .5 1 3.5-1.5 1.5.5 2-3 2-2-1-2 1-3-2 .5-2L1 8l1-3.5L4 4Zm4.5 6a2.5 2.5 0 1 0-5 0 2.5 2.5 0 0 0 5 0Z',
  fetch: 'M12 5a5 5 0 1 0 1 5M12 2v3H9',
  pull: 'M8 2v9M4.5 7.5 8 11l3.5-3.5M2 13v1h12v-1',
  push: 'M8 11V2M4.5 5.5 8 2l3.5 3.5M2 13v1h12v-1',
  conversation: 'M4 2.5h8A1.5 1.5 0 0 1 13.5 4v6a1.5 1.5 0 0 1-1.5 1.5H6L2.5 14V4A1.5 1.5 0 0 1 4 2.5Z M8 5v4M6 7h4',
  stage: 'M8 3v10M3 8h10',
  unstage: 'M3 8h10',
  unstageFile: 'M4 2.5h5l3 3v8H4Z M9 2.5v3h3 M6 9h4',
  revert: 'M6 3 2.5 6.5 6 10 M3 6.5h6a4 4 0 0 1 0 8H7',
  edit: 'm10.5 2.5 3 3M3 10l7.5-7.5a1 1 0 0 1 1.4 0l1.6 1.6a1 1 0 0 1 0 1.4L6 13l-3.5.5Z',
  save: 'M3 2.5h8l2.5 2.5v8.5h-11v-11Z M5 2.5v4h5v-4 M5 13.5V9h6v4.5',
  blame: 'M6 5a2 2 0 1 0-4 0 2 2 0 0 0 4 0Z M1.5 12v-1a2.5 2.5 0 0 1 5 0v1 M9 4h5M9 8h5M9 12h5',
  source: 'm5.5 4-4 4 4 4M10.5 4l4 4-4 4M9 2 7 14',
  image: 'M2 2.5h12v11H2Z M2 11l4-4 3 3 2-2 3 3 M11.5 5h.01',
  inline: 'M2 2.5h12v11H2Z M5 6h6M5 10h6',
  columns: 'M2 2.5h12v11H2Z M8 2.5v11',
  files: 'M2 2.5h12v11H2Z M6 2.5v11M3.5 5h1M3.5 8h1',
  back: 'M7 3 2 8l5 5M2 8h12',
  previous: 'm4 10 4-4 4 4',
  next: 'm4 6 4 4 4-4',
  changes: 'M4 1.5h5l3 3v10H4Z M9 1.5v3h3 M6 8h4M8 6v4',
  history: 'M2 3v4h4M2.2 6a6 6 0 1 1 .5 5M8 4v4l2.5 1.5',
  compare: 'M3 4h10l-3-3M13 12H3l3 3M13 4l-3 3M3 12l3-3',
  folder: 'M1.5 4h5l1.5 1.5h6v8h-12Z M1.5 4V2.5h5L8 4h6v1.5',
  more: 'M3 8h.01M8 8h.01M13 8h.01',
  refresh: 'M13 5a5.5 5.5 0 1 0 .5 5M13 1.5V5H9.5',
  chevron: 'm5 6 3 3 3-3',
  check: 'm3 8 3 3 7-7',
}

export function ActionGlyph({ icon }: { icon: ActionIcon }): ReactNode {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={icon === 'more' ? 2.6 : 1.4}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={paths[icon]} /></svg>
}

/** Shared toolbar hint; hiding it never consumes the next Escape gesture. */
export function IconActionButton({ icon, label, hint, shortcut, disabled = false, className = '', pressed, preserveSelection = false, onClick }: {
  icon: ActionIcon
  label: string
  hint?: string
  shortcut?: string
  disabled?: boolean
  className?: string
  pressed?: boolean
  preserveSelection?: boolean
  onClick: MouseEventHandler<HTMLButtonElement>
}): ReactNode {
  const inMenu = useContext(ActionMenuContext)
  const descriptionId = useId()
  const [hintDismissed, setHintDismissed] = useState(false)
  const [show, setShow] = useState<false | 'mouse' | 'focus'>(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const tipRef = useRef<HTMLSpanElement>(null)
  useEffect(() => { tipRef.current?.setAttribute('popover', 'manual') }, [])
  useEffect(() => {
    const tip = tipRef.current
    if (!show || hintDismissed || !tip || typeof tip.showPopover !== 'function') return
    const hide = (): void => setShow(false)
    const timer = setTimeout(() => {
      const button = buttonRef.current
      if (!button || !tip.isConnected) return
      tip.style.maxWidth = `${Math.min(280, window.innerWidth - 24)}px`
      tip.showPopover()
      const box = button.getBoundingClientRect()
      const placement = tooltipPlacement(box, tip.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight })
      tip.style.left = `${placement.left}px`
      tip.style.top = `${placement.top}px`
    }, show === 'focus' ? 0 : 300)
    document.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => {
      clearTimeout(timer)
      if (tip.matches(':popover-open')) tip.hidePopover()
      document.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
    }
  }, [show, hintDismissed, label, shortcut])
  if (inMenu) return <DropdownMenu.Item asChild disabled={disabled}><button type="button" className={`${css.toolbarMenuItem} ${className}`} disabled={disabled}
    title={hint} aria-label={label} onClick={onClick}><ActionGlyph icon={icon} /><span>{label}</span></button></DropdownMenu.Item>
  return (
    <span className={css.fileAddControl} onMouseEnter={() => setShow('mouse')} onMouseLeave={() => { setShow(false); setHintDismissed(false) }}>
      <button ref={buttonRef} type="button" className={`${css.treeIcon} ${css.fileAddButton} ${css.iconActionButton} ${className}`} disabled={disabled}
        aria-label={label} aria-describedby={hint === undefined ? undefined : descriptionId} aria-pressed={pressed}
        onFocus={() => setShow('focus')} onBlur={() => { setShow(false); setHintDismissed(false) }}
        onKeyDown={event => {
          if (event.key !== 'Escape' || hintDismissed) return
          event.preventDefault()
          event.stopPropagation()
          setHintDismissed(true)
        }}
        onMouseDown={preserveSelection ? event => event.preventDefault() : undefined}
        onClick={event => { setShow(false); setHintDismissed(true); onClick(event) }}>
        <ActionGlyph icon={icon} />
      </button>
      {hint === undefined ? null : <span id={descriptionId} className={css.fileAddDescription}>{hint}</span>}
      <span ref={tipRef} role="tooltip" className={css.fileAddTooltip} hidden={hintDismissed}>
        <span className={css.fileAddHint}><span>{label}</span>{shortcut ? <kbd>{shortcut}</kbd> : null}</span>
      </span>
    </span>
  )
}
