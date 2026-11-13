/**
 * The untracked path through the applyBlocks runner: a synthesized
 * new-file diff — `index.ts` cannot load under vitest (it imports its dsh
 * peers as values), `git diff` reports nothing for an untracked file, and
 * the synthesis IS the contract — `new file mode`, `@@ -0,0 +1,N @@`,
 * every line an addition, trailing newline included (a patch file whose
 * last line has no LF is "corrupt patch" to git apply; the host adds it
 * in `layerDiffText`). This is the only new-file diff the pane ever
 * renders for these files, so it is the one the runner must accept.
 */
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { runApplyBlocks, sha1Hex, type ApplyBlocksIo } from '../src/apply-blocks.js'
import { alignRows, blockCount, blockIsWholeFile, blockLines } from '../src/client/side-rows.ts'
import { parsePatch } from '../src/patch-model.ts'
import { initPatchRepo, makeRepoIo, repoGit, type RepoGit } from './apply-blocks-io.ts'

let repo = ''
let git: RepoGit = () => ''

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'gw-untracked-'))
  git = repoGit(repo)
  await initPatchRepo(repo, git)
})

afterEach(async () => {
  await rm(repo, { recursive: true, force: true })
})

/** The host's unstaged layer diff for an untracked file, restated — see
 *  the module doc for why the synthesis is the contract. */
function untrackedDiff(path: string): string {
  const text = readFileSync(join(repo, path), 'utf8')
  const body = text.endsWith('\n') ? text.slice(0, -1) : text
  return [
    `diff --git a/${path} b/${path}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${path}`,
    `@@ -0,0 +1,${body.split('\n').length} @@`,
    ...body.split('\n').map(line => `+${line}`),
  ].join('\n') + '\n'
}

/** The host's `isUntracked`, mirrored: no index entry and no HEAD entry. */
function isUntracked(path: string): boolean {
  if (git('ls-files', '--', path).trim().length > 0) return false
  try {
    git('rev-parse', '--verify', '--quiet', `HEAD:${path}`)
    return false
  } catch {
    return true
  }
}

/** `makeRepoIo`, with the untracked fallback `layerDiffText` performs
 *  host-side: an empty `git diff` for a file git has never seen is
 *  answered with the synthesized segment, not with ''. */
function untrackedAwareIo(): ApplyBlocksIo {
  const base = makeRepoIo(repo, git)
  return {
    ...base,
    layerDiff: async (path, layer) => {
      const diff = await base.layerDiff(path, layer)
      if (diff.length > 0 || layer === 'staged' || !isUntracked(path)) return diff
      return untrackedDiff(path)
    },
  }
}

/** An untracked file's unstaged shape: its whole content, one block. */
function untrackedBlocks(path: string): { lines: readonly number[]; sha: string } {
  const diff = untrackedDiff(path)
  const rows = alignRows(parsePatch(diff)!)
  // The precondition the confirmation's delete wording rests on: a new-file
  // diff has no context line, so the one block is the whole file.
  expect(blockCount(rows)).toBe(1)
  expect(blockIsWholeFile(rows, 0)).toBe(true)
  return { lines: blockLines(rows, 0), sha: sha1Hex(diff) }
}

describe('git accepts the untracked path the applyBlocks sequence produces', () => {
  it('stages the one block of an untracked file into the index', async () => {
    await writeFile(join(repo, 'fresh.ts'), 'one\ntwo\nthree\n')
    const { lines, sha } = untrackedBlocks('fresh.ts')
    const result = await runApplyBlocks(untrackedAwareIo(), repo, 'fresh.ts', 'unstaged', sha, lines, 'stage')
    expect(result).toEqual({ ok: true })

    // The new-file patch subset applied forward into the index: the file is
    // now staged whole (its only block is its whole content) and the working
    // tree never moved.
    const staged = git('diff', '--cached', '--', 'fresh.ts')
    expect(staged).toContain('new file mode 100644')
    for (const line of ['+one', '+two', '+three']) expect(staged).toContain(line)
    expect(git('diff', '--', 'fresh.ts')).toBe('')
    expect(git('status', '--porcelain', '--', 'fresh.ts').trim()).toBe('A  fresh.ts')
  })

  it('discards the whole only block of an untracked file and deletes it', async () => {
    await writeFile(join(repo, 'doomed.ts'), 'one\ntwo\nthree\n')
    const { lines, sha } = untrackedBlocks('doomed.ts')
    // Reverse-applying the new-file patch is a deletion: this is the case the
    // confirmation words as "deletes the file", not "rewrites the file".
    const result = await runApplyBlocks(untrackedAwareIo(), repo, 'doomed.ts', 'unstaged', sha, lines, 'discard')
    expect(result).toEqual({ ok: true })

    expect(existsSync(join(repo, 'doomed.ts'))).toBe(false)
    expect(git('status', '--porcelain', '--', 'doomed.ts').trim()).toBe('')
  })
})
