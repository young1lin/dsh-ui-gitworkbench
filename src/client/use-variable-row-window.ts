/**
 * The windowing hook for panes whose rows are not all one height — a diff
 * pane with soft wrap on.
 *
 * The fixed-height hook beside this one (`use-row-window.ts`) needs nothing
 * from the DOM but the scroll offset, because `i * 20px` is the answer. Once
 * lines wrap, only the DOM knows how tall a row came out, so this one measures
 * — and measures ONLY the rows it just rendered, which is the window plus its
 * overscan. Every other row carries an estimate computed from its text, so the
 * scrollbar is close from the first paint instead of growing as the reader
 * scrolls.
 *
 * A measurement that replaces an estimate for a row ABOVE the viewport moves
 * everything below it, including what the reader is looking at. The scroll
 * offset is corrected by the same delta in the same layout pass, so the rows
 * on screen stay under the eye rather than sliding.
 *
 * @module @young1lin/dsh-ui-gitworkbench/client/use-variable-row-window
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'

import { RowHeights, estimateRowHeight, variableRowWindow } from './row-heights.ts'
import { DIFF_ROW_H, sameRowWindow, type RowWindow } from './row-window.ts'

/** Attribute a pane puts on each measurable element, as `scope:index`. */
export const ROW_INDEX_ATTR = 'data-gw-row'

/**
 * What a pane writes on an element it wants measured.
 *
 * The scope is half the value rather than a second attribute because two
 * height models can be mounted inside one scroller — the aligned diff and the
 * dense index column beside the editor — and a bare index would let each read
 * the other's rows as its own.
 *
 * @param scope - which height model the element belongs to.
 * @param index - the row's index WITHIN that model.
 */
export function rowMark(scope: string, index: number): Record<string, string> {
  return { [ROW_INDEX_ATTR]: `${scope}:${index}` }
}

/**
 * Columns that fit across a pane, from its width and one character's advance.
 *
 * Measured off a probe rather than assumed: the panes' font size is a theme
 * variable a reader can change, so a hard-coded character width would put the
 * estimate out by a third on the smallest setting.
 *
 * @param grid - the element the rows are laid out in.
 * @returns columns across, or 0 when the element is not laid out yet.
 */
export function columnsAcross(grid: HTMLElement | null): number {
  if (grid === null) return 0
  const width = grid.clientWidth
  if (!Number.isFinite(width) || width <= 0) return 0
  const probe = document.createElement('span')
  probe.textContent = '0'.repeat(100)
  probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;pointer-events:none'
  grid.appendChild(probe)
  const advance = probe.getBoundingClientRect().width / 100
  probe.remove()
  if (!Number.isFinite(advance) || advance <= 0) return 0
  return Math.max(1, Math.floor(width / advance))
}

/** What a pane needs from this hook: the rows to render, where any row starts
 *  — the change walk jumps to rows that are not in the DOM, so it cannot ask
 *  the DOM where they are — and how tall each one came out. */
export interface FlowWindow {
  readonly win: RowWindow
  readonly rowTop: (index: number) => number
  /**
   * How tall a row came out — what the side-by-side pane imposes as a
   * `min-height` on BOTH of a row's cells.
   *
   * Two aligned columns are two separate grids, because a single grid's tracks
   * are sized by the widest line in the file and a divider dragged across one
   * would move nothing. Separate grids align only while every row is the same
   * height in both, which soft wrap ends: the left cell can wrap to three lines
   * and the right to one. Giving both the tallest side's height puts the rows
   * back in step without merging the grids.
   */
  readonly rowHeight: (index: number) => number
}

