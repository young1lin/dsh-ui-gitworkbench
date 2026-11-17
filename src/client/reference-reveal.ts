import type { Text } from '@codemirror/state'
import type { ReferenceView } from '../reference-contract.ts'
import type { CodeSource } from './code-excerpt.ts'
import type { WorkbenchReference } from './workbench-reference.ts'
import { samePath } from './worktree-view.ts'

export interface ReferenceScope { repository: string | null; view: ReferenceView | null; active: boolean }
export interface SourceRange { from: number; to: number }

/** Matching names are insufficient across worktrees, index layers and revisions. */
export function matchesReferenceSource(target: WorkbenchReference, scope: ReferenceScope, path: string, source: CodeSource): boolean {
  if (!scope.active || !samePath(target.repository, scope.repository) || target.path !== path) return false
  const a = target.view, b = scope.view
  if (!b || a.kind !== b.kind || a.kind === 'commit' && (b.kind !== 'commit' || a.commit !== b.commit)
    || a.kind === 'compare' && (b.kind !== 'compare' || a.base !== b.base || a.head !== b.head)) return false
  const saved = target.displayedSnapshot
  return !saved || (saved.layer === undefined || saved.layer === source.layer)
    && (saved.diffSha === undefined || saved.diffSha === source.diffSha)
    && (saved.blob === undefined || saved.blob === source.blob)
}

/** Read just the referenced characters from the retained CodeMirror document. */
export function savedSelectionRange(doc: Text, target: WorkbenchReference, side: 'old' | 'new', offset = 0): SourceRange | null {
  const saved = target.displayedSnapshot
  if (target.code === undefined || saved?.kind !== 'selection' || saved.side !== side) return null
  const first = (saved.startLine ?? 0) - offset, last = (saved.endLine ?? saved.startLine ?? 0) - offset
  if (first < 1 || last < first || last > doc.lines) return null
  const a = doc.line(first), b = doc.line(last)
  const start = saved.startColumn ?? 1, end = saved.endColumn ?? b.length + 1
  if (start < 1 || end < 1 || start > a.length + 1 || end > b.length + 1) return null
  const from = a.from + start - 1, to = b.from + end - 1
  return from < to && doc.sliceString(from, to) === target.code ? { from, to } : null
}

function hunkSide(doc: Text, range: readonly [number, number], lines: readonly string[]): SourceRange | null {
  const [start, count] = range
  if (count !== lines.length || start < (count ? 1 : 0) || start + count - 1 > doc.lines) return null
  if (!count) {
    const at = start < doc.lines ? doc.line(start + 1).from : doc.length
    return { from: at, to: at }
  }
  const from = doc.line(start).from, to = doc.line(start + count - 1).to
  return doc.sliceString(from, to) === lines.join('\n') ? { from, to } : null
}

/** A hunk returns to the live diff only while BOTH saved sides still agree. */
export function savedHunkRanges(original: Text, current: Text, target: WorkbenchReference): { old: SourceRange; new: SourceRange } | null {
  const saved = target.displayedSnapshot
  if (target.code === undefined || saved?.kind !== 'hunk' || !saved.oldRange || !saved.newRange) return null
  const rows = target.code.split('\n'), old: string[] = [], next: string[] = []
  if (!rows.shift()?.startsWith('@@ ')) return null
  for (const row of rows) {
    if (row.startsWith('-')) old.push(row.slice(1))
    else if (row.startsWith('+')) next.push(row.slice(1))
    else return null
  }
  const before = hunkSide(original, saved.oldRange, old), after = hunkSide(current, saved.newRange, next)
  return before && after ? { old: before, new: after } : null
}
