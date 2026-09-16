/**
 * The git fact behind `pushRemote`, over a real git: a first push names its
 * remote explicitly (`--set-upstream <remote> <branch>`), and a remote the
 * repository does not have is a fatal error, not a fallback. `origin` is a
 * convention of `git clone`, not of git — a clone whose remote was renamed,
 * or a repository whose only remote was added by hand under another name,
 * has none. The drawer used to hard-code it, and `syncStatus` showed the
 * button for any remote at all.
 *
 * Driven like `branch-switch.git.test.ts`: a temp repo, real git through an
 * injected runner, the same argv the host builds.
 */
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { pushArgv, pushRemote } from '../src/git-ops.ts'
import type { RootGit } from '../src/repo-root.ts'

let repo = ''
let bare = ''

function git(...args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' })
}

const runGit: RootGit = async (cwd, argv) => {
  try {
    return { stdout: execFileSync('git', ['-C', cwd, ...argv], { encoding: 'utf8', stdio: 'pipe' }), exitCode: 0, stderr: '' }
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; status?: number }
    return { stdout: failure.stdout ?? '', exitCode: failure.status ?? 1, stderr: failure.stderr ?? '' }
  }
}

const names = (stdout: string): string[] => stdout.split('\n').map(line => line.trim()).filter(line => line.length > 0)

beforeEach(async () => {
  bare = await mkdtemp(join(tmpdir(), 'gw-push-remote-'))
  execFileSync('git', ['init', '-q', '--bare', bare])
  repo = await mkdtemp(join(tmpdir(), 'gw-push-'))
  git('init', '-q', '-b', 'main')
  git('config', 'core.autocrlf', 'false')
  git('config', 'user.email', 't@example.com')
  git('config', 'user.name', 't')
  await writeFile(join(repo, 'a.txt'), 'a\n')
  git('add', 'a.txt')
  git('commit', '-q', '-m', 'init')
  // The one remote is NOT called origin.
  git('remote', 'add', 'upstream', bare)
})

afterEach(async () => {
  await rm(repo, { recursive: true, force: true })
  await rm(bare, { recursive: true, force: true })
})

describe('a first push at a repository whose remote is not origin', () => {
  it('fails on the hard-coded name — the fact the fix exists for', async () => {
    const out = await runGit(repo, pushArgv('main', 'origin'))
    expect(out.exitCode).not.toBe(0)
    expect(out.stderr).toMatch(/origin/)
  })

  it('reads an unset config key as empty stdout and a set one as its value', async () => {
    // What the RPC relies on: `--get` exits 1 with nothing on stdout for an
    // unset key, so `stdout.trim()` is the "unset" spelling `pushRemote`
    // takes; `branch.<name>.pushRemote` is read before `remote.pushDefault`,
    // which is git's own precedence for a push destination.
    const unset = await runGit(repo, ['config', '--get', 'branch.main.pushRemote'])
    expect(unset.exitCode).not.toBe(0)
    expect(unset.stdout.trim()).toBe('')
    git('config', 'remote.pushDefault', 'stale')
    git('config', 'branch.main.pushRemote', 'upstream')
    const branch = await runGit(repo, ['config', '--get', 'branch.main.pushRemote'])
    const repoWide = await runGit(repo, ['config', '--get', 'remote.pushDefault'])
    const configured = branch.stdout.trim() || repoWide.stdout.trim()
    expect(pushRemote(['upstream'], configured)).toEqual({ ok: true, remote: 'upstream' })
    expect(pushRemote(['upstream'], repoWide.stdout.trim()).ok).toBe(false)
  })

  it('lands, and tracks, at the remote the repository actually has', async () => {
    const chosen = pushRemote(names((await runGit(repo, ['remote'])).stdout), '')
    expect(chosen).toEqual({ ok: true, remote: 'upstream' })
    if (!chosen.ok) return
    const out = await runGit(repo, pushArgv('main', chosen.remote))
    expect(out.exitCode).toBe(0)
    expect(git('rev-parse', '--abbrev-ref', 'main@{upstream}').trim()).toBe('upstream/main')
  })
})
