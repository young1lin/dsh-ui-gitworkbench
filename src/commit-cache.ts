/**
 * Bounded store for payloads addressed by a git object name.
 *
 * A commit hash names content that cannot change, so a hit stays valid for the
 * life of the process and there is nothing to invalidate — capacity is the only
 * reason an entry ever leaves. That is the whole distinction from working-tree
 * data, which must never be cached because the next keystroke can change it.
 *
 * @module @young1lin/dsh-ui-gitworkbench/commit-cache
 */

/**
 * Compose a cache key from its parts.
 *
 * The separator is a unit separator, which cannot occur in a filesystem path, a
 * git object name, or a repository-relative filename. No two distinct part
 * lists can therefore produce the same key.
 * @param parts - key components, most general first.
 * @returns the composed key.
 */
export function cacheKey(...parts: readonly string[]): string {
  return parts.join('\x1f')
}

/**
 * Fixed-capacity map with least-recently-used eviction.
 *
 * A Map iterates in insertion order, so re-inserting an entry on every hit
 * makes insertion order the recency order and the first key the least recently
 * used one. No timestamps, no separate list.
 */
export class CommitPayloadCache<V> {
  private readonly entries = new Map<string, V>()

  /** @param capacity - entries kept resident; the least recently used is dropped past it. */
  constructor(private readonly capacity: number) {}

  /** How many entries are resident. */
  get size(): number {
    return this.entries.size
  }

  /**
   * Read an entry, marking it most recently used.
   * @param key - cache key.
   * @returns the stored payload, or undefined when the key is absent.
   */
  get(key: string): V | undefined {
    const hit = this.entries.get(key)
    if (hit === undefined) return undefined
    this.entries.delete(key)
    this.entries.set(key, hit)
    return hit
  }

  /**
   * Store an entry as most recently used, evicting past capacity.
   * @param key - cache key.
   * @param value - payload to store, replacing any existing entry for the key.
   */
  set(key: string, value: V): void {
    this.entries.delete(key)
    this.entries.set(key, value)
    if (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next()
      if (!oldest.done) this.entries.delete(oldest.value)
    }
  }
}
