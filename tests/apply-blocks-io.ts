/**
 * Shared plumbing for the real-git patch suites: one temp-repo fixture
 * shape and the ApplyBlocksIo binding that runs the SHIPPED runner against
 * it. The suites are split so each owns a temp repo and runs in parallel;
 * the fixture itself must not fork between them — a rule this module
 * holds alone, which is why it is not test code.
 */
import { execFileSync } from 'node:child_process'
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { ApplyBlocksIo } from '../src/apply-blocks.js'
import { ISOLATED_GIT_ENV } from './git-env.ts'

/** A git bound to one repository root, the suites' only spawn shape. */
export type RepoGit = (...args: string[]) => string

export function repoGit(repo: string): RepoGit {
  return (...args) => execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8', env: ISOLATED_GIT_ENV,
  })
}

/** Feed a patch to git on stdin, the way the host will. */
export function repoApply(repo: string): (patch: string, ...args: string[]) => void {
  return (patch, ...args) => {
    execFileSync('git', ['-C', repo, 'apply', ...args], {
      input: patch, encoding: 'utf8', env: ISOLATED_GIT_ENV,
    })
  }
}

// The two change sites must sit further apart than twice the default context,
// or git merges them into one hunk and every per-block assertion below is
// really testing the whole diff.
const FILLER = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10']
export const V1 = ['const a = 1', 'const b = 2', 'const d = 4', ...FILLER, 'tail one', 'tail two', ''].join('\n')
export const V2 = ['const a = 1', 'const b = 20', 'const c = 3', 'const d = 4', ...FILLER, 'tail one', 'tail TWO', ''].join('\n')

/** A committed v1 with v2 sitting unstaged in the working tree: every
 *  suite's precondition, identical everywhere because it lives here. */
export async function initPatchRepo(repo: string, git: RepoGit): Promise<void> {
  git('init', '-q', '.')
  git('config', 'user.email', 'probe@example.invalid')
  git('config', 'user.name', 'probe')
  git('config', 'core.autocrlf', 'false')
  await writeFile(join(repo, 'f.ts'), V1)
  git('add', '--', 'f.ts')
  git('commit', '-qm', 'v1')
  await writeFile(join(repo, 'f.ts'), V2)
}

/** The working-tree diff, which is what a "stage this hunk" patch is built from. */
export function workingDiffOf(git: RepoGit): string {
  return git('-c', 'core.quotepath=false', 'diff', '--', 'f.ts')
}

/** The IO `index.ts` binds, bound to a temp repo instead: a real git for
 *  the apply calls, the same full-context layer fetch `fileSides` serves,
 *  and the patch parked in a file the way the host parks it in
 *  `os.tmpdir()`. Driving the real runner means the sha check, the
 *  emission and the `--check` gate are the code that ships. */
export function makeRepoIo(repo: string, git: RepoGit): ApplyBlocksIo {
  return {
    git: async (cwd, argv) => {
      try {
        return { stdout: execFileSync('git', ['-C', cwd, ...argv], { encoding: 'utf8', env: ISOLATED_GIT_ENV }), exitCode: 0, stderr: '' }
      } catch (error) {
        const failure = error as { stdout?: string; stderr?: string; status?: number }
        return { stdout: failure.stdout ?? '', exitCode: failure.status ?? 1, stderr: failure.stderr ?? '' }
      }
    },
    layerDiff: async (path, layer) => layer === 'staged'
      ? git('diff', '--cached', '-U1000000', '--', path)
      : git('diff', '-U1000000', '--', path),
    writePatch: async text => {
      const file = join(repo, '.block.patch')
      await writeFile(file, text, 'utf8')
      return file
    },
    dropPatch: async file => { await rm(file, { force: true }) },
  }
}
