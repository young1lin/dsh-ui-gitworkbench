import type { ReferenceRequest } from '../reference-contract.ts'
import { excerptText, type CodeExcerpt } from './code-excerpt.ts'
import { insertionPoint, resolvedReferenceView, type DraftActions, type ReferenceBridge } from './file-reference.ts'
import { parseWorkbenchReference, type WorkbenchReference } from './workbench-reference.ts'

export interface Annotation { readonly reference: WorkbenchReference; readonly note: string }
export interface AnnotationBatch { readonly version: 1; readonly annotations: readonly Annotation[] }
export interface PendingAnnotation extends Annotation { readonly id: number }
interface AnnotationState { readonly items: readonly PendingAnnotation[]; readonly editing: PendingAnnotation | null }
const EMPTY: AnnotationState = { items: [], editing: null }

export function serializeAnnotationBatch(batch: AnnotationBatch): string {
  return `\n\`\`\`git-workbench-annotations\n${JSON.stringify(batch, null, 2)}\n\`\`\`\n`
}
export function parseAnnotationBatch(text: string): AnnotationBatch | null {
  try {
    const batch = JSON.parse(text) as AnnotationBatch
    if (batch?.version !== 1 || !Array.isArray(batch.annotations) || !batch.annotations.length || batch.annotations.length > 64) return null
    if (!batch.annotations.every(item => item && typeof item.note === 'string' && item.note.trim()
      && item.note.length <= 8192 && parseWorkbenchReference(JSON.stringify(item.reference))?.code !== undefined)) return null
    return batch
  } catch { return null }
}

/** Resolve only abbreviated commits. Code bytes always come from the captured selection. */
export async function captureAnnotation(bridge: ReferenceBridge, worktreePath: string, request: ReferenceRequest, excerpt: CodeExcerpt, signal: AbortSignal): Promise<WorkbenchReference> {
  const frozen = structuredClone(excerpt)
  let view = request.view
  if (view.kind === 'commit' && !/^[0-9a-f]{40,64}$/i.test(view.commit)) {
    view = resolvedReferenceView(view, await bridge.resolve(worktreePath, request, signal))
  }
  signal.throwIfAborted()
  const text = excerptText(request.repoRoot!, { path: request.path, previousPath: request.previousPath,
    status: request.deleted ? 'deleted' : undefined }, view, frozen, '')
  const reference = parseWorkbenchReference(text.slice(text.indexOf('\n', 1) + 1, text.lastIndexOf('\n```')))
  if (!reference) throw new Error('annotation source unavailable')
  return reference
}

/** One native reference is one undo step; no second editable copy of the DSH draft. */
export function insertAnnotations(bridge: ReferenceBridge, sessionId: string, actions: DraftActions | undefined, batch: AnnotationBatch, label: string): 'inserted' | 'changed' | 'unavailable' {
  const input = bridge.getInput(sessionId)
  if (!input?.insertReference || !actions?.captureInsertion || !parseAnnotationBatch(JSON.stringify(batch))) return 'unavailable'
  const span = insertionPoint(actions.captureInsertion()), text = serializeAnnotationBatch(batch)
  if (bridge.getInput(sessionId) !== input || !input.insertReference({ source: 'git-workbench-annotations', ref: text,
    label, appearance: 'file', clipboardText: text }, span)) return 'changed'
  input.focus()
  return 'inserted'
}

/** Bounded unsent state, shared across view remounts. Capacity never silently discards notes. */
export class AnnotationStore {
  private readonly sessions = new Map<string, AnnotationState>()
  private readonly listeners = new Set<() => void>()
  private readonly referenceBytes = new WeakMap<WorkbenchReference, number>()
  private bytes = 0
  private items = 0
  private nextId = 1
  constructor(private readonly limits = { sessions: 32, items: 64, bytes: 8 * 1024 * 1024 }) {}
  get = (sessionId: string): AnnotationState => this.sessions.get(sessionId) ?? EMPTY
  subscribe = (notify: () => void): (() => void) => { this.listeners.add(notify); return () => { this.listeners.delete(notify) } }
  begin(sessionId: string, reference: WorkbenchReference): boolean {
    const prev = this.get(sessionId)
    if (prev.editing) return false
    this.set(sessionId, { ...prev, editing: { id: this.nextId++, reference: structuredClone(reference), note: '' } })
    return true
  }
  write(sessionId: string, note: string): void {
    const prev = this.get(sessionId)
    if (prev.editing) this.set(sessionId, { ...prev, editing: { ...prev.editing, note } })
  }
  save(sessionId: string): boolean {
    const prev = this.get(sessionId), item = prev.editing
    if (!item?.note.trim()) return false
    const at = prev.items.findIndex(value => value.id === item.id), items = [...prev.items]
    if (at === -1) items.push(item); else items[at] = item
    this.set(sessionId, { items, editing: null })
    return true
  }
  cancel(sessionId: string): void { this.set(sessionId, { ...this.get(sessionId), editing: null }) }
  edit(sessionId: string, id: number): boolean {
    const prev = this.get(sessionId), item = prev.items.find(item => item.id === id)
    if (!item || prev.editing) return false
    this.set(sessionId, { ...prev, editing: item }); return true
  }
  remove(sessionId: string, id: number): void {
    const prev = this.get(sessionId)
    this.set(sessionId, { items: prev.items.filter(item => item.id !== id), editing: prev.editing?.id === id ? null : prev.editing })
  }
  complete(sessionId: string, captured: readonly PendingAnnotation[]): void {
    const prev = this.get(sessionId), done = new Set(captured)
    this.set(sessionId, { ...prev, items: prev.items.filter(item => !done.has(item)) })
  }
  size(): { sessions: number; items: number; bytes: number } {
    return { sessions: this.sessions.size, items: this.items, bytes: this.bytes }
  }
  dispose(): void { this.sessions.clear(); this.listeners.clear(); this.bytes = 0; this.items = 0 }
  private cost(state: AnnotationState): number {
    let total = 0
    const counted = new Set<WorkbenchReference>()
    for (const item of [...state.items, ...state.editing ? [state.editing] : []]) {
      let bytes = this.referenceBytes.get(item.reference)
      if (bytes === undefined) { bytes = JSON.stringify(item.reference).length * 2; this.referenceBytes.set(item.reference, bytes) }
      total += (counted.has(item.reference) ? 0 : bytes) + item.note.length * 2
      counted.add(item.reference)
    }
    return total
  }
  private set(sessionId: string, state: AnnotationState): void {
    const prev = this.get(sessionId), before = this.size()
    const bytes = before.bytes - this.cost(prev) + this.cost(state)
    if (state.items.length > this.limits.items || (state.editing?.note.length ?? 0) > 8192
      || !this.sessions.has(sessionId) && before.sessions >= this.limits.sessions
      || bytes > this.limits.bytes) {
      throw new Error('annotation capacity reached')
    }
    if (!state.items.length && !state.editing) this.sessions.delete(sessionId)
    else this.sessions.set(sessionId, state)
    this.bytes = bytes
    this.items += state.items.length - prev.items.length
    for (const notify of this.listeners) notify()
  }
}
