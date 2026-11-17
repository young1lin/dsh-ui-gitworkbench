import { getChunks, getOriginalDoc } from '@codemirror/merge'
import { EditorView } from '@codemirror/view'
import type { WorkbenchReference } from './workbench-reference.ts'
import { savedHunkRanges, savedSelectionRange, type SourceRange } from './reference-reveal.ts'

const requests = new WeakMap<EditorView, number>()
function select(view: EditorView, range: SourceRange): void {
  view.dispatch({ selection: { anchor: range.from, head: range.to }, effects: EditorView.scrollIntoView(range.from, { y: 'center' }) })
}

/** Reuse the retained editor and its undo history; only selection and scrolling change. */
export function revealEditorReference(view: EditorView, target: WorkbenchReference, inline: boolean,
  removed: ReadonlyMap<EditorView, number>, lineOffset = 0): boolean {
  if (target.code === undefined && !target.deleted && target.view.kind === 'working' && target.file?.kind === 'file') return true
  const next = savedSelectionRange(view.state.doc, target, 'new', lineOffset)
  const original = inline && getChunks(view.state) ? getOriginalDoc(view.state) : null
  const hunk = original ? savedHunkRanges(original, view.state.doc, target) : null
  const current = next ?? (hunk?.new.from !== hunk?.new.to ? hunk?.new : null)
  const generation = (requests.get(view) ?? 0) + 1
  if (current) { requests.set(view, generation); select(view, current); return true }
  if (!original) return false
  const old = savedSelectionRange(original, target, 'old') ?? hunk?.old
  if (!old || old.from >= old.to) return false
  const chunks = getChunks(view.state)?.chunks ?? []
  let lo = 0, hi = chunks.length
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (chunks[mid]!.fromA <= old.from) lo = mid + 1; else hi = mid }
  const chunk = chunks[lo - 1]
  if (!chunk || old.to > chunk.endA) return false
  requests.set(view, generation)
  const doc = view.state.doc
  const selectRemoved = (): boolean => {
    for (const [child, offset] of removed) {
      const base = original.line(offset + 1).from
      const range = { from: old.from - base, to: old.to - base }
      if (range.from < 0 || range.to > child.state.doc.length || !child.dom.isConnected) continue
      if (child.state.doc.sliceString(range.from, range.to) !== original.sliceString(old.from, old.to)) continue
      select(child, range); return true
    }
    return false
  }
  if (selectRemoved()) return true
  view.dispatch({ effects: EditorView.scrollIntoView(Math.min(chunk.fromB, doc.length), { y: 'center' }) })
  // Deletion editors mount only in the viewport. The library's measure queue
  // waits for that viewport without retaining a timer or painting other rows.
  let tries = 0
  const place = (): void => view.requestMeasure({ key: requests, read: () => undefined, write: () => {
    if (requests.get(view) !== generation || view.state.doc !== doc || !view.dom.isConnected) return
    if (!selectRemoved() && ++tries < 3) place()
  } })
  place()
  return true
}
