/**
 * The applyBlocks sequence itself, over a real git: the SHIPPED runner
 * (sha check, emission, `--check` gate) against the IO index.ts binds,
 * bound to a temp repo. Stage, discard, and unstage at BLOCK granularity,
 * plus the stale-selection refusal — the tracked-file half of the story;
 * the untracked path lives in apply-blocks-untracked.git.test.ts.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { runApplyBlocks, sha1Hex } from '../src/apply-blocks.js'
import { alignRows, blockCount, blockLines } from '../src/client/side-rows.ts'
import { parsePatch } from '../src/patch-model.ts'
import { initPatchRepo, makeRepoIo, repoGit, type RepoGit } from './apply-blocks-io.ts'

let repo = ''
let git: RepoGit = () => ''

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'gw-blocks-'))
  git = repoGit(repo)
  await initPatchRepo(repo, git)
})

afterEach(async () => {
  await rm(repo, { recursive: true, force: true })
})

/** The working tree's unstaged blocks, in the coordinates applyBlocks takes. */
function unstagedBlocks(): { lines: (block: number) => readonly number[]; sha: string } {
  const diff = git('diff', '-U1000000', '--', 'f.ts')
  const rows = alignRows(parsePatch(diff)!)
  return { lines: (block: number) => blockLines(rows, block), sha: sha1Hex(diff) }
}

describe('git accepts what the applyBlocks sequence produces', () => {
  it('gives the working tree one full-context hunk in two blocks', () => {
    // The pane's precondition, and the sequence's: -U1000000 collapses the two
    // change sites into one hunk, and the context line between them keeps them
    // two BLOCKS — the unit the buttons act on.
    const diff = git('diff', '-U1000000', '--', 'f.ts')
    expect(parsePatch(diff)!.hunks).toHaveLength(1)
    expect(blockCount(alignRows(parsePatch(diff)!))).toBe(2)
  })

  it('stages block 1 and leaves block 0 unstaged', async () => {
    const { lines, sha } = unstagedBlocks()
    const result = await runApplyBlocks(makeRepoIo(repo, git), repo, 'f.ts', 'unstaged', sha, lines(1), 'stage')
    expect(result).toEqual({ ok: true })

    const staged = git('diff', '--cached', '--', 'f.ts')
    expect(staged).toContain('+tail TWO')
    expect(staged).not.toContain('const c = 3')
    // Block 0's change is still only in the working tree.
    const unstaged = git('diff', '--', 'f.ts')
    expect(unstaged).toContain('+const c = 3')
    expect(unstaged).not.toContain('tail TWO')
  })

  it('discards block 0 and reverts exactly those lines', async () => {
    const { lines, sha } = unstagedBlocks()
    const result = await runApplyBlocks(makeRepoIo(repo, git), repo, 'f.ts', 'unstaged', sha, lines(0), 'discard')
    expect(result).toEqual({ ok: true })

    // The block's edit is undone (b goes back to 2) and its insertion is gone;
    // block 1's edit survives untouched — the remaining unstaged diff is exactly
    // the other block's change.
    const unstaged = git('diff', '--', 'f.ts')
    expect(unstaged).toContain('+tail TWO')
    expect(unstaged).not.toContain('const c = 3')
    expect(unstaged).not.toContain('const b = 20')
  })

  it('unstages from the staged layer and round-trips the index', async () => {
    const { lines, sha } = unstagedBlocks()
    expect(await runApplyBlocks(makeRepoIo(repo, git), repo, 'f.ts', 'unstaged', sha, lines(1), 'stage')).toEqual({ ok: true })

    // The staged layer is its own diff (HEAD→index); the unstage selection is
    // expressed in THAT layer's coordinates, exactly as the pane renders it.
    const stagedDiff = git('diff', '--cached', '-U1000000', '--', 'f.ts')
    const stagedRows = alignRows(parsePatch(stagedDiff)!)
    expect(blockCount(stagedRows)).toBe(1)
    const result = await runApplyBlocks(
      makeRepoIo(repo, git), repo, 'f.ts', 'staged', sha1Hex(stagedDiff), blockLines(stagedRows, 0), 'unstage',
    )
    expect(result).toEqual({ ok: true })

    // Index back where it started: nothing staged, everything still in the
    // working tree.
    expect(git('diff', '--cached', '--', 'f.ts')).toBe('')
    expect(git('diff', '--', 'f.ts')).toContain('+const c = 3')
    expect(git('diff', '--', 'f.ts')).toContain('+tail TWO')
  })

  it('unstages one block of two staged, leaving the other staged', async () => {
    // Stage both blocks — the second stage happens against the diff that
    // remains after the first, which is what the pane re-renders.
    const first = unstagedBlocks()
    expect(await runApplyBlocks(makeRepoIo(repo, git), repo, 'f.ts', 'unstaged', first.sha, first.lines(1), 'stage')).toEqual({ ok: true })
    const second = unstagedBlocks()
    expect(await runApplyBlocks(makeRepoIo(repo, git), repo, 'f.ts', 'unstaged', second.sha, second.lines(0), 'stage')).toEqual({ ok: true })

    const stagedDiff = git('diff', '--cached', '-U1000000', '--', 'f.ts')
    const stagedRows = alignRows(parsePatch(stagedDiff)!)
    expect(blockCount(stagedRows)).toBe(2)
    // Unstaging block 0 leaves block 1 staged: the reverse apply's target (the
    // index) holds the post-image, so block 1's unselected addition must ride
    // as context — the mirrored emission rules.
    const result = await runApplyBlocks(
      makeRepoIo(repo, git), repo, 'f.ts', 'staged', sha1Hex(stagedDiff), blockLines(stagedRows, 0), 'unstage',
    )
    expect(result).toEqual({ ok: true })

    const staged = git('diff', '--cached', '--', 'f.ts')
    expect(staged).toContain('+tail TWO')
    expect(staged).not.toContain('const c = 3')
    expect(git('diff', '--', 'f.ts')).toContain('+const c = 3')
    expect(git('diff', '--', 'f.ts')).not.toContain('tail TWO')
  })

  it('refuses a stale selection and applies nothing', async () => {
    const { lines, sha } = unstagedBlocks()
    // The agent rewrites the file while the reader is picking a block.
    await writeFile(join(repo, 'f.ts'), 'const a = 1\nrewritten\n')
    const result = await runApplyBlocks(makeRepoIo(repo, git), repo, 'f.ts', 'unstaged', sha, lines(1), 'stage')
    expect(result).toMatchObject({ ok: false, failure: 'stale' })
    expect(result.error).toContain('f.ts')
    // Neither the index nor the tampered working tree moved.
    expect(git('diff', '--cached', '--', 'f.ts')).toBe('')
    expect(git('diff', '--', 'f.ts')).toContain('+rewritten')
  })
})
