import type { CodeExcerpt } from './code-excerpt.ts'

export interface EditorSelection {
  readonly path: string
  readonly available: boolean
  readonly capture: () => CodeExcerpt | null
}

/** Static old-side selections and the editable pane share one toolbar. */
export function combineSelections(primary: EditorSelection, secondary: EditorSelection | null): EditorSelection {
  const other = secondary?.path === primary.path ? secondary : null
  return { path: primary.path, available: primary.available || other?.available === true,
    capture: () => primary.capture() ?? other?.capture() ?? null }
}

/** Resolve the gesture without reading any code until the user clicks. */
export function editorQuote(path: string, selection: EditorSelection | null, hunk: (() => CodeExcerpt | null) | null, dirty: boolean) {
  if (selection?.path === path && selection.available) {
    return { kind: 'selection' as const, capture: selection.capture, disabled: false }
  }
  return hunk === null ? null : { kind: 'hunk' as const, capture: () => {
    const live = selection?.path === path ? selection.capture() : null
    return live ?? hunk()
  }, disabled: dirty }
}
