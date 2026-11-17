export interface DockPresentation {
  visible: boolean
  close(): void
  bindClose(guard: (confirmedClose: () => void) => boolean): () => void
}

/** Registrations exist only for mounted native tabs and are released with their bodies. */
export class WorkbenchCloseGuards {
  private readonly guards = new Map<string, (confirmedClose: () => void) => boolean>()
  private readonly admitted = new Set<string>()
  private key(sessionId: string, tabId: string): string { return JSON.stringify([sessionId, tabId]) }
  bind(sessionId: string, tabId: string, guard: (confirmedClose: () => void) => boolean): () => void {
    const key = this.key(sessionId, tabId)
    this.guards.set(key, guard)
    return () => { if (this.guards.get(key) === guard) this.guards.delete(key) }
  }
  confirmed(sessionId: string, tabId: string, close: () => void): void {
    const key = this.key(sessionId, tabId)
    this.admitted.add(key)
    try { close() } finally { this.admitted.delete(key) }
  }
  beforeClose(sessionId: string, tabId: string, close: () => void, reveal?: () => void): void {
    const key = this.key(sessionId, tabId)
    if (this.admitted.has(key)) return
    const guard = this.guards.get(key)
    // The public close contract preserves the page when cleanup cannot complete.
    if (guard && !guard(() => this.confirmed(sessionId, tabId, close))) {
      reveal?.()
      throw new Error('gitworkbench: unsaved edits require confirmation')
    }
  }
  size(): number { return this.guards.size }
}
