/**
 * The `writeChecked` sequence: save the editor's buffer over the working-tree
 * file it was opened from, refusing when the file moved underneath the editor.
 *
 * The sha check is the whole point of this RPC. The drawer shares its
 * worktrees with an agent that writes the same files, and the poll only says
 * how fast the drawer *notices* — so the one hard rule is that a write lands
 * only when the file's blob sha is still the one the editor opened with. A
 * client that lies about that sha gains nothing: the sha is re-derived from
 * what git says at the moment of the write, the same never-trust-the-client
 * shape as `discardFile`'s `expectedEffect`.
 *
 * `expectedSha === ''` means "the file did not exist when I opened it" (a
 * buffer opened on a file deleted meanwhile), and is accepted only while the
 * file is still absent. The not-exist/hash-failure distinction is made
 * explicitly, with a filesystem stat: a spawn error must surface as a failed
 * save, never masquerade as "exists with a different sha" — that would look
 * like the stale case while silently skipping the guard's real work.
 *
 * The sequence's every branch lives here rather than in `index.ts`, because
 * `index.ts` extends the RPC service class and imports its dsh peers as values
 * — vitest cannot load it. Everything git- or filesystem-shaped is injected
 * (`WriteCheckedIo`), which is also what lets the git-backed tests drive this
 * exact code with a real git in a temp repo.
 *
 * There is deliberately no `writeFile(path, content)` without the sha check
 * anywhere in this plugin, and none may be added: an unchecked write is a
 * clobber-a-concurrent-agent primitive.
 *
 * @module @young1lin/dsh-ui-gitworkbench/write-checked
 */

import { randomBytes } from 'node:crypto'

import { renameWithRetry } from './atomic-json.js'
import { resolveInside } from './fs-remove.js'
import { isSafePathArg, type OpFailure } from './git-ops.js'
import type { GitRun } from './apply-blocks.js'

/**
 * `gitWorkbench/writeChecked`'s answer. Optional fields obey the gateway's
 * JSON rule: success emits `ok` and `sha` and omits `failure`/`error`
 * entirely; failure omits `sha`.
 */
export interface WriteResult {
  readonly ok: boolean
  /** Present only on failure; `stale` is the sha refusal this RPC exists for. */
  readonly failure?: OpFailure
  /** A sentence for the user; names the file on the stale path. */
  readonly error?: string
  /** The file's blob sha after a successful write, for the next save. */
  readonly sha?: string
}

/**
 * Everything the sequence needs from its host, as injected dependencies.
 *
 * `index.ts` binds its own `git()` spawn helper and the fs/promises calls; the
 * tests bind a real git in a temp repo and the real filesystem. Either way the
 * decisions below are the same code — there is no second implementation to
 * fall out of step with.
 */
export interface WriteCheckedIo {
  /** Run git in `cwd`. Must not throw — report through `exitCode`/`stderr`. */
  readonly git: (cwd: string, argv: readonly string[]) => Promise<GitRun>
  /** Whether the path exists on disk (the explicit not-exist check). */
  readonly exists: (path: string) => Promise<boolean>
  /** Write whole bytes to a path — the buffer as-is, LF, no translation. */
  readonly writeBytes: (path: string, bytes: Uint8Array) => Promise<void>
  /** Renames a path over another; retried by {@link renameWithRetry}. */
  readonly rename: (from: string, to: string) => Promise<void>
  /** Best-effort temp cleanup; a file already gone is a success. */
  readonly remove: (path: string) => Promise<void>
  /** Waits the given milliseconds — the rename retry backoff. */
  readonly delay: (ms: number) => Promise<void>
}

/**
 * Run one checked write end to end. Never throws: every failure, including an
 * IO failure, is a result the RPC can carry back as a sentence.
 *
 * The order of the steps is the contract: the path lock, then the sha as git
 * reads it RIGHT NOW, then the refusal before anything is staged, then the
 * atomic write, and only then the sha the next save will be checked against.
 */
