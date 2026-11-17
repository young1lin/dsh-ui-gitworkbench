import type { FileReference, ReferenceRange, ReferenceRequest, ReferenceView } from '../reference-contract.ts'
import { serializeWorkbenchReference } from './workbench-reference.ts'

export interface ReferenceBridge {
  getInput(sessionId: string): ReferenceInput | null
  resolve(worktreePath: string, request: ReferenceRequest, signal: AbortSignal): Promise<FileReference>
}

/** Derive identity from the loaded result, never from a newly selected ref. */
export function referenceView(tab: string, snapshot: { commits: readonly { hash: string }[]; referenceRange?: ReferenceRange } | null, loading: boolean): ReferenceView | null {
  if (loading || snapshot === null) return null
  if (tab === 'changes' || tab === 'files') return { kind: 'working' }
  if (tab === 'history') return snapshot.commits[0] ? { kind: 'commit', commit: snapshot.commits[0].hash } : null
  return tab === 'compare' && snapshot.referenceRange ? { kind: 'compare', ...snapshot.referenceRange } : null
}

/** History rows abbreviate hashes; persisted references require the resolved change identity. */
export function resolvedReferenceView(view: ReferenceView, file: FileReference): ReferenceView {
  if (view.kind !== 'commit' || /^[0-9a-f]{40,64}$/i.test(view.commit)) return view
  const commit = file.change
  if (!commit || !/^[0-9a-f]{40,64}$/i.test(commit) || !commit.toLowerCase().startsWith(view.commit.toLowerCase())) {
    throw new Error('commit identity changed')
  }
  return { kind: 'commit', commit }
}

/** The native file source accepts a path, not a revision or a Git object. */
export function fileMention(path: string): string | null {
  if (/["\u0000-\u001f\u007f]/.test(path)) return null
  return /\s/u.test(path) ? `@"${path}"` : `@${path}`
}

/** Join against the displayed worktree root, independent of the session cwd. */
export function referencePaths(root: string, path: string): { name: string; relative: string; absolute: string } {
  const normalizedRoot = root.replace(/\\/g, '/')
  if (!root || /[\u0000-\u001f]/.test(root) || !/^(?:[a-z]:\/|\/)/i.test(normalizedRoot)) throw new Error('repository root unavailable')
  if (!path || /^[\\/]|^[a-z]:/i.test(path) || path.includes('\0') || path.split(/[\\/]/).some(part => part === '..' || part === '.')) throw new Error('invalid file path')
  return { name: path.slice(path.lastIndexOf('/') + 1), relative: path, absolute: `${normalizedRoot.replace(/\/$/, '')}/${path}` }
}

/** Historical references stay plain text: opening an @file would read today. */
export function referenceText(file: FileReference, heading: string): string {
  const data = {
    repository: file.repoRoot, path: file.path, absolutePath: file.absolutePath,
    version: file.kind === 'file' ? 'working-tree' : file.blob === null ? 'deleted-path' : 'git-object', deleted: file.deleted,
    ...file.kind === 'git' ? { revisionPath: file.revisionPath } : {},
    ...file.revision === null ? {} : { revision: file.revision },
    ...file.blob === null ? {} : { blob: file.blob },
    ...file.change === null ? {} : { change: file.change },
    ...file.previousPath === undefined ? {} : { previousPath: file.previousPath },
  }
  return `\n${heading}\n${JSON.stringify(data, null, 2)}\n`
}

export interface InsertionSpan { start: number; end: number; draftRev: number }
export interface DraftActions {
  captureInsertion(): InsertionSpan
  insertText(text: string, span: InsertionSpan): boolean
}
export interface ReferenceInput {
  insertReference(ref: { source: string; ref: string; label: string; appearance: 'file'; clipboardText: string }, span: InsertionSpan): boolean
  focus(): void
}

/** Collapse a selection so adding context never deletes selected draft text. */
export function insertionPoint(span: InsertionSpan): InsertionSpan {
  return { start: span.end, end: span.end, draftRev: span.draftRev }
}

export function insertFileReference(file: FileReference, _actions: DraftActions, input: ReferenceInput, span: InsertionSpan, _heading: string, view?: ReferenceView): boolean {
  const text = serializeWorkbenchReference({ version: 1, repository: file.repoRoot, path: file.path, absolutePath: file.absolutePath,
    view: view ?? (file.kind === 'git' && (file.change ?? file.revision) ? { kind: 'commit', commit: (file.change ?? file.revision)! } : { kind: 'working' }),
    deleted: file.deleted, file, ...file.previousPath ? { previousPath: file.previousPath } : {} })
  return input.insertReference({ source: 'git-workbench', ref: text, label: file.path.slice(file.path.lastIndexOf('/') + 1), appearance: 'file', clipboardText: text }, insertionPoint(span))
}

type InsertionResult = { kind: 'inserted'; input: ReferenceInput } | { kind: 'changed' | 'aborted' }
export type PreparedInsertion = { kind: 'ready'; insert(): InsertionResult } | { kind: 'unavailable' | 'aborted' }

/** Resolve first; the caller's unsaved-editor guard admits the final insertion. */
export async function prepareFileInsertion(bridge: ReferenceBridge, sessionId: string, worktreePath: string, request: ReferenceRequest, actions: DraftActions | undefined, heading: string, signal: AbortSignal): Promise<PreparedInsertion> {
  if (signal.aborted) return { kind: 'aborted' }
  const input = bridge.getInput(sessionId)
  if (typeof actions?.captureInsertion !== 'function' || typeof actions.insertText !== 'function'
    || typeof input?.insertReference !== 'function') return { kind: 'unavailable' }
  const span = actions.captureInsertion()
  const file = await bridge.resolve(worktreePath, request, signal)
  if (signal.aborted) return { kind: 'aborted' }
  const view = resolvedReferenceView(request.view, file)
  let used = false
  return { kind: 'ready', insert: () => {
    if (signal.aborted) return { kind: 'aborted' }
    if (used || bridge.getInput(sessionId) !== input) return { kind: 'changed' }
    used = true
    if (!insertFileReference(file, actions, input, span, heading, view)) return { kind: 'changed' }
    return { kind: 'inserted', input }
  } }
}