export function useVariableRowWindow({
  scrollRef, rowsRef, widthRef, texts, mountKey, scope, enabled, rowH = DIFF_ROW_H,
}: {
  /** The element that scrolls the rows. */
  scrollRef: { current: HTMLElement | null }
  /** The subtree the measurable rows live in. For an aligned diff this is the
   *  element holding BOTH columns, since a row's height is the taller side. */
  rowsRef: { current: HTMLElement | null }
  /** What the wrap width is measured from; defaults to `rowsRef`. Separate
   *  because the element holding both columns is twice as wide as the column
   *  a line actually wraps inside. */
  widthRef?: { current: HTMLElement | null }
  /** One string per row, for the estimate. Identity matters: a new array
   *  rebuilds the heights, so callers must memoize it. */
  texts: readonly string[]
  /** Identifies the mounted diff; a new one starts over. */
  mountKey: string
  /** Which rows in `rowsRef` are this model's — see {@link rowMark}. */
  scope: string
  /** Whether wrapping is on. When it is not, this hook attaches nothing and
   *  allocates nothing: the pane uses the fixed-height window beside it, and
   *  paying for a Fenwick tree over 20,000 rows to answer `i * 20` would be a
   *  regression on the path that was never broken. */
  enabled: boolean
  /** One line's height in px. */
  rowH?: number
}): FlowWindow {
  /** Columns across the pane. State, because the estimate depends on it and a
   *  dragged divider changes it. */
  const [columns, setColumns] = useState(0)
  /**
   * Bumped when a measurement moved a row.
   *
   * The heights live in a mutable structure, so changing one changes no
   * identity React watches — and the side-by-side pane reads them DURING
   * render, to impose each row's height on both of its cells. Without this
   * the first pass would measure correctly and then never re-render to apply
   * what it measured, which is a row that is one line taller on one side than
   * on the other. Bumped only when something actually moved, and imposing a
   * height does not change what is measured (the measured box is inside the
   * cell), so it settles in one extra pass.
   */
  const [, bumpHeights] = useState(0)
  const [win, setWin] = useState<RowWindow>(() => ({ start: 0, end: texts.length, padTop: 0, padBottom: 0 }))

  /** Rebuilt only when the diff or the width really changes — never on scroll. */
  const heights = useMemo(
    () => new RowHeights(enabled ? texts.map(text => estimateRowHeight(text, columns, rowH)) : []),
    // `mountKey` is in the list on purpose: two diffs can have identical text
    // arrays by identity only if they are the same diff.
    [texts, columns, rowH, mountKey, enabled],
  )

  const read = useCallback((): void => {
    const el = scrollRef.current
    if (el === null || heights.count === 0) return
    const next = variableRowWindow(el.scrollTop, el.clientHeight, heights)
    setWin(prev => sameRowWindow(prev, next) ? prev : next)
  }, [scrollRef, heights])

  // Scroll and resize. Passive: this listener never calls preventDefault, and
  // saying so keeps it off the scroll's critical path.
  useEffect(() => {
    const el = scrollRef.current
    if (el === null || !enabled) return
    read()
    const observer = new ResizeObserver(() => {
      read()
      setColumns(prev => {
        const measured = columnsAcross((widthRef ?? rowsRef).current)
        return measured === 0 || measured === prev ? prev : measured
      })
    })
    el.addEventListener('scroll', read, { passive: true })
    observer.observe(el)
    return () => {
      el.removeEventListener('scroll', read)
      observer.disconnect()
    }
  }, [scrollRef, rowsRef, widthRef, read, enabled])

  // What the rows actually came out as. Layout effect because the correction
  // below must land in the same frame as the paint that needs it — a scroll
  // offset fixed one frame late is a visible jump.
  useLayoutEffect(() => {
    const root = rowsRef.current
    const scroller = scrollRef.current
    if (!enabled || root === null || scroller === null) return
    const before = heights.topAt(win.start)
    // A row can have several measured elements — the two sides of an aligned
    // diff — and the row is as tall as the tallest of them. Collected first,
    // then written: writing each as it is read would leave the row at whichever
    // side the DOM happened to list last.
    const tallest = new Map<number, number>()
    for (const node of root.querySelectorAll<HTMLElement>(`[${ROW_INDEX_ATTR}^="${scope}:"]`)) {
      const index = Number(node.getAttribute(ROW_INDEX_ATTR)?.slice(scope.length + 1))
      if (!Number.isInteger(index)) continue
      tallest.set(index, Math.max(tallest.get(index) ?? 0, node.getBoundingClientRect().height))
    }
    let moved = false
    for (const [index, height] of tallest) {
      if (heights.set(index, height)) moved = true
    }
    if (!moved) return
    // Rows above the viewport that turned out taller (or shorter) than their
    // estimate move the whole document under the reader. Give the scroller the
    // same delta back, so the row they were looking at stays where it was.
    const after = heights.topAt(win.start)
    if (after !== before) scroller.scrollTop += after - before
    bumpHeights(version => version + 1)
    read()
  })

  const rowTop = useCallback(
    (index: number) => enabled ? heights.topAt(index) : Math.max(0, Math.trunc(index)) * rowH,
    [enabled, heights, rowH],
  )
  const rowHeight = useCallback(
    (index: number) => enabled ? heights.heightAt(index) : rowH,
    [enabled, heights, rowH],
  )
  return { win, rowTop, rowHeight }
}