export async function runWriteChecked(
  io: WriteCheckedIo,
  cwd: string,
  path: string,
  text: string,
  expectedSha: string,
): Promise<WriteResult> {
  try {
    return await writeChecked(io, cwd, path, text, expectedSha)
  } catch (error) {
    // Nothing may throw across the RPC boundary: a failed helper is a failed
    // save with a message, not a broken call.
    return { ok: false, failure: 'unknown', error: error instanceof Error ? error.message : String(error) }
  }
}

async function writeChecked(
  io: WriteCheckedIo,
  cwd: string,
  path: string,
  text: string,
  expectedSha: string,
): Promise<WriteResult> {
  if (typeof path !== 'string' || !isSafePathArg(path)) {
    return { ok: false, failure: 'invalid', error: `unsafe path argument: ${JSON.stringify(path)}` }
  }
  if (typeof text !== 'string' || typeof expectedSha !== 'string') {
    return { ok: false, failure: 'invalid', error: 'text and expectedSha must be strings' }
  }
  // The path lock every filesystem write in this plugin passes — the same
  // `resolveInside`, not a second one. It throws on traversal spellings and on
  // anything resolving outside the worktree.
  let target: string
  try {
    target = resolveInside(cwd, path)
  } catch (error) {
    return { ok: false, failure: 'invalid', error: error instanceof Error ? error.message : String(error) }
  }

  // The sha as git reads it now. Absent is '', by stat rather than by reading
  // a spawn failure into it; a file that IS there but will not hash is a
  // failed save, never a stale one.
  let current: string
  const present = await io.exists(target)
  if (!present) {
    current = ''
  } else {
    const hashed = await io.git(cwd, ['hash-object', '--', path])
    if (hashed.exitCode !== 0) {
      return {
        ok: false, failure: 'unknown',
        error: `git hash-object failed (exit ${hashed.exitCode}) for ${path}${hashed.stderr.length > 0 ? `: ${hashed.stderr}` : ''}`,
      }
    }
    current = hashed.stdout.trim()
  }

  if (current !== expectedSha) {
    return { ok: false, failure: 'stale', error: staleMessage(path, expectedSha, current) }
  }

  // Atomic write: stage the bytes beside the target (same directory, so the
  // rename stays inside one filesystem), then rename over it with the shared
  // Windows-EPERM retry. The buffer is written as bytes exactly as received —
  // no newline translation anywhere in this path.
  const tmp = `${target}.gwtmp-${randomBytes(6).toString('hex')}`
  try {
    await io.writeBytes(tmp, Buffer.from(text, 'utf8'))
    await renameWithRetry(io.rename, io.delay, tmp, target)
  } catch (error) {
    // The write did not land; the temp must not linger in the tree as a
    // phantom untracked file. Cleanup must never mask the result it follows.
    await io.remove(tmp).catch(() => {})
    return {
      ok: false, failure: 'unknown',
      error: `could not write ${path}: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  // The sha the NEXT save is checked against, read back from the file that is
  // now on disk.
  const after = await io.git(cwd, ['hash-object', '--', path])
  if (after.exitCode !== 0) {
    return {
      ok: false, failure: 'unknown',
      error: `${path} was written but its new sha could not be read (exit ${after.exitCode})${after.stderr.length > 0 ? `: ${after.stderr}` : ''}`,
    }
  }
  return { ok: true, sha: after.stdout.trim() }
}

/**
 * Why the save was refused, in the reader's terms: which way the file moved.
 * Every spelling names the path, because the banner this lands in sits under a
 * file tab the reader may already have switched away from.
 */
function staleMessage(path: string, expectedSha: string, current: string): string {
  if (expectedSha === '') {
    return `${path} was created while you were editing it; nothing was written`
  }
  if (current === '') {
    return `${path} was deleted while you were editing it; nothing was written`
  }
  return `${path} changed while you were editing it; nothing was written`
}
