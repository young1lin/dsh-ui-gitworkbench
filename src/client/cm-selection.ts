import type { Text } from '@codemirror/state'
import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from '@codemirror/view'

/** Project selections onto visible source only, including folded documents. */
export function selectionWindow(doc: Text, ranges: readonly { from: number; to: number }[], visible: readonly { from: number; to: number }[]): {
  lines: number[]; spans: { from: number; to: number }[]
} {
  const lines = new Set<number>()
  const spans: { from: number; to: number }[] = []
  for (const range of ranges) for (const viewport of visible) {
    const from = Math.max(range.from, viewport.from)
    const to = Math.min(range.to, viewport.to)
    if (from >= to) continue
    spans.push({ from, to })
    const first = doc.lineAt(from).number
    const last = doc.lineAt(to - 1).number
    for (let line = first; line <= last; line++) lines.add(line)
  }
  return { lines: [...lines].sort((a, b) => a - b), spans }
}

export const persistentSelection = ViewPlugin.fromClass(class {
  decorations: DecorationSet = Decoration.none
  constructor(readonly view: EditorView) { this.paint() }
  update(update: ViewUpdate): void {
    if (update.selectionSet || update.docChanged || update.viewportChanged) this.paint()
  }
  paint(): void {
    const { lines, spans } = selectionWindow(this.view.state.doc, this.view.state.selection.ranges, this.view.visibleRanges)
    this.decorations = Decoration.set([
      ...lines.map(line => Decoration.line({ class: 'cm-gwSelectedLine' }).range(this.view.state.doc.line(line).from)),
      ...spans.map(span => Decoration.mark({ class: 'cm-gwSelectedText' }).range(span.from, span.to)),
    ], true)
  }
}, { decorations: plugin => plugin.decorations })
