import type { WorkbenchReference } from './workbench-reference.ts'
import type { AnnotationBatch } from './annotations.ts'

export interface ReferenceNavigationOptions { readonly changes?: boolean; readonly line?: number; readonly batch?: AnnotationBatch }

/** Only mounted workbenches subscribe; at most one pending preview per session. */
export class ReferenceNavigation {
  private readonly targets = new Map<string, WorkbenchReference>()
  private readonly options = new Map<string, ReferenceNavigationOptions>()
  private readonly listeners = new Set<() => void>()
  private readonly reveals = new Map<string, Set<(target: WorkbenchReference) => boolean>>()
  get = (sessionId: string): WorkbenchReference | null => this.targets.get(sessionId) ?? null
  getOptions = (sessionId: string): ReferenceNavigationOptions => this.options.get(sessionId) ?? {}
  subscribe = (notify: () => void): (() => void) => { this.listeners.add(notify); return () => { this.listeners.delete(notify) } }
  open(sessionId: string, reference: WorkbenchReference, options?: ReferenceNavigationOptions): void {
    for (const reveal of options ? [] : this.reveals.get(sessionId) ?? []) {
      if (reveal(reference)) { this.close(sessionId); return }
    }
    this.targets.delete(sessionId); this.targets.set(sessionId, reference)
    if (options) this.options.set(sessionId, options); else this.options.delete(sessionId)
    while (this.targets.size > 32) { const oldest = this.targets.keys().next().value!; this.targets.delete(oldest); this.options.delete(oldest) }
    this.emit()
  }
  close = (sessionId: string): void => { this.targets.delete(sessionId); this.options.delete(sessionId); this.emit() }
  bindReveal(sessionId: string, reveal: (target: WorkbenchReference) => boolean): () => void {
    const handlers = this.reveals.get(sessionId) ?? new Set()
    handlers.add(reveal); this.reveals.set(sessionId, handlers)
    const pending = this.targets.get(sessionId)
    if (pending && !this.options.has(sessionId) && reveal(pending)) this.close(sessionId)
    return () => { handlers.delete(reveal); if (!handlers.size) this.reveals.delete(sessionId) }
  }
  size(): number { return this.targets.size }
  revealSize(): number { let size = 0; for (const handlers of this.reveals.values()) size += handlers.size; return size }
  dispose(): void { this.targets.clear(); this.options.clear(); this.listeners.clear(); this.reveals.clear() }
  private emit(): void { for (const notify of this.listeners) notify() }
}
