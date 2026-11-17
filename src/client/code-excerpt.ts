import type { ReferenceRequest, ReferenceView } from '../reference-contract.ts'
import type { Row } from './diff-model.ts'
import type { SideRow } from './side-rows.ts'
import { insertionPoint, referencePaths, resolvedReferenceView, type DraftActions, type ReferenceBridge } from './file-reference.ts'
import { parseWorkbenchReference, serializeWorkbenchReference } from './workbench-reference.ts'
import type { Text } from '@codemirror/state'

export interface CodeSelection {
  text: string
  startLine: number
  endLine: number
  startColumn: number
  endColumn: number
}
export interface CodeExcerpt {
  kind: 'selection' | 'hunk'
  text: string
  side: 'old' | 'new' | 'unified'
  startLine?: number
  endLine?: number
  startColumn?: number
  endColumn?: number
  oldRange?: readonly [number, number]
  newRange?: readonly [number, number]
  layer?: 'unstaged' | 'staged'
  diffSha?: string
  blob?: string
  unsaved?: boolean
  diffLines?: readonly { old: number; new: number; kind: string }[]
}
export interface CodePoint { row: number; column: number; side: 'old' | 'new' | 'unified' }
export interface CodeCell { text: string; line: number; side: CodePoint['side']; oldLine?: number; newLine?: number; kind?: string }
export type CodeSource = Pick<CodeExcerpt, 'blob' | 'diffSha' | 'layer' | 'unsaved' | 'diffLines'> & { side?: CodeExcerpt['side'] }

/** A saved unified selection retains its original row coordinates when quoted again. */
export function editorExcerpt(doc: Text, from: number, to: number, source: CodeSource = {}, offset = 0): CodeExcerpt {
  const first = doc.lineAt(from), last = doc.lineAt(to)
  const mapped = source.diffLines?.slice(first.number - 1, last.number)
  const rows = mapped?.length ? mapped : undefined
  return { ...source, kind: 'selection', side: source.side ?? 'new', text: doc.sliceString(from, to),
    startLine: rows ? rows[0]!.new || rows[0]!.old : first.number + offset,
    endLine: rows ? rows.at(-1)!.new || rows.at(-1)!.old : last.number + offset,
    startColumn: from - first.from + 1, endColumn: to - last.from + 1, ...rows ? { diffLines: rows } : {} }
}

/** Capture only the requested range; callers retain row models already built for painting. */
export function selectedExcerpt(cellAt: (row: number, side: CodePoint['side']) => CodeCell | null, a: CodePoint, b: CodePoint): CodeExcerpt | null {
  if (a.side !== b.side) return null
  const [from, to] = a.row < b.row || a.row === b.row && a.column <= b.column ? [a, b] : [b, a]
  const lines: string[] = []
  let first = 0
  let last = 0
  const diffLines: { old: number; new: number; kind: string }[] = []
  for (let row = from.row; row <= to.row; row++) {
    const cell = cellAt(row, from.side)
    if (cell === null) continue
    if (first === 0) first = cell.line
    last = cell.line
    if (from.side === 'unified') diffLines.push({ old: cell.oldLine ?? 0, new: cell.newLine ?? 0, kind: cell.kind ?? 'context' })
    lines.push(cell.text.slice(row === from.row ? from.column : 0, row === to.row ? to.column : undefined))
  }
  const text = lines.join('\n')
  return text.length === 0 ? null : { kind: 'selection', side: from.side, text,
    startLine: first, endLine: last, startColumn: from.column + 1, endColumn: to.column + 1,
    ...diffLines.length ? { diffLines } : {} }
}

/** Reuse a block's bounds rather than scanning the complete diff on each render. */
export function sideHunk(rows: readonly SideRow[], start: number, end: number): CodeExcerpt | null {
  const old: string[] = []
  const next: string[] = []
  let oldStart = 0
  let newStart = 0
  for (let i = start; i < end; i++) {
    const row = rows[i]!
    if (row.left) { oldStart ||= row.left.line; old.push(row.left.text) }
    if (row.right) { newStart ||= row.right.line; next.push(row.right.text) }
  }
  if (old.length + next.length === 0) return null
  // Git's zero-count range names the preceding line for an insertion/deletion.
  if (old.length === 0) oldStart = rows[start - 1]?.left?.line ?? 0
  if (next.length === 0) newStart = rows[start - 1]?.right?.line ?? 0
  return { kind: 'hunk', side: 'unified', oldRange: [oldStart, old.length], newRange: [newStart, next.length],
    text: [`@@ -${oldStart},${old.length} +${newStart},${next.length} @@`, ...old.map(s => '-' + s), ...next.map(s => '+' + s)].join('\n') }
}

