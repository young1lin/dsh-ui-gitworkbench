import { useEffect, useState } from 'react'

import { rowWindow, rowWindowForMount, sameRowWindow, type HeldRowWindow, type RowWindow } from './row-window.ts'

/* ---------- shared helpers ---------- */

/**
 * The rows a diff actually has to put in the DOM, tracked against its scroller.
 *
 * Rendering a whole file cost the pane 3.9 seconds of main thread and a
 * 3.6-second frozen frame at 4,000 lines — for a one-line change, because the
 * side-by-side view draws every line of the file whether it changed or not.
 * This is the fix that removes the length from the cost rather than capping it.
 *
 * The window is held in state rather than the raw scroll offset so a scroll
 * that does not move it renders nothing: `start` only changes once a whole row
 * has passed under the viewport's edge.
 *
 * @param scrollRef - the element that scrolls the rows.
 * @param rowCount - how many rows the diff has.
 * @returns the rows to render and the spacer heights standing in for the rest.
 */
export function useRowWindow(scrollRef: { current: HTMLElement | null }, rowCount: number, mountKey: string): RowWindow {
  const count = Number.isFinite(rowCount) ? Math.max(0, Math.trunc(rowCount)) : 0
  const [held, setHeld] = useState<HeldRowWindow>(() => ({
    mountKey, rowCount: count, win: rowWindow(0, 0, count),
  }))
  // A file can change while the scroller is temporarily unmounted by loading.
  // Do not paint the previous file's spacer for one frame — derive a fresh top
  // window immediately; the effect below replaces it with the measured one.
  const visible = rowWindowForMount(held, count, mountKey)
  useEffect(() => {
    const el = scrollRef.current
    if (el === null) return
    const read = (): void => {
      const next = rowWindow(el.scrollTop, el.clientHeight, count)
      setHeld(prev => prev.mountKey === mountKey && prev.rowCount === count && sameRowWindow(prev.win, next)
        ? prev
        : { mountKey, rowCount: count, win: next })
    }
    read()
    // Passive: this listener never calls preventDefault, and saying so keeps
    // it off the scroll's critical path.
    el.addEventListener('scroll', read, { passive: true })
    // The drawer resizes without the page doing so — a dragged edge, the
    // maximize button — and a taller pane needs more rows.
    const observer = new ResizeObserver(read)
    observer.observe(el)
    return () => {
      el.removeEventListener('scroll', read)
      observer.disconnect()
    }
  }, [scrollRef, count, mountKey])
  return visible
}
