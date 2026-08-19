/**
 * Blame as a CodeMirror gutter.
 *
 * The side-by-side pane could render blame as one more column of its CSS grid,
 * because there the file is a grid of rows the pane itself lays out. In the
 * file browser the file IS the editor — CodeMirror owns the lines, renders
 * only the viewport, and re-renders it on every scroll — so the annotation has
 * to live where the line numbers live: in a gutter.
 *
 * The wording is {@link blameLabel} and {@link blameTitle}, the same pure
 * functions the diff pane used, so both views abbreviate a sha and format a
 * date identically and only one of them is worth testing.
 *
 * The gutter sits in a {@link blameCompartment} so it can be added and removed
 * from a live view: an always-installed gutter returning no markers still
 * reserves its column, and a blank strip beside the code is exactly what the
 * toggle exists to avoid.
 *
 * @module @young1lin/dsh-ui-gitworkbench/client/blame-gutter
 */

import { Compartment, StateEffect, StateField, type Extension } from '@codemirror/state'
import { gutter, GutterMarker } from '@codemirror/view'

import { blameLabel, blameTitle } from './blame-view.ts'
import type { BlameLine } from './GitWorkbenchPanel.tsx'

/** Carries a fetched blame — or null for "not showing" — into the view. */
export const setBlame = StateEffect.define<readonly BlameLine[] | null>()

/**
 * The blame the gutter reads. Held in state rather than in a closure so a
 * marker can be computed from a transaction alone, which is what CodeMirror
 * hands the gutter when it re-renders a scrolled viewport.
 */
export const blameField = StateField.define<readonly BlameLine[] | null>({
  create: () => null,
  update(held, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setBlame)) return effect.value
    }
    return held
  },
})

/** Swaps the gutter itself in and out; the field above stays installed. */
export const blameCompartment = new Compartment()

/** One line's annotation. */
class BlameMarker extends GutterMarker {
  constructor(private readonly text: string, private readonly hover: string) {
    super()
  }

  /** CodeMirror reuses a marker's DOM when this says the two are the same. */
  override eq(other: BlameMarker): boolean {
    return other.text === this.text && other.hover === this.hover
  }

  override toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'cm-gwBlameCell'
    span.textContent = this.text
    if (this.hover.length > 0) span.title = this.hover
    return span
  }
}

/** Reserves the column's width so the code does not shift as lines scroll by.
 *  Names have no fixed width, so this is a plausible one and the cell's CSS
 *  ellipsises anything longer — a gutter that resized itself as the viewport
 *  scrolled past a long name would shift the code under the reader. */
const SPACER = new BlameMarker('nnnnnnnnnnnn', '')

/**
 * The gutter extension.
 * @param notCommitted - the drawer's own wording for a line with no commit
 *                       behind it; git's English is never passed through.
 * @param onPick - called with the 1-based line number the reader clicked.
 */
export function blameGutter(notCommitted: string, onPick: (line: number) => void): Extension {
  return gutter({
    class: 'cm-gwBlameGutter',
    domEventHandlers: {
      // Picking a line is how the commit behind it is reached: the gutter
      // shows the person, and the hash, the timestamp and the subject belong
      // to the moment the reader has decided this is the line they care about.
      click(view, line) {
        onPick(view.state.doc.lineAt(line.from).number)
        return true
      },
    },
    lineMarker(view, line) {
      const lines = view.state.field(blameField, false)
      if (lines === null || lines === undefined) return null
      const number = view.state.doc.lineAt(line.from).number
      const entry = lines[number - 1]
      const text = blameLabel(entry, notCommitted)
      return text === '' ? null : new BlameMarker(text, blameTitle(entry, notCommitted))
    },
    initialSpacer: () => SPACER,
  })
}
