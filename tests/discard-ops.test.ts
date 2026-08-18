import { describe, expect, it } from 'vitest'
import { isSafeRelativePath, planFor, planFromStatus, type DiscardPlan, type DiscardStep } from '../src/discard-ops.ts'

/** Every porcelain pair this feature can be asked about, with a plausible path. */
const EVERY_CASE: readonly (readonly [string, string, string?])[] = [
  ['??', 'new.txt'], ['!!', 'ignored.log'],
  ['A ', 'added.ts'], ['AM', 'added-then-edited.ts'], ['AD', 'added-then-removed.ts'],
  [' M', 'edited.ts'], ['M ', 'staged.ts'], ['MM', 'both.ts'], ['T ', 'typechange.ts'],
  [' D', 'gone.ts'], ['D ', 'staged-delete.ts'],
  ['R ', 'new-name.ts', 'old-name.ts'], ['RM', 'new-name2.ts', 'old-name2.ts'],
  ['UU', 'conflicted.ts'], ['AA', 'both-added.ts'],
]

const plans = (): DiscardPlan[] =>
  EVERY_CASE.map(([xy, path, prev]) => planFor(xy, path, prev)).filter((p): p is DiscardPlan => p !== null)

const gitSteps = (plan: DiscardPlan): readonly string[][] =>
  plan.steps.filter((s): s is Extract<DiscardStep, { kind: 'git' }> => s.kind === 'git').map(s => [...s.argv])

describe('planFor — semantics', () => {
  it('an untracked file is deleted, and says so', () => {
    const plan = planFor('??', 'notes/scratch.md')!
    expect(plan.effect).toBe('delete')
    expect(plan.irreversible).toBe(true)
    expect(plan.steps).toEqual([{ kind: 'delete', path: 'notes/scratch.md' }])
  })

  it('a staged-new file is unstaged and then deleted', () => {
    // Deleting first would leave the index holding an entry for a path that is
    // no longer on disk.
    const plan = planFor('A ', 'src/new.ts')!
    expect(plan.effect).toBe('delete')
    expect(plan.steps.map(s => s.kind)).toEqual(['git', 'delete'])
    expect(gitSteps(plan)[0]).toEqual(['restore', '--staged', '--', 'src/new.ts'])
  })

  it('a modified file goes back to HEAD in both trees, staged or not', () => {
    for (const xy of [' M', 'M ', 'MM']) {
      const plan = planFor(xy, 'src/a.ts')!
      expect(plan.effect, xy).toBe('restore')
      expect(plan.irreversible, xy).toBe(true)
      expect(gitSteps(plan)).toEqual([
        ['restore', '--source=HEAD', '--staged', '--worktree', '--', 'src/a.ts'],
      ])
    }
  })

  it('IDEA parity: staging is not asked about — a staged edit rolls back the same way', () => {
    expect(gitSteps(planFor('M ', 'x.ts')!)).toEqual(gitSteps(planFor(' M', 'x.ts')!))
  })

  it('a deleted file is recovery, not loss, and needs no confirmation', () => {
    for (const xy of [' D', 'D ']) {
      const plan = planFor(xy, 'src/gone.ts')!
      expect(plan.effect, xy).toBe('recover')
      expect(plan.irreversible, xy).toBe(false)
    }
  })

  it('a rename restores the old path BEFORE retiring the new one', () => {
    const plan = planFor('R ', 'src/new.ts', 'src/old.ts')!
    expect(plan.effect).toBe('unrename')
    expect(plan.previousPath).toBe('src/old.ts')
    expect(plan.steps).toEqual([
      { kind: 'git', argv: ['restore', '--source=HEAD', '--staged', '--worktree', '--', 'src/old.ts'] },
      { kind: 'git', argv: ['restore', '--staged', '--', 'src/new.ts'] },
      { kind: 'delete', path: 'src/new.ts' },
    ])
  })

  it('a rename with no previous path is refused rather than guessed at', () => {
    expect(() => planFor('R ', 'src/new.ts')).toThrow(/previous path/)
  })

  it('a conflicted file rolls back to HEAD — the markers are not content to keep', () => {
    const plan = planFor('UU', 'src/conflict.ts')!
    expect(plan.effect).toBe('restore')
  })

  it('a clean path has nothing to discard', () => {
    expect(planFor('  ', 'src/clean.ts')).toBe(null)
    expect(planFor('', 'src/clean.ts')).toBe(null)
  })
})

