// tests/worktree-derive.test.ts
import { describe, expect, it } from 'vitest'
import { findRegisteredWorktree, parseWorktreeList, sanitizeName, worktreeDir } from '../src/worktree'

describe('sanitizeName', () => {
  const rng = () => 'ab12cd'
  it('keeps legal names', () => {
    expect(sanitizeName('test-worktree', rng)).toBe('test-worktree')
    expect(sanitizeName('feat_1.2', rng)).toBe('feat_1.2')
  })
  it('accepts what git allows a ref and NTFS a directory — plus included', () => {
    // `+` is legal in both worlds; the old allowlist rejected it and silently
    // renamed a real `feature+20260810-...` to a generated name.
    expect(sanitizeName('feature+20260810-ai-customer-service', rng)).toBe('feature+20260810-ai-customer-service')
    expect(sanitizeName('a.b_c-d+e', rng)).toBe('a.b_c-d+e')
  })
  it('generates a name for empty/illegal input', () => {
    expect(sanitizeName(undefined, rng)).toBe('worktree-ab12cd')
    expect(sanitizeName('', rng)).toBe('worktree-ab12cd')
    expect(sanitizeName('../escape', rng)).toBe('worktree-ab12cd')
    expect(sanitizeName('a b', rng)).toBe('worktree-ab12cd')
  })
  it('rejects names that are not path-safe', () => {
    expect(sanitizeName('..', rng)).toBe('worktree-ab12cd')
    expect(sanitizeName('.', rng)).toBe('worktree-ab12cd')
    expect(sanitizeName('x'.repeat(65), rng)).toBe('worktree-ab12cd')
    expect(sanitizeName('a..b', rng)).toBe('worktree-ab12cd')
    expect(sanitizeName('name.', rng)).toBe('worktree-ab12cd')
    expect(sanitizeName('foo.lock', rng)).toBe('worktree-ab12cd')
    expect(sanitizeName('-x', rng)).toBe('worktree-ab12cd')
    expect(sanitizeName('+x', rng)).toBe('worktree-ab12cd')
  })
  it('rejects Windows-reserved and git-ambiguous names', () => {
    // CON is a fine git branch and a catastrophic directory; `head` as a
    // branch is ambiguous in git itself.
    expect(sanitizeName('CON', rng)).toBe('worktree-ab12cd')
    expect(sanitizeName('con', rng)).toBe('worktree-ab12cd')
    expect(sanitizeName('NUL.txt', rng)).toBe('worktree-ab12cd')
    expect(sanitizeName('head', rng)).toBe('worktree-ab12cd')
  })
  it('keeps a name at the 64-character cap and the 1-character floor', () => {
    expect(sanitizeName('a', rng)).toBe('a')
    expect(sanitizeName('x'.repeat(64), rng)).toBe('x'.repeat(64))
  })
  it('generates a name for non-ASCII input', () => {
    // The 特性-a fixture row is hand-made on purpose: the enter path can
    // never create it, because the accepted alphabet is ASCII-only.
    expect(sanitizeName('特性-a', rng)).toBe('worktree-ab12cd')
  })
})

describe('worktreeDir', () => {
  it('derives dir', () => {
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

describe('findRegisteredWorktree', () => {
  // The junction world the host runs in: `.agents/worktrees` is a junction to
  // `.claude/worktrees`, so two spellings name one directory, and git lists
  // the spelling the FOREIGN tool registered — not the one this session
  // would type.
  const entries = parseWorktreeList([
    'worktree C:/repo', 'HEAD 1111111111111111111111111111111111111111', 'branch refs/heads/main', '',
    'worktree C:/repo/.claude/worktrees/feature+20260810', 'HEAD 2222222222222222222222222222222222222222', 'branch refs/heads/feature+20260810', '',
  ].join('\n'))
  const junction = new Map<string, string>([
    ['C:/repo/.agents/worktrees/feature+20260810', 'C:/repo/.claude/worktrees/feature+20260810'],
  ])
  const resolver = (path: string) => {
    const real = junction.get(path) ?? path
    if (!real.startsWith('C:/repo/.agents/') && !real.startsWith('C:/repo/.claude/') && real !== 'C:/repo') {
      return Promise.reject(new Error('ENOENT'))
    }
    return Promise.resolve(real)
  }

  it('matches through a junction and keeps the foreign worktree\'s own branch', async () => {
    const hit = await findRegisteredWorktree(entries, 'C:/repo/.agents/worktrees/feature+20260810', resolver)
    expect(hit?.branch).toBe('feature+20260810')
    expect(hit?.branch).not.toContain('wt/')
  })
  it('normalizes separator styles before resolving', async () => {
    const hit = await findRegisteredWorktree(entries, 'C:\\repo\\.agents\\worktrees\\feature+20260810', resolver)
    expect(hit?.branch).toBe('feature+20260810')
  })
  it('returns nothing for a directory no worktree registered', async () => {
    expect(await findRegisteredWorktree(entries, 'C:/repo/.agents/worktrees/other', resolver)).toBeUndefined()
  })
  it('returns nothing when the target directory does not resolve', async () => {
    expect(await findRegisteredWorktree(entries, 'C:/repo/.agents/worktrees/gone', resolver)).toBeUndefined()
  })
})
