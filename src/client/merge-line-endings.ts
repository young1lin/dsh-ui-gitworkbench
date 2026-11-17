import { Change, diff } from '@codemirror/merge'

/** Only the comparison ignores CRLF; documents and quote offsets stay intact. */
export function mergeDiff(a: string, b: string): readonly Change[] {
  const project = (text: string) => {
    const removed: number[] = []
    const normalized = text.replace(/\r\n/g, (_, at: number) => { removed.push(at - removed.length); return '\n' })
    return { normalized, offset: (at: number): number => {
      let lo = 0, hi = removed.length
      while (lo < hi) { const mid = (lo + hi) >>> 1; if (removed[mid]! < at) lo = mid + 1; else hi = mid }
      return at + lo
    } }
  }
  const old = project(a), next = project(b)
  return diff(old.normalized, next.normalized, { scanLimit: 500, timeout: 100 }).map(change =>
    new Change(old.offset(change.fromA), old.offset(change.toA), next.offset(change.fromB), next.offset(change.toB)))
}
