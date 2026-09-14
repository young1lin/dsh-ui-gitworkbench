/**
 * How much of a scroller's width its vertical scrollbar takes.
 *
 * A row laid out ABOVE `.sideScroll` is as wide as the pane, but the columns
 * inside the scroller share only its client width — the drawer paints a
 * classic 10px scrollbar (controls.css) once the file is taller than the
 * viewport, and none before. Anything above that must line up with a column
 * (the armed editor's find panel, over the working-tree column) has to give
 * that width back on the right, or a `split%` spacer lands `split × 10px`
 * short of the column edge.
 *
 * Measured rather than restated from the stylesheet: the gutter comes and
 * goes with the file's height, and a ResizeObserver on the scroller sees
 * exactly that — a scrollbar appearing shrinks the CONTENT box it reports.
 *
 * @module @young1lin/dsh-ui-gitworkbench/client/use-scroll-gutter
 */

import { useEffect, useState, type RefObject } from 'react'

/**
 * @param scrollRef - the element whose vertical scrollbar is measured.
 * @returns px the scrollbar occupies; 0 while there is none.
 */
export function useScrollGutter(scrollRef: RefObject<HTMLElement>): number {
  const [gutter, setGutter] = useState(0)
  useEffect(() => {
    const scroller = scrollRef.current
    if (scroller === null) return
    const measure = (): void => { setGutter(scroller.offsetWidth - scroller.clientWidth) }
    const observer = new ResizeObserver(measure)
    observer.observe(scroller)
    measure()
    return () => { observer.disconnect() }
  }, [scrollRef])
  return gutter
}