describe('planFor — safety', () => {
  it('no plan contains a destructive spelling', () => {
    // The guard `git-ops.ts` promises in prose, enforced over every plan this
    // module can produce. `clean` is the one that matters most: scoped to a
    // pathspec it looks harmless, and one missing `--` takes the whole tree.
    const FORBIDDEN = [/^clean$/, /^reset$/, /^checkout$/, /^rm$/, /--force/, /^-f$/, /^--hard$/]
    for (const plan of plans()) {
      for (const argv of gitSteps(plan)) {
        for (const arg of argv) {
          for (const pattern of FORBIDDEN) {
            expect(pattern.test(arg), `${arg} in ${argv.join(' ')}`).toBe(false)
          }
        }
      }
    }
  })

  it('every git step separates its pathspecs with --', () => {
    for (const plan of plans()) {
      for (const argv of gitSteps(plan)) {
        expect(argv, argv.join(' ')).toContain('--')
        // and nothing after the separator may read as an option
        for (const arg of argv.slice(argv.indexOf('--') + 1)) {
          expect(arg.startsWith('-'), arg).toBe(false)
        }
      }
    }
  })

  it('every git step is a restore', () => {
    for (const plan of plans()) {
      for (const argv of gitSteps(plan)) expect(argv[0]).toBe('restore')
    }
  })

  it('a path that reads as an option is refused', () => {
    expect(() => planFor('??', '-rf')).toThrow(/unsafe path/)
    expect(() => planFor(' M', '--all')).toThrow(/unsafe path/)
    expect(() => planFor('??', '')).toThrow(/unsafe path/)
  })
})

describe('isSafeRelativePath', () => {
  it('accepts ordinary repo-relative paths', () => {
    for (const path of ['a.ts', 'src/a.ts', 'a/b/c/d.ts', 'dir with spaces/x.md', '.github/x.yml', 'a..b/c.ts']) {
      expect(isSafeRelativePath(path), path).toBe(true)
    }
  })

  it('rejects traversal, including mid-path and backslash-spelled', () => {
    for (const path of ['../x', 'a/../../x', 'a/../b', '..', 'a\\..\\..\\x', 'a\\..\\b']) {
      expect(isSafeRelativePath(path), path).toBe(false)
    }
  })

  it('rejects absolutes, drive letters and UNC', () => {
    for (const path of ['/etc/passwd', 'C:/Windows/x', 'c:\\Windows\\x', '//server/share/x', '\\\\server\\share\\x']) {
      expect(isSafeRelativePath(path), path).toBe(false)
    }
  })

  it('rejects empties, option-lookalikes and NUL', () => {
    for (const path of ['', '-rf', '--force', 'a\0b']) {
      expect(isSafeRelativePath(path), path).toBe(false)
    }
  })

  it('guards every delete step a plan can produce', () => {
    // The property that matters: nothing reaches `fs.rm` unchecked.
    for (const plan of plans()) {
      for (const step of plan.steps) {
        if (step.kind === 'delete') expect(isSafeRelativePath(step.path), step.path).toBe(true)
      }
    }
    expect(() => planFor('??', '../outside.txt')).toThrow(/unsafe path to delete/)
    expect(() => planFor('A ', '../outside.txt')).toThrow(/unsafe path to delete/)
    expect(() => planFor('R ', '../outside.txt', 'old.ts')).toThrow(/unsafe path to delete/)
  })

  it('only the irreversible effects need a confirmation', () => {
    for (const plan of plans()) {
      expect(plan.irreversible, plan.effect).toBe(plan.effect !== 'recover')
    }
  })
})

describe('planFromStatus', () => {
  const REPORT = [
    '## main...origin/main',
    ' M src/edited.ts',
    'A  src/added.ts',
    '?? notes/scratch.md',
    ' D src/gone.ts',
    'R  src/old.ts -> src/new.ts',
    '?? src/été.ts',
  ].join('\n')

  it('finds the file among the whole tree report', () => {
    expect(planFromStatus(REPORT, 'src/edited.ts')!.effect).toBe('restore')
    expect(planFromStatus(REPORT, 'src/added.ts')!.effect).toBe('delete')
    expect(planFromStatus(REPORT, 'notes/scratch.md')!.effect).toBe('delete')
    expect(planFromStatus(REPORT, 'src/gone.ts')!.effect).toBe('recover')
  })

  it('keys a rename on the NEW path and carries the old one', () => {
    const plan = planFromStatus(REPORT, 'src/new.ts')!
    expect(plan.effect).toBe('unrename')
    expect(plan.previousPath).toBe('src/old.ts')
    // The old path is not itself a row in the drawer, so asking about it finds
    // nothing rather than planning something surprising.
    expect(planFromStatus(REPORT, 'src/old.ts')).toBe(null)
  })

  it('a non-ASCII path arrives raw and names the real file', () => {
    // The host spawns every git call with `-c core.quotepath=false` (see
    // `src/index.ts`), so status never octal-escapes a path on the way here —
    // which matters, because the unquoting in `parsePath` runs through
    // `JSON.parse`, and JSON has no octal escapes to decode.
    const plan = planFromStatus(REPORT, 'src/été.ts')
    expect(plan, 'non-ASCII path did not round-trip').not.toBe(null)
    expect(plan!.steps).toEqual([{ kind: 'delete', path: 'src/été.ts' }])
  })

  it('a path git does not report as changed plans nothing', () => {
    // What a stale tree looks like. Not an error: the file was already clean.
    expect(planFromStatus(REPORT, 'src/untouched.ts')).toBe(null)
    expect(planFromStatus('', 'src/anything.ts')).toBe(null)
  })

  it('never matches the branch header', () => {
    expect(planFromStatus(REPORT, 'main...origin/main')).toBe(null)
  })

  it('refuses an option-lookalike before scanning', () => {
    expect(() => planFromStatus(REPORT, '--force')).toThrow(/unsafe path/)
  })
})
