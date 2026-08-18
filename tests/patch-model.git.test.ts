import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { emitPatch, parsePatch, selectAll, type LineSelector } from '../src/patch-model.ts'
import { runApplyBlocks, sha1Hex, type ApplyBlocksIo } from '../src/apply-blocks.js'
import { alignRows, blockCount, blockLines } from '../src/client/side-rows.ts'

/**
 * The unit tests state what a patch SHOULD look like; git decides whether it
 * is one. These run the emitted text through `git apply --check`, which is the
 * same gate the host will put in front of every hunk operation — a count this
 * module gets wrong shows up here as "corrupt patch" rather than as a wrong
 * string nobody notices until a user clicks something.
 */

let repo = ''

function git(...args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' })
}

/** Feed a patch to git on stdin, the way the host will. */
function apply(patch: string, ...args: string[]): void {
  execFileSync('git', ['-C', repo, 'apply', ...args], { input: patch, encoding: 'utf8' })
}

// The two change sites must sit further apart than twice the default context,
// or git merges them into one hunk and every per-hunk assertion below is
// really testing the whole diff.
const FILLER = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10']
const V1 = ['const a = 1', 'const b = 2', 'const d = 4', ...FILLER, 'tail one', 'tail two', ''].join('\n')
const V2 = ['const a = 1', 'const b = 20', 'const c = 3', 'const d = 4', ...FILLER, 'tail one', 'tail TWO', ''].join('\n')

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'gw-patch-'))
  git('init', '-q', '.')
  git('config', 'user.email', 'probe@example.invalid')
  git('config', 'user.name', 'probe')
  git('config', 'core.autocrlf', 'false')
  await writeFile(join(repo, 'f.ts'), V1)
  git('add', '--', 'f.ts')
  git('commit', '-qm', 'v1')
  await writeFile(join(repo, 'f.ts'), V2)
})

afterEach(async () => {
  await rm(repo, { recursive: true, force: true })
})

/** The working-tree diff, which is what a "stage this hunk" patch is built from. */
function workingDiff(): string {
  return git('-c', 'core.quotepath=false', 'diff', '--', 'f.ts')
}

describe('git accepts what emitPatch produces', () => {
  it('produces two hunks to work with', () => {
    const file = parsePatch(workingDiff())
    expect(file).not.toBeNull()
    expect(file!.hunks.length).toBeGreaterThanOrEqual(2)
  })

  const selections: Array<[string, LineSelector]> = [
    ['the whole diff', selectAll],
    ['the first hunk only', h => h === 0],
    ['the last hunk only', h => h === 1],
  ]

  for (const [label, selector] of selections) {
    it(`applies ${label} to the index`, () => {
      const file = parsePatch(workingDiff())!
      const patch = emitPatch(file, selector)
      expect(patch).not.toBe('')
      // `--cached` targets the index, which still holds v1 — exactly the
      // "stage this hunk" path. A bad count fails here, loudly.
      expect(() => apply(patch, '--cached', '--check')).not.toThrow()
    })
  }

  it('applies a per-line selection: additions kept, the deletion left behind', () => {
    const file = parsePatch(workingDiff())!
    // Take every `+` line and no `-` line. The unselected deletion must be
    // emitted as context, which is the rule most likely to be got wrong.
    const patch = emitPatch(file, (h, l) => file.hunks[h]!.lines[l]!.kind === 'add')
    expect(() => apply(patch, '--cached', '--check')).not.toThrow()
    apply(patch, '--cached')
    const staged = git('diff', '--cached', '--', 'f.ts')
    expect(staged).toContain('+const b = 20')
    expect(staged).toContain('+const c = 3')
    // The old line survives: this patch never claimed to remove it.
    expect(staged).not.toContain('-const b = 2')
  })

  it('applies a single hunk and leaves the other change unstaged', () => {
    const file = parsePatch(workingDiff())!
    apply(emitPatch(file, h => h === 1), '--cached')
    const staged = git('diff', '--cached', '--', 'f.ts')
    expect(staged).toContain('tail TWO')
    expect(staged).not.toContain('const c = 3')
    // and the first hunk is still only in the working tree
    expect(git('diff', '--', 'f.ts')).toContain('const c = 3')
  })

  it('reverses a hunk out of the working tree', () => {
    // The "discard this hunk" path: apply the patch backwards to the worktree.
    const file = parsePatch(workingDiff())!
    apply(emitPatch(file, h => h === 0), '--reverse')
    const now = git('diff', '--', 'f.ts')
    expect(now).not.toContain('const c = 3')
    expect(now).toContain('tail TWO')
  })

  it('refuses a patch whose file changed underneath it', async () => {
    // The concurrency guard, which is git's and costs nothing: the agent
    // rewrites the file while the reader is picking lines.
    const file = parsePatch(workingDiff())!
    const patch = emitPatch(file, selectAll)
    await writeFile(join(repo, 'f.ts'), 'totally different\n')
    git('add', '--', 'f.ts')
    expect(() => apply(patch, '--cached', '--check')).toThrow()
  })

  it('handles a file with no trailing newline', async () => {
    await writeFile(join(repo, 'f.ts'), V2.trimEnd())
    const file = parsePatch(workingDiff())!
    expect(() => apply(emitPatch(file, selectAll), '--cached', '--check')).not.toThrow()
  })

  it('handles CRLF content', async () => {
    await writeFile(join(repo, 'crlf.txt'), 'one\r\ntwo\r\n')
    git('add', '--', 'crlf.txt')
    git('commit', '-qm', 'crlf')
    await writeFile(join(repo, 'crlf.txt'), 'one\r\nTWO\r\n')
    const file = parsePatch(git('diff', '--', 'crlf.txt'))!
    expect(() => apply(emitPatch(file, selectAll), '--cached', '--check')).not.toThrow()
  })
})

