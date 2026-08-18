/**
 * The applyBlocks sequence's decisions, without git: which combinations the
 * design defines, what the stale check refuses, and what reaches git in what
 * order. The real-git behaviour (an emitted patch actually staging, rolling
 * back, round-tripping) lives in `patch-model.git.test.ts` over the same
 * runner; this file pins the branches only git's exit code cannot reach.
 */
import { describe, expect, it } from 'vitest'

import {
  applyArgvFor, lineSelector, runApplyBlocks, sha1Hex,
  type ApplyBlocksIo, type GitRun,
} from '../src/apply-blocks.js'
import { emitPatch, parsePatch } from '../src/patch-model.ts'

/** One full-context diff, two change blocks — the shape every pane render
 *  produces: hunk line 1/2 are block 0, 4/5 are block 1. */
const TWO_BLOCKS = [
  'diff --git a/t.txt b/t.txt',
  '--- a/t.txt',
  '+++ b/t.txt',
  '@@ -1,5 +1,5 @@',
  ' one',
  '-two',
  '+TWO',
  ' three',
  '-four',
  '+FOUR',
  ' five',
  '',
].join('\n')

/** Two hunks: what a lower-context diff would look like, and what the runner
 *  must refuse rather than mis-apply (line indices repeat across hunks). */
const TWO_HUNKS = [
  'diff --git a/t.txt b/t.txt',
  '--- a/t.txt',
  '+++ b/t.txt',
  '@@ -1,2 +1,2 @@',
  ' a',
  '-b',
  '+B',
  '@@ -9,2 +9,2 @@',
  ' y',
  '-z',
  '+Z',
  '',
].join('\n')

interface IoLog {
  readonly gitCalls: ReadonlyArray<{ cwd: string; argv: readonly string[] }>
  readonly written: readonly string[]
  readonly dropped: readonly string[]
  readonly fetched: readonly string[]
}

/**
 * A recording stub: the sequence's decisions run for real, git does not. Each
 * queued reply answers the next `git` call; the queue's end answers exit 0.
 */
function stubIo(diff: string, replies: ReadonlyArray<Partial<GitRun>> = []): { io: ApplyBlocksIo; log: IoLog } {
  const gitCalls: Array<{ cwd: string; argv: readonly string[] }> = []
  const written: string[] = []
  const dropped: string[] = []
  const fetched: string[] = []
  let next = 0
  const io: ApplyBlocksIo = {
    git: async (cwd, argv) => {
      gitCalls.push({ cwd, argv })
      const reply: Partial<GitRun> = replies[next] ?? {}
      next += 1
      return { stdout: reply.stdout ?? '', exitCode: reply.exitCode ?? 0, stderr: reply.stderr ?? '' }
    },
    layerDiff: async (path, layer) => {
      fetched.push(`${layer}:${path}`)
      return diff
    },
    writePatch: async (text) => {
      written.push(text)
      return `stub-${written.length}.patch`
    },
    dropPatch: async (file) => { dropped.push(file) },
  }
  return { io, log: { gitCalls, written, dropped, fetched } }
}

describe('applyArgvFor', () => {
  it('maps the three defined mode/layer pairs to their git spellings', () => {
    expect(applyArgvFor('stage', 'unstaged')).toEqual(['apply', '--cached'])
    expect(applyArgvFor('unstage', 'staged')).toEqual(['apply', '--cached', '--reverse'])
    expect(applyArgvFor('discard', 'unstaged')).toEqual(['apply', '--reverse'])
  })

  it('rejects every other combination', () => {
    // Each mode is valid on exactly one layer; anything else — including the
    // crossed pairs and outright garbage — is not a defined operation.
    expect(applyArgvFor('stage', 'staged')).toBeNull()
    expect(applyArgvFor('unstage', 'unstaged')).toBeNull()
    expect(applyArgvFor('discard', 'staged')).toBeNull()
    expect(applyArgvFor('revert', 'unstaged')).toBeNull()
    expect(applyArgvFor('stage', 'working-tree')).toBeNull()
  })
})

describe('lineSelector', () => {
  it('selects exactly the given hunk-line indices', () => {
    const file = parsePatch(TWO_BLOCKS)!
    // Block 0's indices, per side-rows' blockLines: lines 1 and 2.
    const emitted = emitPatch(file, lineSelector([1, 2]))
    expect(emitted).toContain('-two')
    expect(emitted).toContain('+TWO')
    // Block 1's change is not part of this patch: its deletion stays context
    // and its addition is gone, per git's add -p rules.
    expect(emitted).toContain(' four')
    expect(emitted).not.toContain('+FOUR')
  })

  it('ignores values that are not hunk-line indices', () => {
    // `lines` crosses the RPC boundary untyped. A stray string or float must
    // select nothing rather than mis-address a line; an empty or garbage list
    // is an empty selection, which the runner treats as a no-op.
    const file = parsePatch(TWO_BLOCKS)!
    const selector = lineSelector([1, 2, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY])
    expect(emitPatch(file, selector)).toBe(emitPatch(file, lineSelector([1, 2])))
    expect(emitPatch(file, lineSelector([] as unknown as readonly number[]))).toBe('')
  })
})