export function unifiedHunk(rows: readonly Row[], start: number, end: number): CodeExcerpt | null {
  const changed = rows.slice(start, end).filter(row => row.kind === 'add' || row.kind === 'del')
  if (changed.length === 0) return null
  const old = changed.filter(row => row.kind === 'del')
  const next = changed.filter(row => row.kind === 'add')
  const before = rows[start - 1]
  const header = before?.kind === 'hunk' ? /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(before.text) : null
  const oldBefore = header ? Number(header[1]) - (header[2] === '0' ? 0 : 1) : before?.oldL || 0
  const newBefore = header ? Number(header[3]) - (header[4] === '0' ? 0 : 1) : before?.newL || 0
  const oldStart = old[0]?.oldL ?? Math.max(0, oldBefore)
  const newStart = next[0]?.newL ?? Math.max(0, newBefore)
  return { kind: 'hunk', side: 'unified', oldRange: [oldStart, old.length], newRange: [newStart, next.length],
    text: [`@@ -${oldStart},${old.length} +${newStart},${next.length} @@`, ...changed.map(row => (row.kind === 'del' ? '-' : '+') + row.text)].join('\n') }
}

export function blockBounds(ids: readonly number[]): readonly (readonly [number, number])[] {
  const bounds: [number, number][] = []
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!
    if (id < 0) continue
    const bound = bounds[id]
    if (bound) bound[1] = i + 1
    else bounds[id] = [i, i + 1]
  }
  return bounds
}

/** Plain snapshots intentionally carry no @file mention that could resolve to today's bytes. */
export function excerptText(root: string, file: { path: string; previousPath?: string; status?: string }, view: ReferenceView, excerpt: CodeExcerpt, _heading: string): string {
  const paths = referencePaths(root, file.path)
  const { text, ...location } = excerpt
  const metadata = { version: 1 as const, repository: root, path: file.path, absolutePath: paths.absolute,
    ...file.previousPath ? { previousPath: file.previousPath } : {}, deleted: file.status === 'deleted',
    view, displayedSnapshot: location }
  return serializeWorkbenchReference({ ...metadata, code: text })
}

/** A synchronous CAS retains draft chips and refuses stale session facades. */
export function insertExcerpt(bridge: ReferenceBridge, sessionId: string, actions: DraftActions | undefined, text: string): 'inserted' | 'unavailable' | 'changed' {
  const input = bridge.getInput(sessionId)
  if (typeof input?.insertReference !== 'function' || typeof actions?.captureInsertion !== 'function') return 'unavailable'
  const header = '\n```git-workbench\n'
  const reference = text.startsWith(header) ? parseWorkbenchReference(text.slice(header.length, text.lastIndexOf('\n```'))) : null
  if (!reference) return 'unavailable'
  const location = reference.displayedSnapshot
  const range = location?.startLine === undefined ? '' : `:${location.startLine}${location.endLine === undefined || location.endLine === location.startLine ? '' : `–${location.endLine}`}`
  const label = reference.path.split('/').at(-1)! + range
  const span = insertionPoint(actions.captureInsertion())
  if (bridge.getInput(sessionId) !== input || !input.insertReference({ source: 'git-workbench', ref: text,
    label, appearance: 'file', clipboardText: text }, span)) return 'changed'
  input.focus()
  return 'inserted'
}

/** Resolve an abbreviated historical identity without recapturing a newer draft or code selection. */
export async function prepareExcerptInsertion(bridge: ReferenceBridge, sessionId: string, worktreePath: string, request: ReferenceRequest,
  excerpt: CodeExcerpt, actions: DraftActions | undefined, heading: string, signal: AbortSignal): Promise<
  { kind: 'ready'; insert(): ReturnType<typeof insertExcerpt> | 'aborted' } | { kind: 'unavailable' | 'aborted' }
> {
  if (signal.aborted) return { kind: 'aborted' }
  const input = bridge.getInput(sessionId)
  if (typeof input?.insertReference !== 'function' || typeof actions?.captureInsertion !== 'function') return { kind: 'unavailable' }
  const span = actions.captureInsertion()
  const file = await bridge.resolve(worktreePath, request, signal)
  if (signal.aborted) return { kind: 'aborted' }
  const text = excerptText(file.repoRoot, { path: file.path, previousPath: file.previousPath ?? request.previousPath,
    status: file.deleted ? 'deleted' : undefined }, resolvedReferenceView(request.view, file), excerpt, heading)
  let used = false
  return { kind: 'ready', insert: () => {
    if (signal.aborted) return 'aborted'
    if (used || bridge.getInput(sessionId) !== input) return 'changed'
    used = true
    return insertExcerpt(bridge, sessionId, { captureInsertion: () => span, insertText: actions.insertText }, text)
  } }
}
