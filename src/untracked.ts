/**
 * Untracked-file measures for the stats pass, without re-reading what has
 * not changed.
 *
 * Every workbench poll listed the untracked files and read EACH one whole,
 * every time, only to count lines and sniff for a NUL — a repo with a build
 * directory inside it paid a full re-read of all of it every 3-15 seconds.
 * The reader never asked for that; nothing else in the poll reads the files
 * at all.
 *
 * So the measure is cached by (mtimeMs, size): a stat per file decides
 * whether the bytes are still the ones already counted, and only a real
 * change pays for a read. That is the same make-style heuristic every build
 * tool uses — it can be wrong only for a rewrite that lands INSIDE the
 * filesystem's timestamp granularity with the size unchanged, which NTFS's
 * 100ns clock does not allow and even FAT's 2s needs two writes inside one
 * window to fool.
 *
 * The cache is a Map used as an LRU (delete+set refreshes recency, the
 * oldest entry drops), bounded and able to report its size, like every
 * cache in this plugin.
 *
 * Pure rules, io-injected: vitest drives this without a disk.
 *
 * @module @young1lin/dsh-ui-gitworkbench/untracked
 */
import { countBufferLines, isBinaryPrefix } from './git-ops.js'

/** What every untracked file must report, whether or not its diff ships. */
export interface UntrackedMeasure {
  readonly lineCount: number
  readonly binary: boolean
  /** False when the file is missing, binary, or past the per-file byte cap. */
  readonly diffable: boolean
}

/** Everything the cache needs from the filesystem, injected so the rules can
 *  be tested without one. */
export interface UntrackedIo {
  /** null when the path does not stat — missing, or not ours to open. */
  readonly stat: (path: string) => Promise<{ mtimeMs: number; size: number } | null>
  /** First `length` bytes, or null when the file cannot be opened. */
  readonly readPrefix: (path: string, length: number) => Promise<Buffer | null>
  /** Whole file, or null when it cannot be read (vanished, locked). */
  readonly readFile: (path: string) => Promise<Buffer | null>
}

/** Bytes of the head that decide binary — one number, shared by the diff side. */
export const BINARY_SNIFF_BYTES = 8_000

/** Measures remembered before the least recently used is dropped. */
export const UNTRACKED_MEASURE_CAPACITY = 256

interface CacheEntry {
  readonly mtimeMs: number
  readonly size: number
  readonly measure: UntrackedMeasure
}

export class UntrackedMeasures {
  private readonly entries = new Map<string, CacheEntry>()

  constructor(
    /** Past this a file is listed but never diffed; its lines are not worth
     *  a whole read per poll, though its binary badge still is. */
    private readonly byteCap: number,
    private readonly capacity: number = UNTRACKED_MEASURE_CAPACITY,
    private readonly sniffBytes: number = BINARY_SNIFF_BYTES,
  ) {}

  /** How many measures are held — the bound is provable from outside. */
  size(): number {
    return this.entries.size
  }

  /** Count one file, from the cache when its bytes have not moved. */
  async measure(io: UntrackedIo, path: string): Promise<UntrackedMeasure> {
    const info = await io.stat(path)
    if (info === null) return { lineCount: 0, binary: false, diffable: false }
    const hit = this.entries.get(path)
    if (hit !== undefined && hit.mtimeMs === info.mtimeMs && hit.size === info.size) {
      this.entries.delete(path)
      this.entries.set(path, hit)
      return hit.measure
    }
    const measure = info.size > this.byteCap
      ? await this.measurePastCap(io, path)
      : await this.measureWhole(io, path)
    // A failed read is never cached: a Windows EBUSY or a file vanishing
    // mid-pass is transient, and pinning its zeros under the current mtime
    // would keep reporting them after the file reads fine.
    if (measure === null) return { lineCount: 0, binary: false, diffable: false }
    this.entries.delete(path)
    this.entries.set(path, { mtimeMs: info.mtimeMs, size: info.size, measure })
    if (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next()
      if (!oldest.done) this.entries.delete(oldest.value)
    }
    return measure
  }

  /** Past the cap the badge still matters; the line count does not. */
  private async measurePastCap(io: UntrackedIo, path: string): Promise<UntrackedMeasure | null> {
    const prefix = await io.readPrefix(path, this.sniffBytes)
    if (prefix === null) return null
    return { lineCount: 0, binary: isBinaryPrefix(prefix, this.sniffBytes), diffable: false }
  }

  private async measureWhole(io: UntrackedIo, path: string): Promise<UntrackedMeasure | null> {
    const bytes = await io.readFile(path)
    if (bytes === null) return null
    if (isBinaryPrefix(bytes, this.sniffBytes)) return { lineCount: 0, binary: true, diffable: false }
    return {
      lineCount: countBufferLines(bytes),
      binary: false,
      diffable: bytes.length <= this.byteCap,
    }
  }
}
