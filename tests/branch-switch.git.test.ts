/**
 * The host-side guard behind branch switching, over a real git: only the MAIN
 * worktree may have its branch switched from the drawer. A linked worktree's
 * branch is the agent's to move (it entered it; it knows what it is doing
 * there), and the check must hold on the host, not just in what the client
 * chooses to render.
 *
 * Driven like `repo-root.git.test.ts`: a temp repo, real git through an
 * injected runner, the same code `index.ts` binds.
 */
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { isMainWorktree, type RootGit } from '../src/repo-root.ts'

let repo = ''
let linked = ''

function git(...args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' })
}

const runGit: RootGit = async (cwd, argv) => {
  try {
    return { stdout: execFileSync('git', ['-C', cwd, ...argv], { encoding: 'utf8' }), exitCode: 0, stderr: '' }
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; status?: number }
    return { stdout: failure.stdout ?? '', exitCode: failure.status ?? 1, stderr: failure.stderr ?? '' }
  }
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'gw-switch-'))
  git('init', '-q', '-b', 'main')
  git('config', 'core.autocrlf', 'false')
  git('config', 'user.email', 't@example.com')
  git('config', 'user.name', 'tester')
  await mkdir(join(repo, 'server'))
  await writeFile(join(repo, 'server', 'main.go'), 'v1\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'initial')
  linked = join(repo, '.agents', 'worktrees', 'demo')
  git('worktree', 'add', '-q', '-b', 'wt/demo', linked)
})

afterEach(async () => {
  await rm(repo, { recursive: true, force: true })
})

describe('isMainWorktree', () => {
  it('is true at the main worktree root', async () => {
    await expect(isMainWorktree(runGit, repo)).resolves.toBe(true)
  })

  it('is true from a subdirectory of the main worktree', async () => {
    // Sessions open subdirectories (a monorepo's `server/`); the guard must
    // not read "not at the root" as "not the main worktree".
    await expect(isMainWorktree(runGit, join(repo, 'server'))).resolves.toBe(true)
  })

  it('is false in a linked worktree', async () => {
    await expect(isMainWorktree(runGit, linked)).resolves.toBe(false)
  })

  it('is false outside a repository', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'gw-norepo-'))
    try {
      await expect(isMainWorktree(runGit, outside)).resolves.toBe(false)
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })
})
