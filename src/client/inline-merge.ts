import { ChangeSet, EditorState, Text, type Extension } from '@codemirror/state'
import { unifiedMergeView, getOriginalDoc, originalDocChangeEffect } from '@codemirror/merge'
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { mergeDiff } from './merge-line-endings.ts'
import { DIFF_CONTEXT_LINES } from '../diff-context.ts'

/** The official merge extension owns alignment, folding and incremental updates. */
export function inlineMerge(options: { original: () => string; label: (count: number) => string }): {
  extension: Extension; collapse: (view: EditorView) => void
} {
  const synchronize = (view: EditorView): void => {
    const old = getOriginalDoc(view.state)
    const next = Text.of(options.original().split('\n'))
    if (!old.eq(next)) view.dispatch({ effects: originalDocChangeEffect(view.state,
      ChangeSet.of({ from: 0, to: old.length, insert: next }, old.length)) })
  }
  const basis = ViewPlugin.fromClass(class {
    private original = options.original()
    private timer: ReturnType<typeof setTimeout> | undefined
    constructor(readonly view: EditorView) {}
    update(_update: ViewUpdate): void {
      if (this.original === options.original()) return
      this.original = options.original()
      if (this.timer !== undefined) clearTimeout(this.timer)
      this.timer = setTimeout(() => { this.timer = undefined; synchronize(this.view) }, 0)
    }
    destroy(): void { if (this.timer !== undefined) clearTimeout(this.timer) }
  })
  return { collapse: synchronize, extension: [
    unifiedMergeView({ original: Text.of(options.original().split('\n')), mergeControls: false,
      syntaxHighlightDeletions: false, gutter: true, collapseUnchanged: { margin: DIFF_CONTEXT_LINES, minSize: 8 },
      diffConfig: { override: mergeDiff } }), basis,
    EditorState.phrases.of({ '$ unchanged lines': options.label(987654).replace('987654', '$') }),
  ] }
}
