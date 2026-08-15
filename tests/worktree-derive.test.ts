// tests/worktree-derive.test.ts
import { describe, expect, it } from 'vitest'
import { branchFor, parseWorktreeList, sanitizeName, worktreeDir } from '../src/worktree'

describe('sanitizeName', () => {
  const rng = () => 'ab12cd'
  it('keeps legal names', () => {
    expect(sanitizeName('test-worktree', rng)).toBe('test-worktree')
    expect(sanitizeName('feat_1.2', rng)).toBe('feat_1.2')
  })
  it('generates a name for empty/illegal input', () => {
    expect(sanitizeName(undefined, rng)).toBe('wt-ab12cd')
    expect(sanitizeName('', rng)).toBe('wt-ab12cd')
    expect(sanitizeName('../escape', rng)).toBe('wt-ab12cd')
    expect(sanitizeName('a b', rng)).toBe('wt-ab12cd')
  })
  it('rejects names that are not path-safe', () => {
    expect(sanitizeName('..', rng)).toBe('wt-ab12cd')
    expect(sanitizeName('.', rng)).toBe('wt-ab12cd')
    expect(sanitizeName('x'.repeat(41), rng)).toBe('wt-ab12cd')
  })
  it('keeps a name at the 40-character cap and the 1-character floor', () => {
    // The fixture's name-edge rows: "a" (minimum badge width) and the
    // 40-char fixture-maxname row are both legal; only the 41st character
    // tips over (TESTS.md E1).
    expect(sanitizeName('a', rng)).toBe('a')
    expect(sanitizeName('fixture-maxname-012345678901234567890123', rng)).toBe('fixture-maxname-012345678901234567890123')
  })
  it('generates a name for non-ASCII input', () => {
    // The 特性-a fixture row is hand-made on purpose: the enter path can
    // never create it, because the accepted alphabet is ASCII-only.
    expect(sanitizeName('特性-a', rng)).toBe('wt-ab12cd')
  })
})

describe('branchFor / worktreeDir', () => {
  it('derives branch and dir', () => {
    expect(branchFor('demo')).toBe('wt/demo')
    expect(worktreeDir('C:/repo', 'demo')).toBe('C:/repo/.agents/worktrees/demo')
  })
})

describe('parseWorktreeList', () => {
  it('parses entries and skips bare/detached', () => {
    const porcelain = [
      'worktree C:/repo', 'HEAD 1111111111111111111111111111111111111111', 'branch refs/heads/master', 'bare',
      '',
      'worktree C:/repo/.agents/worktrees/demo', 'HEAD 2222222222222222222222222222222222222222', 'branch refs/heads/wt/demo',
      '',
      'worktree C:/repo/.agents/worktrees/det', 'HEAD 3333333333333333333333333333333333333333', 'detached',
      '',
    ].join('\n')
    expect(parseWorktreeList(porcelain)).toEqual([
      { path: 'C:/repo', head: '1111111111111111111111111111111111111111', branch: 'master' },
      { path: 'C:/repo/.agents/worktrees/demo', head: '2222222222222222222222222222222222222222', branch: 'wt/demo' },
    ])
  })
  it('returns [] for empty input', () => {
    expect(parseWorktreeList('')).toEqual([])
  })
  it('lists a locked worktree and a prunable one', () => {
    // Locked (`git worktree lock`) and prunable (directory deleted) rows keep
    // their branch line: the switcher must still show both — only
    // `git worktree prune` clears the stale row (TESTS.md E5/E6). The parser
    // ignores the marker lines the way it ignores any unknown field.
    const porcelain = [
      'worktree C:/repo/.agents/worktrees/hotfix', 'HEAD 4444444444444444444444444444444444444444', 'branch refs/heads/wt/hotfix',
      'locked', 'locked reason=locked for a hotfix investigation',
      '',
      'worktree C:/repo/.agents/worktrees/stale', 'HEAD 5555555555555555555555555555555555555555', 'branch refs/heads/wt/stale',
      'prunable', 'prunable gitdir file points to non-existent location',
      '',
    ].join('\n')
    expect(parseWorktreeList(porcelain).map(entry => entry.branch)).toEqual(['wt/hotfix', 'wt/stale'])
  })
})
