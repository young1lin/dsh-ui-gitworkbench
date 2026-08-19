/**
 * The drawer's two node glyphs, shared by every view that names a file or a
 * directory: the changes tree behind all three file tabs, the history filter's
 * path picker, and the Files tab's repository browser. They live in their own
 * module because the browser needs them too, and importing a value out of the
 * panel that imports the browser would be a cycle.
 *
 * @module @young1lin/dsh-ui-gitworkbench/client/glyphs
 */

import type { ReactNode } from 'react'

import css from './GitWorkbenchPanel.module.css'

/**
 * The two node glyphs, in IntelliJ's New UI icon idiom: a 16px grid, 1px
 * strokes, no fill, rounded joins — outlines, where the old UI shipped filled
 * silhouettes. Hand-drawn here rather than imported, because the bundle purity
 * gate forbids an icon package and the drawer needs exactly these two; they
 * are shapes in that language, not JetBrains' own assets.
 *
 * `strokeWidth` is 1 against a viewBox that renders 1:1 at 16px, so every
 * stroke lands on a whole pixel instead of straddling two.
 *
 * Every place the drawer names a file or a directory uses these: the path
 * picker in the history filter, and the file tree behind all three tabs. The
 * CLASS names keep their `path` prefix — `scripts/verify_history_feature.py`
 * selects the picker's file rows by `label:has([class*="pathFileGlyph"])`.
 */
export function PathDirGlyph(): ReactNode {
  return (
    <svg
      className={css.pathDirGlyph}
      width="16" height="16" viewBox="0 0 16 16"
      fill="none" stroke="currentColor" strokeWidth="1"
      strokeLinejoin="round" strokeLinecap="round"
      aria-hidden="true"
    >
      {/* Body, with the tab stepping up over the left third. The step is a
          full 2px: at 1.3px it read as a rounded rectangle with a nick in it
          rather than a folder. Every straight edge sits on a .5 coordinate so
          a 1px stroke lands on one pixel instead of straddling two. */}
      <path d="M2.5 12.75V4.25A.75.75 0 0 1 3.25 3.5H6l1.6 2h5.15A.75.75 0 0 1 13.5 6.25v6.5a.75.75 0 0 1-.75.75H3.25a.75.75 0 0 1-.75-.75Z" />
    </svg>
  )
}

export function PathFileGlyph(): ReactNode {
  return (
    <svg
      className={css.pathFileGlyph}
      width="16" height="16" viewBox="0 0 16 16"
      fill="none" stroke="currentColor" strokeWidth="1"
      strokeLinejoin="round" strokeLinecap="round"
      aria-hidden="true"
    >
      {/* Sheet, cut back at the top-right for the fold. Narrower and one step
          taller than the folder, sharing its optical band, so the two never
          look like different-sized icons in one column. */}
      <path d="M3.5 12.75V3.25A.75.75 0 0 1 4.25 2.5H9l3.5 3.5v6.75a.75.75 0 0 1-.75.75H4.25a.75.75 0 0 1-.75-.75Z" />
      {/* The fold itself — the corner turned back on the sheet. */}
      <path d="M9 2.5v2.75a.75.75 0 0 0 .75.75h2.75" />
    </svg>
  )
}
