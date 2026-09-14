/**
 * The windowed diff panes' find bar, the toolbar toggle that opens it, the
 * glyphs the toolbars share with it — and the seat the side-by-side pane
 * gives the armed editor's CodeMirror panel instead.
 *
 * Rendering only: what the bar shows and which handler each control calls.
 * The state behind it is `use-diff-find.ts`, the rules `diff-find.ts`. The
 * split keeps `DiffViews.tsx` within the size the module guard allows, and
 * keeps this reviewable as one control.
 *
 * @module @young1lin/dsh-ui-gitworkbench/client/DiffFindBar
 */

import type { ReactNode, RefObject } from 'react'

import { formatHits } from './diff-find.ts'
import type { DiffFind } from './use-diff-find.ts'
import { useScrollGutter } from './use-scroll-gutter.ts'
import type { Translate } from './git-workbench-types.ts'
import css from './GitWorkbenchPanel.module.css'

/**
 * Change-to-change navigation as two chevrons, and find as a magnifier.
 *
 * Bootstrap Icons, at the same 16 viewBox — a pair of arrows is what every
 * editor spells this with, and the words would be longer than the controls
 * beside them.
 */
const NAV_GLYPH = {
  prev: 'M7.646 4.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1-.708.708L8 5.707l-5.646 5.647a.5.5 0 0 1-.708-.708l6-6z',
  next: 'M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708z',
  // Bootstrap's `search`: the one glyph every editor spells "find" with.
  find: 'M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z',
} as const

export function NavGlyph({ of }: { of: keyof typeof NAV_GLYPH }): ReactNode {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d={NAV_GLYPH[of]} />
    </svg>
  )
}

/** The bar itself: field, count, walk, close. Enter / Shift+Enter / Escape
 *  are the field's (`onInputKeyDown`); the buttons are for the pointer. */
export function DiffFindBar({ find, t }: { find: DiffFind; t: Translate }): ReactNode {
  const finding = find.query.trim().length > 0
  const none = find.index.hits.length === 0
  return (
    <div className={css.findBar} role="search">
      <input
        ref={find.inputRef}
        className={css.findField}
        type="text"
        value={find.query}
        onChange={event => { find.setQuery(event.target.value) }}
        onKeyDown={find.onInputKeyDown}
        placeholder={t('findInDiff')}
        aria-label={t('findInDiff')}
        spellCheck={false}
        autoComplete="off"
      />
      {/* Stays up while a recount is pending rather than blanking: the number
          it replaces is a near neighbour of the one arriving. */}
      <span className={css.sideNavCount} aria-live="polite">
        {finding ? formatHits(find.index, find.current) : ''}
      </span>
      <button type="button" className={css.blockBtn} title={t('findPrev')} aria-label={t('findPrev')} disabled={none} onClick={() => { find.step(-1) }}><NavGlyph of="prev" /></button>
      <button type="button" className={css.blockBtn} title={t('findNext')} aria-label={t('findNext')} disabled={none} onClick={() => { find.step(1) }}><NavGlyph of="next" /></button>
      <button type="button" className={css.blockBtn} title={t('findClose')} aria-label={t('findClose')} onClick={find.close}>×</button>
    </div>
  )
}

/** The toolbar's magnifier: opens the bar, or closes it when it is up. The
 *  same control in both panes, so the reader learns it once. */
export function FindToggle({ find, t }: { find: DiffFind; t: Translate }): ReactNode {
  return (
    <button
      type="button"
      className={css.blockBtn}
      title={t('findHint')}
      aria-label={t('findInDiff')}
      aria-pressed={find.open}
      onClick={() => { if (find.open) find.close(); else find.show() }}
    ><NavGlyph of="find" /></button>
  )
}

/**
 * Where the armed editor's Ctrl/Cmd+F panel sits: a row above the scroller,
 * with the panel's host over the WORKING-TREE column and nothing over the
 * other — the panel searches the buffer, and a strip across both columns
 * would claim to search both.
 *
 * Left inside the column, the panel rides away with line 1: CodeMirror mounts
 * it with `position: sticky`, sticky resolves against the nearest scroll
 * container, and the column (`overflow-x: auto`) is one that never scrolls
 * vertically. So the editor is handed this host through `panels({
 * topContainer })` (`panelHost` in CodeEditor.tsx) instead.
 *
 * The row mirrors `.sideCols`: a `split%` spacer for the left column, a gap
 * the width of `.paneDivider`, and the host for the rest — minus the
 * scroller's own scrollbar on the right, which the columns inside it never
 * had. The host is empty until the panel opens, and empty is zero height.
 */
export function SideFindSeat({ hostRef, scrollRef, split }: {
  hostRef: RefObject<HTMLDivElement>
  scrollRef: RefObject<HTMLDivElement>
  /** The divider's position, as a fraction of the columns' width. */
  split: number
}): ReactNode {
  const gutter = useScrollGutter(scrollRef)
  return (
    <div className={css.sideFindRow} style={{ paddingRight: gutter }}>
      <span className={css.sideFindSpacer} style={{ flexBasis: `${split * 100}%` }} />
      <span className={css.sideFindGap} />
      <div ref={hostRef} className={css.sideFindHost} />
    </div>
  )
}
