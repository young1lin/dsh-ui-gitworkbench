import { useRef, useState, type RefObject } from 'react'
import { codeSelection } from './code-selection-dom.ts'
import { selectedExcerpt, type CodeCell, type CodePoint, type CodeExcerpt } from './code-excerpt.ts'

/** Selection gestures store coordinates only; source text is copied on explicit Add. */
export function useCodeSelection(root: RefObject<HTMLElement>, key: unknown, cellAt: (row: number, side: CodePoint['side']) => CodeCell | null) {
  const [range, setRange] = useState<{ key: unknown; from: CodePoint; to: CodePoint } | null>(null)
  const heldRange = useRef<typeof range>(null)
  const current = useRef({ key, cellAt })
  current.current = { key, cellAt }
  const update = (): void => {
    const host = root.current
    const selection = window.getSelection()
    if (!host || !selection || selection.isCollapsed) { heldRange.current = null; setRange(null); return }
    const points = codeSelection(host, selection)
    heldRange.current = points ? { key, ...points } : null
    setRange(heldRange.current)
  }
  const read = (): CodeExcerpt | null => {
    const host = root.current
    const selection = window.getSelection()
    if (!host || !selection || selection.isCollapsed) return null
    const points = codeSelection(host, selection)
    heldRange.current = points ? { key: current.current.key, ...points } : null
    return points ? selectedExcerpt(current.current.cellAt, points.from, points.to) : null
  }
  return {
    available: range !== null && range.key === key,
    update,
    read,
    capture(): CodeExcerpt | null {
      const host = root.current
      const selection = window.getSelection()
      if (host && selection && !selection.isCollapsed
        && selection.rangeCount > 0 && (host.contains(selection.getRangeAt(0).startContainer) || host.contains(selection.getRangeAt(0).endContainer))) {
        return read()
      }
      const held = heldRange.current
      return held !== null && held.key === current.current.key
        ? selectedExcerpt(current.current.cellAt, held.from, held.to) : null
    },
  }
}
