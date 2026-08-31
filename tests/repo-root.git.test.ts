/**
 * The repository-root policy over a real git: what `resolveRepoRoot` /
 * `rootedDir` answer, and the git behaviors the whole arrangement rests on.
 *
 * The drawer's bug this module exists for: a session opened at a
 * SUBDIRECTORY of the repository (a monorepo's `server/`) listed the right
 * files but could do nothing with them — porcelain status and `--numstat`
 * print repository-relative paths wherever they run, while pathspecs,
 * `hash-object` arguments and `ls-tree` listings resolve against the
 * process cwd. Running everything at the root makes both halves agree.
 * The contract tests below pin those git-side facts: if a git upgrade ever
 * changed one, this suite would say so before the drawer went quiet again.
 *
 * File state is driven like `write-checked.git.test.ts`: a temp repo, real
 * git through an injected runner, the same code `index.ts` binds.
 */
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { resolveRepoRoot, rootedDir, type RootGit } from '../src/repo-root.ts'

let repo = ''
let sub = ''

function git(...args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' })
}

/** The runner `index.ts` binds: real git, never throwing, result-shaped. */
const runGit: RootGit = async (cwd, argv) => {
  try {
    return { stdout: execFileSync('git', ['-C', cwd, ...argv], { encoding: 'utf8' }), exitCode: 0, stderr: '' }
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; status?: number }
    return { stdout: failure.stdout ?? '', exitCode: failure.status ?? 1, stderr: failure.stderr ?? '' }
  }
}

const fwd = (path: string): string => path.replace(/\\/g, '/')

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'gw-root-'))
  sub = join(repo, 'server')
  await mkdir(sub)
  git('init', '-q', '-b', 'main')
  git('config', 'core.autocrlf', 'false')
  git('config', 'user.email', 't@example.com')
  git('config', 'user.name', 'tester')
  await writeFile(join(sub, 'main.go'), 'v1\n')
  await writeFile(join(repo, 'webapp.txt'), 'v1\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'initial')
  // One change inside the opened subdirectory, one outside it — the pair
  // that proved the old drawer was listing files it could not open.
  await writeFile(join(sub, 'main.go'), 'v2\n')
  await writeFile(join(repo, 'webapp.txt'), 'v2\n')
})

afterEach(async () => {
  await rm(repo, { recursive: true, force: true })
})

describe('resolveRepoRoot', () => {
  it('answers the repository root from a subdirectory, forward slashes', async () => {
    await expect(resolveRepoRoot(runGit, sub)).resolves.toBe(fwd(repo))
  })

  it('answers null outside a repository', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'gw-norepo-'))
    try {
      await expect(resolveRepoRoot(runGit, outside)).resolves.toBeNull()
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })

  it('answers the worktree\u2019s own root for a linked worktree', async () => {
    const tree = join(repo, 'wt-a')
    git('worktree', 'add', '-q', tree, 'HEAD')
    await expect(resolveRepoRoot(runGit, tree)).resolves.toBe(fwd(tree))
  })
})

describe('rootedDir', () => {
  it('falls back to the directory itself outside a repository', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'gw-norepo-'))
    try {
      await expect(rootedDir(runGit, outside)).resolves.toBe(outside)
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })
})

describe('the git contract the root policy rests on', () => {
  it('porcelain status from a subdirectory is repository-relative and whole-tree', async () => {
    const out = await runGit(sub, ['status', '--porcelain=v1', '--untracked-files=all'])
    expect(out.exitCode).toBe(0)
    // Both sides of the tree, named from the ROOT — this is where the
    // drawer's `path` values come from.
    expect(out.stdout).toContain(' server/main.go')
    expect(out.stdout).toContain(' webapp.txt')
  })

  it('numstat from a subdirectory is whole-tree too', async () => {
    const out = await runGit(sub, ['diff', 'HEAD', '--numstat'])
    expect(out.exitCode).toBe(0)
    expect(out.stdout).toContain('\tserver/main.go')
    expect(out.stdout).toContain('\twebapp.txt')
  })

  it('a repository-relative pathspec matches NOTHING from a subdirectory, exit 0', async () => {
    const out = await runGit(sub, ['diff', 'HEAD', '--', 'server/main.go'])
    // The trap in one line: success-shaped, empty. Not an error anyone
    // could have surfaced — which is why the drawer went quietly blank.
    expect(out.exitCode).toBe(0)
    expect(out.stdout.trim()).toBe('')
  })

  it('the same pathspec from the ROOT is the diff the reader came for', async () => {
    const out = await runGit(repo, ['diff', 'HEAD', '--', 'server/main.go'])
    expect(out.exitCode).toBe(0)
    expect(out.stdout).toContain('diff --git a/server/main.go b/server/main.go')
  })

  it('hash-object doubles the prefix from a subdirectory and fails', async () => {
    const out = await runGit(sub, ['hash-object', '--', 'server/main.go'])
    expect(out.exitCode).not.toBe(0)
    expect(out.stderr).toContain('server/server/main.go')
  })

  it('ls-tree prints cwd-relative paths from a subdirectory', async () => {
    const out = await runGit(sub, ['ls-tree', '-r', '--name-only', 'HEAD'])
    expect(out.exitCode).toBe(0)
    // No `server/` prefix, and webapp.txt is missing entirely: a path
    // picker fed from here would hand the log filter pathspecs that match
    // nothing. This is why `repoTree` must run at the root.
    expect(out.stdout).toContain('main.go')
    expect(out.stdout).not.toContain('server/main.go')
    expect(out.stdout).not.toContain('webapp.txt')
  })
})

describe('the rooted read, end to end at the git level', () => {
  it('shows what status lists: path from the subdirectory\u2019s status, diff at rootedDir', async () => {
    const status = await runGit(sub, ['status', '--porcelain=v1', '--untracked-files=all'])
    const listed = status.stdout.split('\n')
      .map(line => line.slice(3).trim())
      .find(path => path.endsWith('main.go'))
    expect(listed).toBeDefined()
    const dir = await rootedDir(runGit, sub)
    const diff = await runGit(dir, ['diff', 'HEAD', '--', listed!])
    expect(diff.exitCode).toBe(0)
    expect(diff.stdout).toContain('diff --git a/server/main.go b/server/main.go')
  })
})
