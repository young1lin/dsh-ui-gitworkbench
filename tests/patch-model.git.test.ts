/**
 * What emitPatch emits, judged by git: the unit tests state what a patch
 * SHOULD look like; `git apply --check` decides whether it IS one — the
 * same gate the host puts in front of every hunk operation. A count this
 * module gets wrong shows up here as "corrupt patch" rather than as a
 * wrong string nobody notices until a user clicks something.
 *
 * The applyBlocks RUNNER suites live in apply-blocks.git.test.ts and
 * apply-blocks-untracked.git.test.ts: one temp repo each, all three in
 * parallel (this file was once all of them, serially).
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { emitPatch, parsePatch, selectAll, type LineSelector } from '../src/patch-model.ts'
import { V2, initPatchRepo, repoApply, repoGit, workingDiffOf } from './apply-blocks-io.ts'

let repo = ''
const git = (...args: string[]) => repoGit(repo)(...args)
const apply = (patch: string, ...args: string[]) => repoApply(repo)(patch, ...args)

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'gw-patch-'))
  await initPatchRepo(repo, git)
})

afterEach(async () => {
  await rm(repo, { recursive: true, force: true })
})

describe('git accepts what emitPatch produces', () => {
  it('produces two hunks to work with', () => {
    const file = parsePatch(workingDiffOf(git))
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
      const file = parsePatch(workingDiffOf(git))!
      const patch = emitPatch(file, selector)
      expect(patch).not.toBe('')
      // `--cached` targets the index, which still holds v1 — exactly the
      // "stage this hunk" path. A bad count fails here, loudly.
      expect(() => apply(patch, '--cached', '--check')).not.toThrow()
    })
  }

  it('applies a per-line selection: additions kept, the deletion left behind', () => {
    const file = parsePatch(workingDiffOf(git))!
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
    const file = parsePatch(workingDiffOf(git))!
    apply(emitPatch(file, h => h === 1), '--cached')
    const staged = git('diff', '--cached', '--', 'f.ts')
    expect(staged).toContain('tail TWO')
    expect(staged).not.toContain('const c = 3')
    // and the first hunk is still only in the working tree
    expect(git('diff', '--', 'f.ts')).toContain('const c = 3')
  })

  it('reverses a hunk out of the working tree', () => {
    // The "discard this hunk" path: apply the patch backwards to the worktree.
    const file = parsePatch(workingDiffOf(git))!
    apply(emitPatch(file, h => h === 0), '--reverse')
    const now = git('diff', '--', 'f.ts')
    expect(now).not.toContain('const c = 3')
    expect(now).toContain('tail TWO')
  })

  it('refuses a patch whose file changed underneath it', async () => {
    // The concurrency guard, which is git's and costs nothing: the agent
    // rewrites the file while the reader is picking lines.
    const file = parsePatch(workingDiffOf(git))!
    const patch = emitPatch(file, selectAll)
    await writeFile(join(repo, 'f.ts'), 'totally different\n')
    git('add', '--', 'f.ts')
    expect(() => apply(patch, '--cached', '--check')).toThrow()
  })

  it('handles a file with no trailing newline', async () => {
    await writeFile(join(repo, 'f.ts'), V2.trimEnd())
    const file = parsePatch(workingDiffOf(git))!
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
