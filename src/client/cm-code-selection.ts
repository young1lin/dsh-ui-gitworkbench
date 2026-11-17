import type { EditorView } from '@codemirror/view'
import { editorExcerpt, type CodeExcerpt, type CodeSource } from './code-excerpt.ts'

/** Undefined belongs elsewhere; null is an invalid selection touching this pane. */
export function domEditorExcerpt(view: EditorView, selection: Selection | null, source: CodeSource, offset = 0): CodeExcerpt | null | undefined {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return undefined
  const { startContainer: anchorNode, endContainer: focusNode, startOffset: anchorOffset, endOffset: focusOffset } = selection.getRangeAt(0)
  if (!view.contentDOM.contains(anchorNode) && !view.contentDOM.contains(focusNode)) return undefined
  const owns = (node: Node | null): boolean => {
    const element = node?.nodeType === 1 ? node as Element : node?.parentElement
    return element?.closest('.cm-content') === view.contentDOM
  }
  if (!owns(anchorNode) || !owns(focusNode)) return null
  const anchor = view.posAtDOM(anchorNode!, anchorOffset), focus = view.posAtDOM(focusNode!, focusOffset)
  if (anchor === focus) return null
  return editorExcerpt(view.state.doc, Math.min(anchor, focus), Math.max(anchor, focus), source, offset)
}
