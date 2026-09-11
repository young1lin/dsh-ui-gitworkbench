/**
 * Find in the unified diff pane — the wiring half of `diff-find.ts`.
 *
 * The rules (what matches, which hit is next, where a fresh query lands) are
 * pure and live next door. What is left is what cannot be: the timer that
 * keeps the walk off the keystroke path, the scroll that brings a hit into
 * view, and the keys.
 *
 * The walk is deferred by the same idle the editor's count uses
 * (`REPAINT_IDLE_MS` in CodeEditor.tsx — 180ms): a query grows a character at
 * a time, and walking a 20,000-row diff on each of them is the O(document)
 * keystroke this drawer does not have. Painting the hits on screen is NOT
 * deferred — it is per visible row, so it costs the viewport — which is what
 * lets the highlight follow the typing while the count follows the pause.
 *
 * @module @young1lin/dsh-ui-gitworkbench/client/use-diff-find
 */

import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MutableRefObject, type RefObject } from 'react'

import { EMPTY_FIND, findInTexts, nearestHit, stepHit, type FindHit, type FindIndex } from './diff-find.ts'
import { scrollTopFor } from './diff-nav.ts'
import { DIFF_GRID_PAD_TOP, DIFF_ROW_H } from './row-window.ts'

/** How long the typing has to pause before the diff is walked. */
const FIND_IDLE_MS = 180

/** What the pane renders from. */
export interface DiffFind {
  readonly open: boolean
  readonly query: string
  readonly index: FindIndex
  /** Index into `index.hits` of the hit the reader is on; -1 for none. */
  readonly current: number
  /** The hit itself, for the row that draws it apart. */
  readonly currentHit: FindHit | null
  readonly inputRef: RefObject<HTMLInputElement>
  readonly setQuery: (query: string) => void
  readonly show: () => void
  readonly close: () => void
  readonly step: (direction: 1 | -1) => void
  /** Ctrl/Cmd+F anywhere in the pane opens the bar. */
  readonly onPaneKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void
  /** Enter / Shift+Enter walk, Escape closes — the editor panel's keys. */
  readonly onInputKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void
}

/**
 * @param texts - every row's text, in order. A new identity means a new diff.
 * @param scrollRef - the element that scrolls the rows.
 * @param firstRow - the first row currently rendered, so a fresh query lands
 *   near what the reader is looking at rather than at the top.
 * @param rowTop - where a row sits when soft wrap is on; absent, rows are
 *   `DIFF_ROW_H` tall and the arithmetic is exact.
 */
export function useDiffFind(
  texts: readonly string[],
  scrollRef: MutableRefObject<HTMLDivElement | null>,
  firstRow: number,
  rowTop: MutableRefObject<((index: number) => number) | undefined>,
): DiffFind {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState<FindIndex>(EMPTY_FIND)
  const [current, setCurrent] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  // Read when the walk lands, not when it is scheduled: the reader may have
  // scrolled during the pause.
  const firstRowRef = useRef(firstRow)
  firstRowRef.current = firstRow

  // The walk, deferred. Closing or blanking the query clears at once — there
  // is nothing to compute and a stale count under an empty field is noise.
  useEffect(() => {
    if (!open || query.trim().length === 0) {
      setIndex(EMPTY_FIND)
      setCurrent(-1)
      return
    }
    const id = window.setTimeout(() => {
      const found = findInTexts(texts, query)
      setIndex(found)
      setCurrent(nearestHit(found.hits, firstRowRef.current))
    }, FIND_IDLE_MS)
    return () => { window.clearTimeout(id) }
  }, [open, query, texts])

  // Bring the current hit into view, when it is not already. A hit the reader
  // can see is left where it is: jumping the scroll under a visible match
  // reads as the pane losing its place.
  useEffect(() => {
    const scroller = scrollRef.current
    const hit = index.hits[current]
    if (scroller === null || hit === undefined) return
    const top = DIFF_GRID_PAD_TOP + (rowTop.current === undefined ? hit.row * DIFF_ROW_H : rowTop.current(hit.row))
    const seenFrom = scroller.scrollTop
    const seenTo = seenFrom + scroller.clientHeight - DIFF_ROW_H
    if (top >= seenFrom && top <= seenTo) return
    scroller.scrollTop = scrollTopFor(top)
  }, [index, current, scrollRef, rowTop])

  // Focus the field when the bar opens — the whole point of the shortcut —
  // and select what is in it, so a second Ctrl+F retypes rather than appends.
  useEffect(() => {
    if (!open) return
    const field = inputRef.current
    if (field === null) return
    field.focus()
    field.select()
  }, [open])

  const show = useCallback(() => {
    setOpen(true)
    // Already open: focus again, the way the editor panel's shortcut does.
    const field = inputRef.current
    if (field !== null) { field.focus(); field.select() }
  }, [])

  const close = useCallback(() => {
    setOpen(false)
    // Hand focus back to the pane, so F7 and the arrow keys keep working
    // where the reader left off instead of on the document body.
    scrollRef.current?.focus()
  }, [scrollRef])

  const step = useCallback((direction: 1 | -1) => {
    setCurrent(prev => stepHit(index.hits.length, prev, direction))
  }, [index])

  const onPaneKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && (event.key === 'f' || event.key === 'F')) {
      event.preventDefault()
      show()
    }
  }, [show])

  const onInputKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      step(event.shiftKey ? -1 : 1)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      close()
    }
  }, [step, close])

  return {
    open, query, index, current,
    currentHit: index.hits[current] ?? null,
    inputRef, setQuery, show, close, step, onPaneKeyDown, onInputKeyDown,
  }
}
