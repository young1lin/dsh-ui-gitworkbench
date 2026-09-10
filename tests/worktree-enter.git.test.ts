/**
 * The git contract worktreeEnter's branchName rests on, against a real git —
 * the same discipline as repo-root.git.test.ts. The branch DECISION is
 * resolveEnterBranch's unit tests in worktree-derive.test.ts; these pin what
 * git answers to the argv shapes the service emits, so a git upgrade that
 * changed either fact fails here before the drawer ships it.
 *
 *  1. `worktree add -b <branch>` accepts a SLASH branch — the whole point of
 *     the parameter: `feature/foo` is a legal branch and an impossible
 *     Windows directory, so the worktree name could never express it.
 *  2. When `-b` collides with an existing branch, `worktree add <dir>
 *     <branch>` checks that branch out — the fallback that lets a worktree
 *     named X land on existing branch Y.
 */
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

let repo = ''

function gitAt(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
}

/** Real git, never throwing, result-shaped — the runner index.ts binds. */
function runGit(cwd: string, argv: string[]): { stdout: string; exitCode: number; stderr: string } {
  try {
    return { stdout: execFileSync('git', ['-C', cwd, ...argv], { encoding: 'utf8' }), exitCode: 0, stderr: '' }
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; status?: number }
    return { stdout: failure.stdout ?? '', exitCode: failure.status ?? 1, stderr: failure.stderr ?? '' }
  }
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'gw-enter-'))
  execFileSync('git', ['-C', repo, 'init', '-q', '-b', 'main'])
  gitAt(repo, 'config', 'core.autocrlf', 'false')
  gitAt(repo, 'config', 'user.email', 't@example.com')
  gitAt(repo, 'config', 'user.name', 'tester')
  await writeFile(join(repo, 'a.txt'), 'v1\n')
  gitAt(repo, 'add', '-A')
  gitAt(repo, 'commit', '-q', '-m', 'initial')
})

afterEach(async () => {
  await rm(repo, { recursive: true, force: true })
})

describe('the git contract branchName rests on', () => {
  it('worktree add -b creates a slash branch in a directory that cannot spell it', () => {
    const dir = join(repo, '.agents', 'worktrees', 'demo')
    const out = runGit(repo, ['worktree', 'add', '-b', 'feature/foo', dir])
    expect(out.exitCode).toBe(0)
    expect(gitAt(dir, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('feature/foo')
  })

  it('falls back to checking out the existing branch when -b collides, branch ≠ dir name', () => {
    gitAt(repo, 'branch', 'fix/token-cache')
    const dir = join(repo, '.agents', 'worktrees', 'demo')
    const add = runGit(repo, ['worktree', 'add', '-b', 'fix/token-cache', dir])
    expect(add.exitCode).not.toBe(0)
    // The probe the service runs before committing to the fallback.
    const verify = runGit(repo, ['rev-parse', '--verify', '--quiet', 'refs/heads/fix/token-cache'])
    expect(verify.exitCode).toBe(0)
    const retry = runGit(repo, ['worktree', 'add', dir, 'fix/token-cache'])
    expect(retry.exitCode).toBe(0)
    expect(gitAt(dir, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('fix/token-cache')
  })

  it('git itself refuses a .lock branch — the pre-validation mirrors git, not paranoia', () => {
    const dir = join(repo, '.agents', 'worktrees', 'demo')
    const out = runGit(repo, ['worktree', 'add', '-b', 'feature.lock', dir])
    expect(out.exitCode).not.toBe(0)
    expect(out.stderr).toContain('.lock')
  })
})
