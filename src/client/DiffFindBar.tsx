/**
 * The unified diff pane's find bar, and the glyphs the pane's toolbar shares
 * with it.
 *
 * Rendering only: what the bar shows and which handler each control calls.
 * The state behind it is `use-diff-find.ts`, the rules `diff-find.ts`. The
 * split keeps `DiffViews.tsx` within the size the module guard allows, and
 * keeps this reviewable as one control.
 *
 * @module @young1lin/dsh-ui-gitworkbench/client/DiffFindBar
 */

import type { ReactNode } from 'react'

import { formatHits } from './diff-find.ts'
import type { DiffFind } from './use-diff-find.ts'
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