describe('runApplyBlocks', () => {
  it('rejects a mode the design does not define on that layer, before any fetch', async () => {
    const { io, log } = stubIo(TWO_BLOCKS)
    // discard is an unstaged-layer mode; on the staged layer it is not one of
    // the three defined pairs.
    const result = await runApplyBlocks(io, '/repo', 't.txt', 'staged', sha1Hex(TWO_BLOCKS), [1, 2], 'discard')
    expect(result).toMatchObject({ ok: false, failure: 'invalid' })
    expect(result.error).toContain('discard')
    expect(log.fetched).toEqual([])
    expect(log.gitCalls).toEqual([])
  })

  it('rejects an unsafe path argument before anything runs', async () => {
    const { io, log } = stubIo(TWO_BLOCKS)
    const result = await runApplyBlocks(io, '/repo', '--flags', 'unstaged', sha1Hex(TWO_BLOCKS), [1], 'stage')
    expect(result).toMatchObject({ ok: false, failure: 'invalid' })
    expect(log.fetched).toEqual([])
    expect(log.gitCalls).toEqual([])
  })

  it('refuses a stale diff, naming the file, and touches nothing', async () => {
    const { io, log } = stubIo(TWO_BLOCKS)
    const result = await runApplyBlocks(io, '/repo', 't.txt', 'unstaged', sha1Hex('something else'), [1, 2], 'stage')
    expect(result).toMatchObject({ ok: false, failure: 'stale' })
    expect(result.error).toContain('t.txt')
    // The stale check is the first git-adjacent step: the fetch happened, the
    // patch never did.
    expect(log.fetched).toEqual(['unstaged:t.txt'])
    expect(log.written).toEqual([])
    expect(log.gitCalls).toEqual([])
  })

  it('treats an empty selection as a no-op, not an error', async () => {
    const { io, log } = stubIo(TWO_BLOCKS)
    const result = await runApplyBlocks(io, '/repo', 't.txt', 'unstaged', sha1Hex(TWO_BLOCKS), [], 'stage')
    expect(result).toEqual({ ok: true })
    expect(log.written).toEqual([])
    expect(log.gitCalls).toEqual([])
  })

  it('treats a diff with no hunk and a matching sha the same way', async () => {
    const { io, log } = stubIo('', [])
    const result = await runApplyBlocks(io, '/repo', 't.txt', 'unstaged', sha1Hex(''), [1], 'stage')
    expect(result).toEqual({ ok: true })
    expect(log.gitCalls).toEqual([])
  })

  it('rejects a multi-hunk diff rather than mis-applying positional indices', async () => {
    // Hunk line indices restart per hunk, so "line 1" in a two-hunk diff names
    // a line in EACH hunk. The runner must refuse the whole call instead.
    const { io, log } = stubIo(TWO_HUNKS)
    const result = await runApplyBlocks(io, '/repo', 't.txt', 'unstaged', sha1Hex(TWO_HUNKS), [1, 2], 'stage')
    expect(result).toMatchObject({ ok: false, failure: 'invalid' })
    expect(result.error).toContain('hunk')
    expect(log.written).toEqual([])
    expect(log.gitCalls).toEqual([])
  })

  it('checks with the same flags, then applies, then deletes the patch file', async () => {
    const { io, log } = stubIo(TWO_BLOCKS)
    const result = await runApplyBlocks(io, '/repo', 't.txt', 'unstaged', sha1Hex(TWO_BLOCKS), [1, 2], 'stage')
    expect(result).toEqual({ ok: true })
    expect(log.gitCalls.map(call => call.argv)).toEqual([
      ['apply', '--cached', '--check', 'stub-1.patch'],
      ['apply', '--cached', 'stub-1.patch'],
    ])
    expect(log.dropped).toEqual(['stub-1.patch'])
  })

  it('carries git --check stderr verbatim on a refused patch', async () => {
    const { io, log } = stubIo(TWO_BLOCKS, [{ exitCode: 1, stderr: 'error: patch failed: t.txt:2' }])
    const result = await runApplyBlocks(io, '/repo', 't.txt', 'unstaged', sha1Hex(TWO_BLOCKS), [1, 2], 'stage')
    expect(result).toMatchObject({ ok: false, failure: 'unknown', error: 'error: patch failed: t.txt:2' })
    // The refused apply stops before the real one, and cleanup still ran.
    expect(log.gitCalls).toHaveLength(1)
    expect(log.dropped).toEqual(['stub-1.patch'])
  })

  it('reports a failed apply and still deletes the patch file', async () => {
    const { io, log } = stubIo(TWO_BLOCKS, [{}, { exitCode: 1, stderr: 'error: t.txt: does not match index' }])
    const result = await runApplyBlocks(io, '/repo', 't.txt', 'unstaged', sha1Hex(TWO_BLOCKS), [1, 2], 'discard')
    expect(result).toMatchObject({ ok: false, error: 'error: t.txt: does not match index' })
    expect(log.gitCalls.map(call => call.argv)).toEqual([
      ['apply', '--reverse', '--check', 'stub-1.patch'],
      ['apply', '--reverse', 'stub-1.patch'],
    ])
    expect(log.dropped).toEqual(['stub-1.patch'])
  })

  it('folds a throwing IO into a failed result rather than throwing', async () => {
    const io: ApplyBlocksIo = {
      ...stubIo(TWO_BLOCKS).io,
      writePatch: async () => { throw new Error('tmpdir is full') },
    }
    const result = await runApplyBlocks(io, '/repo', 't.txt', 'unstaged', sha1Hex(TWO_BLOCKS), [1, 2], 'stage')
    expect(result).toMatchObject({ ok: false, failure: 'unknown', error: 'tmpdir is full' })
  })
})
