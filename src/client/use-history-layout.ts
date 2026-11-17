import { useLayoutEffect, useState } from 'react'
import { dockHistoryLayout, type HistoryLayout } from './history-layout.ts'

/** Observe the retained panel, since a native sidebar resizes without window.resize. */
export function useHistoryLayout(panel: { current: HTMLElement | null }, docked: boolean, preferred: HistoryLayout): HistoryLayout {
  const [layout, setLayout] = useState<HistoryLayout>('stacked')
  useLayoutEffect(() => {
    const element = panel.current
    if (!docked || element === null) return
    const measure = (): void => {
      // An inactive native tab may have no box. Keep its last useful layout.
      if (element.clientWidth > 0) setLayout(dockHistoryLayout(element.clientWidth))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [panel, docked])
  return docked ? layout : preferred
}
