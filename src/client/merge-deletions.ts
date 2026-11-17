import { getChunks, getOriginalDoc } from '@codemirror/merge'
import { EditorView, ViewPlugin, type DecorationSet, type WidgetType, type ViewUpdate } from '@codemirror/view'
import type { Extension, Text } from '@codemirror/state'

/** Adapt the merge library's visible deletion widgets to bounded CodeMirror views.
 *  Only public decoration/widget interfaces are used; the library still owns
 *  chunks, incremental diffing, placement, folding and unchanged-line expansion. */
export function virtualDeletions(mount: (host: HTMLElement, text: string, startLine: number, at: number, basis: string) => EditorView): Extension {
  const wrapped = new WeakSet<WidgetType>()
  const children = new WeakMap<HTMLElement, EditorView>()
  let heldOriginal: Text | null = null
  let heldBasis = ''
  return ViewPlugin.fromClass(class {
    constructor(readonly view: EditorView) { this.adapt() }
    update(update: ViewUpdate): void { if (update.docChanged || update.viewportChanged || update.transactions.some(tr => tr.effects.length)) this.adapt() }
    adapt(): void {
      const chunks = getChunks(this.view.state)?.chunks
      if (!chunks) return
      const original = getOriginalDoc(this.view.state)
      if (original !== heldOriginal) { heldOriginal = original; heldBasis = original.toString() }
      const source = this.view.state.facet(EditorView.decorations)
      const adapt = (from: number, _to: number, decoration: { spec: { widget?: WidgetType; block?: boolean } }): void => {
        const widget = decoration.spec.widget
        if (!widget || !decoration.spec.block || wrapped.has(widget)) return
        // Chunks are ordered by their editor position. Only visible widgets reach this callback.
        let lo = 0, hi = chunks.length
        while (lo < hi) { const mid = (lo + hi) >>> 1; if (chunks[mid]!.fromB < from) lo = mid + 1; else hi = mid }
        const chunk = chunks[lo]
        if (!chunk || chunk.fromB !== from || chunk.fromA >= chunk.toA) return
        const text = original.sliceString(chunk.fromA, chunk.endA)
        const startLine = original.lineAt(chunk.fromA).number
        const basis = heldBasis
        wrapped.add(widget)
        widget.eq = other => other === widget
        widget.toDOM = () => {
          const host = document.createElement('div')
          host.className = 'cm-gwRemoved'
          children.set(host, mount(host, text, startLine, from, basis))
          return host
        }
        widget.destroy = host => { children.get(host)?.destroy(); children.delete(host) }
        Object.defineProperty(widget, 'estimatedHeight', { value: Math.min(12, original.lineAt(chunk.endA).number - startLine + 1) * 20 })
      }
      for (const item of source) {
        if (typeof item === 'function') continue
        for (const range of this.view.visibleRanges) (item as DecorationSet).between(range.from, range.to, adapt)
      }
    }
  })
}
