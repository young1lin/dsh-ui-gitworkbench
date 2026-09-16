/**
 * The prefix the agent is told to apply must be the one RESOLVED against the
 * session cwd, at both places the host spells it: the `worktree_enter` hint
 * and the standing `worktree:binding` notice.
 *
 * The worktree lives under the repository root; a session opened at a
 * subdirectory reaches it through `..`. A constant `.agents/worktrees/<name>`
 * told such a session's agent to prefix paths with a directory that did not
 * exist there — and file tools then created the files inside the MAIN tree.
 * `worktreeRel` is the one function that knows the difference
 * (`worktree-bindings.test.ts` pins its answers); this guard pins that
 * `index.ts` asks it, at both sites, in the shape of `host-rooted-paths
 * .test.ts`: comments stripped first, and each site matched exactly so a
 * regex that stops matching fails rather than passes.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(fileURLToPath(new URL('../src/index.ts', import.meta.url)), 'utf8')

/** Comments stripped before anything is matched — see the file header. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const host = code(source)

/** The statement that opens at `at` and runs to the end of that line. */
function lineAt(at: number): string {
  const start = host.lastIndexOf('\n', at) + 1
  const end = host.indexOf('\n', at)
  return host.slice(start, end < 0 ? host.length : end)
}

describe('the worktree prefix the host spells for the agent', () => {
  it('the standing notice is given the prefix resolved against the session cwd', () => {
    const calls = [...host.matchAll(/bindingNotice\(/g)]
    expect(calls).toHaveLength(1)
    const line = lineAt(calls[0]!.index)
    expect(line).toMatch(/worktreeRel\(/)
    expect(line).toMatch(/session\.header\?\.cwd/)
  })

  it('the enter hint spells the same resolved prefix, never one built from the name', () => {
    const enter = host.indexOf('async worktreeEnter(')
    expect(enter).toBeGreaterThan(0)
    const exit = host.indexOf('async worktreeExit(', enter)
    const body = host.slice(enter, exit)
    expect(body).toMatch(/const rel = worktreeRel\(/)
    expect(body).not.toMatch(/`\.agents\/worktrees\/\$\{/)
  })
})
