/**
 * The `applyBlocks` sequence: turn "these hunk lines of this block" into a git
 * index or working-tree mutation.
 *
 * The client sends a SELECTION, never patch text — a patch is a file-addressing
 * format, and accepting one from the browser would be a write primitive with a
 * path argument. So the host re-fetches the layer's diff itself, proves the
 * client is describing the same snapshot (sha1 of the fetched text must equal
 * the `diffSha` the pane rendered), and only then emits and applies.
 *
 * The sequence's every branch lives here rather than in `index.ts`, because
 * `index.ts` extends the RPC service class and imports its dsh peers as values
 * — vitest cannot load it. Everything git- or filesystem-shaped is injected
 * (`ApplyBlocksIo`), which is also what lets the git-backed tests drive this
 * exact code with a real git in a temp repo instead of a mock of it.
 *
 * Nothing here builds a destructive command: the whole vocabulary is
 * `git apply`, forward into the index (`--cached`) or reverse out of the index
 * or the working tree (`--reverse`). The one argv that carries file content is
 * the host-written tmpfile, never a client string; the client's `path` is
 * checked with `isSafePathArg` and reaches git only inside the layer-diff
 * fetch, behind `--`, as every other pathspec in this plugin is.
 *
 * @module @young1lin/dsh-ui-gitworkbench/apply-blocks
 */

import { createHash } from 'node:crypto'

import { classifyFailure, isSafePathArg, type OpFailure } from './git-ops.js'
import { emitPatch, parsePatch, type LineSelector } from './patch-model.js'

/**
 * Whether a mode applies its patch with `--reverse`, which decides the
 * emission rules: a reverse apply's target holds the patch's post-image (the
 * index for `unstage`, the working tree for `discard`), so unselected lines
 * must be presented the post-image sees them — `emitPatch`'s third argument.
 */
function appliesInReverse(mode: string): boolean {
  return mode !== 'stage'
}

/** The three block mutations, in the client's vocabulary. */
export type ApplyMode = 'stage' | 'unstage' | 'discard'

/** One git run, in the shape `index.ts`'s `git()` helper already returns. */
export interface GitRun {
  readonly stdout: string
  readonly exitCode: number
  readonly stderr: string
}

/** The result of one `applyBlocks` call — `GitOpResult`, structurally. */
export interface ApplyBlocksResult {
  readonly ok: boolean
  readonly failure?: OpFailure
  readonly error?: string
}

/**
 * Everything the sequence needs from its host, as injected dependencies.
 *
 * `index.ts` binds its own `git()` spawn helper, the layer-diff fetch it shares
 * with `fileSides`, and the tmpfile pair; the tests bind a real git in a temp
 * repo and a patch file inside it. Either way the decisions below are the same
 * code — there is no second implementation to fall out of step with.
 */
export interface ApplyBlocksIo {
  /** Run git in `cwd`. Must not throw — report through `exitCode`/`stderr`. */
  readonly git: (cwd: string, argv: readonly string[]) => Promise<GitRun>
  /** The layer's full-context diff — the exact fetch `fileSides` serves. */
  readonly layerDiff: (path: string, layer: string) => Promise<string>
  /** Write patch text where git can read it; returns the path. */
  readonly writePatch: (text: string) => Promise<string>
  /** Delete what `writePatch` produced. Called from a `finally`. */
  readonly dropPatch: (path: string) => Promise<void>
}

/**
 * The mode/layer matrix as argv: which `git apply` spelling carries each
 * mutation, and the one layer each is valid on.
 *
 * @returns the argv head for the mode, or null when the pair is not one the
 *          design defines — the caller reports it, never guesses a near one.
 */
export function applyArgvFor(mode: string, layer: string): readonly string[] | null {
  if (mode === 'stage' && layer === 'unstaged') return ['apply', '--cached']
  if (mode === 'unstage' && layer === 'staged') return ['apply', '--cached', '--reverse']
  if (mode === 'discard' && layer === 'unstaged') return ['apply', '--reverse']
  return null
}

/**
 * sha1 of a string, hex — the `diffSha` contract.
 *
 * This was a private helper of `index.ts` until the checker needed to be the
 * same code as the producer: `fileSides` stamps the diff it returns and
 * `applyBlocks` re-derives the stamp over its own fresh fetch, and the two ends
 * of that comparison must be one function or the comparison means nothing.
 */
export function sha1Hex(text: string): string {
  return createHash('sha1').update(text, 'utf8').digest('hex')
}

