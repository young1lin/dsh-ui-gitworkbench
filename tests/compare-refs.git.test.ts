/**
 * The git facts compareRefs and commitStats rest on, against a real git —
 * the same discipline as repo-root.git.test.ts: a git upgrade that
 * changed one of these answers fails here before the drawer ships it.
 *
 *  1. UNRELATED HISTORIES: `git diff A...B` refuses with "no merge base",
     isNoMergeBaseError classifies that stderr, and the two-tip retry the
     service falls back to answers the full tree. `A..B` (the commits leg)
     lists every commit of B's own history.
 *  2. MERGES: plain `git show` prints NO diff for a two-parent commit —
     there is no single "before" — and `--first-parent` is what makes a
     merge show what it brought into the branch it landed on.
 */
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { isNoMergeBaseError } from '../src/git-ops.ts'
import { ISOLATED_GIT_ENV } from './git-env.ts'

let repo = ''

function git(...args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', env: ISOLATED_GIT_ENV })
}

/** The shape the service's runner binds: never throw, result-shaped. */
function runGit(argv: string[]): { stdout: string; exitCode: number; stderr: string } {
  try {
    return { stdout: execFileSync('git', ['-C', repo, ...argv], { encoding: 'utf8', env: ISOLATED_GIT_ENV }), exitCode: 0, stderr: '' }
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; status?: number }
    return { stdout: failure.stdout ?? '', exitCode: failure.status ?? 1, stderr: failure.stderr ?? '' }
  }
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'gw-compare-'))
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'probe@example.invalid')
  git('config', 'user.name', 'probe')
  git('config', 'core.autocrlf', 'false')
})

afterEach(async () => {
  await rm(repo, { recursive: true, force: true })
})

describe('unrelated histories (the compareRefs fallback)', () => {
  beforeEach(async () => {
    await writeFile(join(repo, 'a.txt'), 'from main\n')
    git('add', '--', 'a.txt')
    git('commit', '-qm', 'main root')
    // An orphan branch: no common ancestor with main, ever.
    git('checkout', '--orphan', 'other')
    git('rm', '-rqf', '.')
    await writeFile(join(repo, 'b.txt'), 'from other\n')
    git('add', '--', 'b.txt')
    git('commit', '-qm', 'other root')
  })

  it('refuses the three-dot diff with the stderr the fallback keys on', () => {
    const refused = runGit(['diff', '--numstat', '--no-renames', 'main...other'])
    expect(refused.exitCode).not.toBe(0)
    expect(isNoMergeBaseError(refused.stderr)).toBe(true)
  })

  it('answers the two-tip retry with the whole tree of the other side', () => {
    const twoTip = runGit(['diff', '--numstat', '--no-renames', 'main', 'other'])
    expect(twoTip.exitCode).toBe(0)
    expect(twoTip.stdout).toContain('b.txt')
  })

  it('counts every commit of the unrelated side as unique to it', () => {
    // compareRefs asks `base..head` for the commits leg unconditionally;
    // with no shared root, "reachable from head, not from base" is all of
    // head's history - not an error, and not empty.
    const log = runGit(['log', '--pretty=format:%s', 'main..other'])
    expect(log.exitCode).toBe(0)
    expect(log.stdout).toContain('other root')
    expect(log.stdout).not.toContain('main root')
  })
})

describe('merge commits (the commitStats --first-parent contract)', () => {
  beforeEach(async () => {
    await writeFile(join(repo, 'f.txt'), 'one\n')
    git('add', '--', 'f.txt')
    git('commit', '-qm', 'root')
    git('checkout', '-qb', 'feature')
    await writeFile(join(repo, 'f.txt'), 'one\ntwo\n')
    git('add', '--', 'f.txt')
    git('commit', '-qm', 'feature work')
    git('checkout', '-q', 'main')
    git('merge', '-q', '--no-ff', '-m', 'merge feature', 'feature')
  })

  it('has the two parents plain show cannot pick a "before" from', () => {
    const parents = git('rev-list', '--parents', '-n', '1', 'HEAD').trim().split(' ')
    expect(parents).toHaveLength(3) // hash + two parents
  })

  it('answers the same numstat without the flag on this git', () => {
    // Older gits printed NOTHING for a merge here (the empty pane selecting
    // a merge used to open with); this one diffs against the first parent by
    // default. Either way the flag is what PINS the answer: the pane must not
    // depend on which side of that change the local git is on.
    const plain = runGit(['show', '--numstat', '--format=', 'HEAD'])
    const first = runGit(['show', '--first-parent', '--numstat', '--format=', 'HEAD'])
    expect(plain.exitCode).toBe(0)
    expect(plain.stdout).toBe(first.stdout)
    expect(plain.stdout).toContain('f.txt')
  })

  it('diffs a merge against its first parent with --first-parent', () => {
    const first = runGit(['show', '--first-parent', '--numstat', '--format=', 'HEAD'])
    expect(first.exitCode).toBe(0)
    expect(first.stdout).toContain('f.txt')
  })

  it('is a byte-for-byte no-op on a single-parent commit', () => {
    const feature = git('rev-parse', 'feature').trim()
    const plain = runGit(['show', '--numstat', '--format=', feature]).stdout
    const first = runGit(['show', '--first-parent', '--numstat', '--format=', feature]).stdout
    expect(first).toBe(plain)
  })
})
