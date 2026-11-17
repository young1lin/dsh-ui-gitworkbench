import type { CodePoint } from './code-excerpt.ts'

/** Native whole-line selections can end on the following row, outside its code cell. */
export function codeSelection(root: HTMLElement, selection: Selection | null): { from: CodePoint; to: CodePoint } | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null
  let from = codePoint(root, range.startContainer, range.startOffset)
  let to = codePoint(root, range.endContainer, range.endOffset)
  if (!from || !to) {
    // Only rendered cells are visited; omitted file lines stay in the row model.
    const cells = Array.from(root.querySelectorAll<HTMLElement>('[data-quote-row]')).filter(cell => range.intersectsNode(cell))
    const first = cells[0], last = cells.at(-1)
    if (!from && first) from = codePoint(root, first, 0)
    if (!to && last) to = codePoint(root, last, last.childNodes.length)
  }
  return from && to && from.side === to.side ? { from, to } : null
}

/** Ignore line-number gutters, block controls, and visible CR markers. */
export function codePoint(root: HTMLElement, node: Node | null, offset: number): CodePoint | null {
  const element = node?.nodeType === 1 ? node as Element : node?.parentElement
  const cell = element?.closest<HTMLElement>('[data-quote-row]')
  if (!cell || !root.contains(cell) || !node) return null
  let column = 0
  let found = false
  const walk = (part: Node): void => {
    if (found) return
    if (part instanceof Element && part.getAttribute('aria-hidden') === 'true') {
      column += Number(part.getAttribute('data-quote-chars') ?? 0)
      return
    }
    if (part === node) {
      if (part.nodeType === 3) column += offset
      else for (let i = 0; i < offset; i++) column += part.childNodes[i]?.textContent?.length ?? 0
      found = true
    } else if (part.nodeType === 3) column += part.textContent?.length ?? 0
    else for (const child of Array.from(part.childNodes)) walk(child)
  }
  walk(cell)
  const side = cell.dataset.quoteSide
  const row = Number(cell.dataset.quoteRow)
  return found && Number.isInteger(row) && (side === 'old' || side === 'new' || side === 'unified') ? { row, column, side } : null
}