/**
 * The selector `emitPatch` takes for a block's line indices: a hunk line is
 * selected iff its index appears in `lines`.
 *
 * The indices are positional into the one hunk's `lines` — the same array
 * `side-rows.blockLines` read client-side. Only integers ≥ 0 count: `lines`
 * crosses the RPC boundary untyped, and a stray string or float selecting
 * nothing is the safe direction (an empty selection is a no-op, not an error).
 */
export function lineSelector(lines: readonly number[]): LineSelector {
  const list = Array.isArray(lines) ? lines : []
  const wanted = new Set(list.filter(line => Number.isInteger(line) && line >= 0))
  return (_hunkIndex: number, lineIndex: number) => wanted.has(lineIndex)
}

/**
 * Run one block mutation end to end. Never throws: every failure, including an
 * IO failure, is a result the RPC can carry back as a sentence.
 *
 * The order of the steps is the contract: the stale check before anything is
 * emitted, the multi-hunk guard before anything is applied, `--check` before
 * the apply that matters, and the tmpfile deleted whichever way it ends.
 */
export async function runApplyBlocks(
  io: ApplyBlocksIo,
  cwd: string,
  path: string,
  layer: string,
  diffSha: string,
  lines: readonly number[],
  mode: string,
): Promise<ApplyBlocksResult> {
  try {
    return await applyBlocksChecked(io, cwd, path, layer, diffSha, lines, mode)
  } catch (error) {
    // Nothing may throw across the RPC boundary: a failed helper is a failed
    // operation with a message, not a broken call.
    return { ok: false, failure: 'unknown', error: error instanceof Error ? error.message : String(error) }
  }
}

async function applyBlocksChecked(
  io: ApplyBlocksIo,
  cwd: string,
  path: string,
  layer: string,
  diffSha: string,
  lines: readonly number[],
  mode: string,
): Promise<ApplyBlocksResult> {
  if (typeof path !== 'string' || !isSafePathArg(path)) {
    return { ok: false, failure: 'invalid', error: `unsafe path argument: ${JSON.stringify(path)}` }
  }
  const argv = applyArgvFor(mode, layer)
  if (argv === null) {
    return { ok: false, failure: 'invalid', error: `cannot ${String(mode)} a block on the ${String(layer)} layer` }
  }

  // The stale check. The selection's line indices have meaning only against
  // the exact diff the pane rendered; a file that changed since makes them
  // point at different lines, so nothing is emitted, let alone applied.
  const diff = await io.layerDiff(path, layer)
  if (sha1Hex(diff) !== diffSha) {
    return { ok: false, failure: 'stale', error: `${path} changed since the diff was loaded; nothing was applied` }
  }

  const file = parsePatch(diff)
  // No hunk at all (empty or binary diff, with a sha that matches): there is
  // nothing to select, which is the empty selection's no-op, not an error.
  if (file === null) return { ok: true }
  // Hunk line indices restart per hunk, so "line 1" of a two-hunk diff names a
  // line in EACH hunk. Full context produces one hunk; anything else must be
  // refused whole rather than applied to the wrong lines.
  if (file.hunks.length > 1) {
    return {
      ok: false, failure: 'invalid',
      error: `the diff for ${path} carries ${file.hunks.length} hunks; block operations need the single full-context hunk`,
    }
  }

  const patch = emitPatch(file, lineSelector(lines), appliesInReverse(mode))
  // An empty selection is not an error, and `git apply` rejects a patch with
  // no hunks — so "nothing selected" must never reach git at all.
  if (patch.length === 0) return { ok: true }

  // The patch travels by tmpfile (`git()` spawns with `stdin: 'ignore'`), as
  // the LAST argument of the apply spelling chosen above. Deleted in the
  // finally whatever happens, so a refusal never litters the temp dir.
  const patchFile = await io.writePatch(patch)
  try {
    const check = await io.git(cwd, [...argv, '--check', patchFile])
    if (check.exitCode !== 0) return refusal(check)
    const applied = await io.git(cwd, [...argv, patchFile])
    if (applied.exitCode !== 0) return refusal(applied)
    return { ok: true }
  } finally {
    await io.dropPatch(patchFile).catch(() => {
      // Cleanup must never mask the result it follows; a tmpfile that is
      // already gone has done its job.
    })
  }
}

/** A refused apply: git's own message verbatim, classified for the banner. */
function refusal(run: GitRun): ApplyBlocksResult {
  const failure = classifyFailure(run.exitCode, run.stderr, run.stdout)
  const error = (run.stderr || run.stdout).trim().slice(-1000)
  // `classifyFailure` answers null only for a zero exit, which is not a
  // refusal and cannot reach here. The key is omitted rather than sent as
  // null anyway, because the gateway's payloads carry no empty fields.
  return failure === null ? { ok: false, error } : { ok: false, failure, error }
}
