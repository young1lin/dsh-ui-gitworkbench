import { useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'

import css from './GitWorkbenchPanel.module.css'

/**
 * One pointer-captured horizontal drag, shared by the drawer's leading edge and
 * both pane dividers.
 *
 * Pointer capture is what keeps a drag alive over every pane and past the window
 * edge; a plain mousemove listener on the handle loses it as soon as the pointer
 * crosses a child that stops propagation.
 * @returns the active flag for styling, and the pointerdown handler to attach.
 */
export function usePaneDrag(axis: 'x' | 'y' = 'x'): {
  dragging: boolean
  start: (event: ReactPointerEvent<HTMLElement>, onDrag: (position: number, done: boolean) => void) => void
} {
  const along = (event: { clientX: number; clientY: number }): number =>
    axis === 'y' ? event.clientY : event.clientX
  const [dragging, setDragging] = useState(false)
  const start = (event: ReactPointerEvent<HTMLElement>, onDrag: (position: number, done: boolean) => void): void => {
    event.preventDefault()
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    setDragging(true)
    const onMove = (move: PointerEvent): void => { onDrag(along(move), false) }
    // `pointercancel` ends a drag the browser took over (a touch became a
    // gesture, the window lost focus). It releases capture itself, so only the
    // pointerup path releases — and both must detach, or the next drag stacks a
    // second set of listeners on the same handle.
    const finish = (end: PointerEvent): void => {
      if (end.type === 'pointerup') {
        onDrag(along(end), true)
        handle.releasePointerCapture(end.pointerId)
      }
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', finish)
      handle.removeEventListener('pointercancel', finish)
      setDragging(false)
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', finish)
    handle.addEventListener('pointercancel', finish)
  }
  return { dragging, start }
}

/**
 * Drag handle between two panes.
 * @param label - accessible name.
 * @param onDrag - receives the pointer's x and whether the drag just ended.
 * @returns the divider element.
 */
export function PaneDivider({ label, onDrag, axis = 'x' }: {
  label: string
  /** clientX for an 'x' handle, clientY for a 'y' one. */
  onDrag: (position: number, done: boolean) => void
  /** Which way the handle moves. 'y' is the History tab's stacked split. */
  axis?: 'x' | 'y'
}): ReactNode {
  const { dragging, start } = usePaneDrag(axis)
  const base = axis === 'y' ? `${css.paneDivider} ${css.paneDividerY}` : css.paneDivider
  return (
    <div
      className={dragging ? `${base} ${css.paneDividerActive}` : base}
      role="separator"
      // The orientation a separator reports is the axis it SEPARATES along,
      // which is the opposite of the one it slides on.
      aria-orientation={axis === 'y' ? 'horizontal' : 'vertical'}
      aria-label={label}
      onPointerDown={event => start(event, onDrag)}
    />
  )
}