/* ---- the applyBlocks sequence itself, over a real git ---- */

/**
 * The IO `index.ts` binds, bound to this temp repo instead: a real git for the
 * apply calls, the same full-context layer fetch `fileSides` serves, and the
 * patch parked in a file the way the host parks it in `os.tmpdir()`. Driving
 * the real runner means the sha check, the emission and the `--check` gate are
 * the code that ships, not a restatement of it.
 */
function repoIo(): ApplyBlocksIo {
  return {
    git: async (cwd, argv) => {
      try {
        return { stdout: execFileSync('git', ['-C', cwd, ...argv], { encoding: 'utf8' }), exitCode: 0, stderr: '' }
      } catch (error) {
        const failure = error as { stdout?: string; stderr?: string; status?: number }
        return { stdout: failure.stdout ?? '', exitCode: failure.status ?? 1, stderr: failure.stderr ?? '' }
      }
    },
    layerDiff: async (path, layer) => layer === 'staged'
      ? git('diff', '--cached', '-U1000000', '--', path)
      : git('diff', '-U1000000', '--', path),
    writePatch: async (text) => {
      const file = join(repo, '.block.patch')
      await writeFile(file, text, 'utf8')
      return file
    },
    dropPatch: async (file) => { await rm(file, { force: true }) },
  }
}

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
    const result = await runApplyBlocks(repoIo(), repo, 'f.ts', 'unstaged', sha, lines(1), 'stage')
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
    const result = await runApplyBlocks(repoIo(), repo, 'f.ts', 'unstaged', sha, lines(0), 'discard')
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
    expect(await runApplyBlocks(repoIo(), repo, 'f.ts', 'unstaged', sha, lines(1), 'stage')).toEqual({ ok: true })

    // The staged layer is its own diff (HEAD→index); the unstage selection is
    // expressed in THAT layer's coordinates, exactly as the pane renders it.
    const stagedDiff = git('diff', '--cached', '-U1000000', '--', 'f.ts')
    const stagedRows = alignRows(parsePatch(stagedDiff)!)
    expect(blockCount(stagedRows)).toBe(1)
    const result = await runApplyBlocks(
      repoIo(), repo, 'f.ts', 'staged', sha1Hex(stagedDiff), blockLines(stagedRows, 0), 'unstage',
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
    expect(await runApplyBlocks(repoIo(), repo, 'f.ts', 'unstaged', first.sha, first.lines(1), 'stage')).toEqual({ ok: true })
    const second = unstagedBlocks()
    expect(await runApplyBlocks(repoIo(), repo, 'f.ts', 'unstaged', second.sha, second.lines(0), 'stage')).toEqual({ ok: true })

    const stagedDiff = git('diff', '--cached', '-U1000000', '--', 'f.ts')
    const stagedRows = alignRows(parsePatch(stagedDiff)!)
    expect(blockCount(stagedRows)).toBe(2)
    // Unstaging block 0 leaves block 1 staged: the reverse apply's target (the
    // index) holds the post-image, so block 1's unselected addition must ride
    // as context — the mirrored emission rules.
    const result = await runApplyBlocks(
      repoIo(), repo, 'f.ts', 'staged', sha1Hex(stagedDiff), blockLines(stagedRows, 0), 'unstage',
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
    const result = await runApplyBlocks(repoIo(), repo, 'f.ts', 'unstaged', sha, lines(1), 'stage')
    expect(result).toMatchObject({ ok: false, failure: 'stale' })
    expect(result.error).toContain('f.ts')
    // Neither the index nor the tampered working tree moved.
    expect(git('diff', '--cached', '--', 'f.ts')).toBe('')
    expect(git('diff', '--', 'f.ts')).toContain('+rewritten')
  })
})
