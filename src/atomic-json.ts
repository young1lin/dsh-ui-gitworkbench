/**
 * Crash-safe JSON writes for this plugin's small state files under `~/.dsh`.
 *
 * IO is passed in rather than imported so the callers stay testable without a
 * real filesystem, and so the one Windows-specific retry lives in a single place
 * instead of once per state file.
 */
import { join } from 'node:path'

/** Backoff before each rename retry, in ms. */
const RENAME_RETRY_DELAYS = [25, 50, 100, 200, 400]

/**
 * @param ms - milliseconds to wait.
 * @returns a promise resolving after that delay.
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Write a JSON value so a crash can never leave a truncated file behind.
 *
 * The value is staged into `<path>.tmp` and renamed over the destination, which
 * is atomic within a filesystem. The rename itself goes through
 * {@link renameWithRetry} — the one home of the Windows EPERM backoff, shared
 * with `write-checked.ts`'s worktree writes rather than duplicated per caller.
 * @param ensureDir - creates the containing directory, recursively.
 * @param writeText - writes a file's whole text.
 * @param rename - renames a path over another.
 * @param path - destination path.
 * @param value - JSON-serializable value.
 * @throws whatever `rename` threw, once the retries are exhausted.
 */
export async function saveJsonAtomic(
  ensureDir: (dir: string) => Promise<void>,
  writeText: (path: string, text: string) => Promise<void>,
  rename: (from: string, to: string) => Promise<void>,
  path: string,
  value: unknown,
): Promise<void> {
  await ensureDir(join(path, '..'))
  const tmp = `${path}.tmp`
  await writeText(tmp, `${JSON.stringify(value, null, 2)}\n`)
  await renameWithRetry(rename, delay, tmp, path)
}

/**
 * Rename `from` over `to`, retrying the short-lived Windows failures.
 *
 * On Windows a rename over an existing destination fails with EPERM while
 * another handle briefly holds it open (a concurrent read, an antivirus scan,
 * the search indexer); those locks are short-lived, so the rename is retried
 * with backoff before the error is surfaced. Extracted from
 * {@link saveJsonAtomic} when the editable diff needed the same atomic write
 * for worktree files: one mechanism, two callers, not two mechanisms that can
 * drift.
 * @param rename - renames a path over another.
 * @param delay - waits the given milliseconds.
 * @param from - the staged temp path.
 * @param to - the destination.
 * @throws whatever `rename` threw, once the retries are exhausted.
 */
export async function renameWithRetry(
  rename: (from: string, to: string) => Promise<void>,
  delay: (ms: number) => Promise<void>,
  from: string,
  to: string,
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to)
      return
    } catch (error) {
      if (attempt >= RENAME_RETRY_DELAYS.length) throw error
      await delay(RENAME_RETRY_DELAYS[attempt])
    }
  }
}
