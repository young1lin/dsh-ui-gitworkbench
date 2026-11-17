/** Place a compact hint outside its action, within the visible window. */
export function tooltipPlacement(anchor: { left: number; top: number; width: number; bottom: number },
  tip: { width: number; height: number }, viewport: { width: number; height: number }): { left: number; top: number } {
  const left = Math.max(8, Math.min(anchor.left + (anchor.width - tip.width) / 2, viewport.width - tip.width - 8))
  const below = anchor.bottom + 6
  return { left, top: below + tip.height <= viewport.height - 8 ? below : Math.max(8, anchor.top - tip.height - 6) }
}
