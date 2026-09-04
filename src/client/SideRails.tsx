import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import css from './GitWorkbenchPanel.module.css'
import { NO_RAIL, railsShown, sameMetric, type RailMetric } from './h-rail.ts'

/** A column and the rail that scrolls it, as the DOM hands them over. */
type Box = { current: HTMLElement | null }

/**
 * Measure one column and keep its rail's scroll position tied to it.
 *
 * The measurement runs on EVERY render rather than on a dependency list: the
 * content width changes for reasons no list can name — a window scrolled to
 * longer rows, syntax spans replacing plain text, the editor mounting into the
 * right column, wrap turning on. Two integer reads is a cheap price for never
 * being stale, and {@link sameMetric} is what keeps setting state on every
 * render from becoming a render on every render.
 *
 * @param colRef - the column, which clips and scrolls its own content.
 * @param railRef - the strip at the bottom of the pane that stands in for it.
 * @returns the column's measured widths.
 */
function useRail(colRef: Box, railRef: Box): RailMetric {
  const [metric, setMetric] = useState<RailMetric>(NO_RAIL)

  const measure = (col: HTMLElement): void => {
    const next = { view: col.clientWidth, content: col.scrollWidth }
    setMetric(prev => sameMetric(prev, next) ? prev : next)
  }

  useLayoutEffect(() => {
    const col = colRef.current
    if (col !== null) measure(col)
  })

  // A pane resized without a re-render — the drawer's own edge dragged, the
  // window resized — changes what fits without changing what is rendered.
  useEffect(() => {
    const col = colRef.current
    if (col === null) return
    const observer = new ResizeObserver(() => { measure(col) })
    observer.observe(col)
    return () => { observer.disconnect() }
  }, [colRef])

  // Two-way, because both ends are real scrollers: the rail is what the reader
  // drags, and the column still scrolls on its own from a trackpad swipe or a
  // shift-wheel over the code. Each writes only when the value differs, which
  // is what stops the pair from echoing a scroll back and forth forever.
  useEffect(() => {
    const col = colRef.current
    const rail = railRef.current
    if (col === null || rail === null) return
    const toRail = (): void => { if (rail.scrollLeft !== col.scrollLeft) rail.scrollLeft = col.scrollLeft }
    const toCol = (): void => { if (col.scrollLeft !== rail.scrollLeft) col.scrollLeft = rail.scrollLeft }
    col.addEventListener('scroll', toRail, { passive: true })
    rail.addEventListener('scroll', toCol, { passive: true })
    toRail()
    return () => {
      col.removeEventListener('scroll', toRail)
      rail.removeEventListener('scroll', toCol)
    }
  }, [colRef, railRef])

  return metric
}

/**
 * The side-by-side pane's horizontal scrollbars, stuck to the bottom of the
 * pane instead of the bottom of the file — see `h-rail.ts` for why they are
 * here at all.
 *
 * Always rendered, never conditionally: the strip collapses to nothing through
 * a class when neither column overflows, so both rails keep their elements and
 * the effects above keep stable dependencies. A rail that mounted and
 * unmounted with the measurement would re-attach its listeners on every file.
 *
 * @param leftRef - the left column.
 * @param rightRef - the right column.
 * @param split - the divider's position, as a fraction of the pane's width;
 *                the rails carry the same flex sizing so each sits under the
 *                column it scrolls.
 * @returns the sticky rail strip.
 */
export function SideRails({ leftRef, rightRef, split }: {
  leftRef: Box
  rightRef: Box
  split: number
}): ReactNode {
  const leftRailRef = useRef<HTMLDivElement>(null)
  const rightRailRef = useRef<HTMLDivElement>(null)
  const left = useRail(leftRef, leftRailRef)
  const right = useRail(rightRef, rightRailRef)
  const shown = railsShown(left, right)
  return (
    <div className={shown ? `${css.sideRails} ${css.sideRailsOn}` : css.sideRails} aria-hidden="true">
      <div ref={leftRailRef} className={css.sideRail} style={{ flexBasis: `${split * 100}%` }}>
        <div className={css.sideRailSpan} style={{ width: left.content }} />
      </div>
      <div className={css.sideRailGap} />
      <div ref={rightRailRef} className={`${css.sideRail} ${css.sideRailRight}`}>
        <div className={css.sideRailSpan} style={{ width: right.content }} />
      </div>
    </div>
  )
}
