/**
 * Where the header's branch switcher may appear: on the MAIN worktree, judged
 * by the ROOT of the viewed tree — never by the path the session opened.
 *
 * The bug this pins: a session opened at a subdirectory of the repository (a
 * monorepo's `server/`) had no branch switcher at all. The gate compared the
 * main worktree's path with the SESSION path, and `C:/repo` is not
 * `C:/repo/server`, so the control was never rendered — no error, nothing to
 * say why — while the host's own `switchBranch`, which resolves the root
 * first, would have accepted the call. Every other operation already ran at
 * the root (repo-root.ts); the switcher was the one control still reading the
 * raw session path.
 *
 * The comparison now runs against `stats.repoRoot`, the `--show-toplevel`
 * the polled stats call reports for the viewed tree. This guard reads the
 * panel as TEXT (comments stripped first — prose has satisfied a scanner in
 * this repo twice) and pins that the gate compares the root and nothing
 * else. The git-side fact it rests on, that `show-toplevel` and `worktree
 * list` spell the main path identically, is pinned in
 * branch-switch.git.test.ts.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const tsx = readFileSync(fileURLToPath(new URL('../src/client/GitWorkbenchPanel.tsx', import.meta.url)), 'utf8')
const host = readFileSync(fileURLToPath(new URL('../src/index.ts', import.meta.url)), 'utf8')

/** Comments stripped before anything is matched — see the file header. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('the branch switcher gate', () => {
  const panel = code(tsx)

  /** The JSX expression wrapping `<BranchSwitcher`: from its opening `{` to the tag. */
  function gate(): string {
    const at = panel.indexOf('<BranchSwitcher')
    // Vacuous-pass backstop: a panel that stopped rendering the switcher
    // would otherwise satisfy every "does not contain" below.
    expect(at, 'the panel does not render BranchSwitcher at all').toBeGreaterThanOrEqual(0)
    const open = panel.lastIndexOf('{', at)
    expect(open, 'BranchSwitcher is not inside a JSX expression').toBeGreaterThanOrEqual(0)
    return panel.slice(open, at)
  }

  it('compares the main worktree with the ROOT of the viewed tree', () => {
    expect(gate()).toContain('samePath(mainWorktreePath, stats.repoRoot)')
  })

  it('never reads the session path — a subdirectory is still the main worktree', () => {
    // Either spelling of "where the session is" reintroduces the bug: the
    // pinned source, the session cwd, or the path stats echoes back.
    expect(gate()).not.toContain('statsPath')
    expect(gate()).not.toContain('sessionPath')
    expect(gate()).not.toContain('stats.worktreePath')
  })
})

/**
 * The same family, one level up: which tree is the SESSION's own. Every
 * place the panel answers that — the picker's active row and its own-tree
 * dot, the source switch that clears the override rather than pinning the
 * session's tree, the effect that follows the agent across worktree_enter —
 * compares against `sessionPath`, and for a session opened at a subdirectory
 * the raw cwd matched nothing. `sessionTree` (worktree-view.ts) resolves
 * it to the root the host reports on `worktreeStatus`.
 */
describe("the session's own tree", () => {
  const panel = code(tsx)

  /** The declaration line of `name` in the panel. */
  function declaration(name: string): string {
    const at = panel.indexOf(`const ${name} = `)
    expect(at, `the panel does not declare ${name}`).toBeGreaterThanOrEqual(0)
    return panel.slice(at, panel.indexOf('\n', at))
  }

  it('resolves the session tree through sessionTree, from the root the host reports', () => {
    const line = declaration('sessionRoot')
    expect(line).toContain('sessionTree(')
    expect(line).toContain('repoRoot')
    expect(declaration('sessionPath')).toContain('?? sessionRoot')
  })

  it('follows the agent from the session ROOT, not from the raw cwd', () => {
    // The binding-follow effect: "the place the session used to be" must be
    // spelled the way the list spells it, or a pinned main row survives the
    // agent's enter for exactly the subdirectory session.
    const line = declaration('prevSource')
    expect(line).not.toMatch(/\?\?\s*worktreePath/)
    expect(line).toContain('sessionRoot')
  })

  it('clears the override, rather than pinning, on the session tree in EITHER spelling', () => {
    // The source switch: a binding path is forward-slash (worktreeDir), the
    // cwd arrives in the platform's own, so a raw `===` read the session's
    // own worktree as a third tree on Windows and pinned it.
    const at = panel.indexOf('const switchSource = ')
    expect(at).toBeGreaterThanOrEqual(0)
    const body = panel.slice(at, panel.indexOf('setGen(', at))
    expect(body).toContain('setSourcePath(samePath(next, sessionPath) ? null : next)')
  })

  it('the host hands the client that root on worktreeStatus, null-safe for JSON', () => {
    const status = code(host)
    const start = status.indexOf('async worktreeStatus(')
    expect(start).toBeGreaterThan(0)
    const body = status.slice(start, status.indexOf('@Remote(', start))
    expect(body).toContain('repoRoot: null')
    expect(body).toContain('repoRoot: root')
  })
})
