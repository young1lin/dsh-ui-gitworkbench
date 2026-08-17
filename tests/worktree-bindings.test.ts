// tests/worktree-bindings.test.ts
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { bindingsPath, parseBindings, saveBindings, type BindingsFile } from '../src/worktree'

describe('bindingsPath', () => {
  it('puts the file under ~/.dsh', () => {
    expect(bindingsPath('C:/Users/u')).toBe('C:/Users/u/.dsh/gitworkbench-worktree-bindings.json')
  })
})

describe('parseBindings', () => {
  it('returns an empty file for garbage / wrong version / empty input', () => {
    const empty: BindingsFile = { v: 1, bindings: {} }
    expect(parseBindings('{oops')).toEqual(empty)
    expect(parseBindings('')).toEqual(empty)
    expect(parseBindings(JSON.stringify({ v: 2, bindings: {} }))).toEqual(empty)
  })
  it('keeps well-formed bindings', () => {
    const file: BindingsFile = { v: 1, bindings: { s1: { repoRoot: 'C:/r', worktreePath: 'C:/r/.agents/worktrees/x', name: 'x', enteredAt: '2026-08-15T00:00:00Z' } } }
    expect(parseBindings(JSON.stringify(file))).toEqual(file)
  })
  it('round-trips the optional branch and drops a malformed one', () => {
    // The branch the bound worktree actually has — a foreign worktree's own
    // branch, or the name verbatim for one this plugin created.
    const withBranch: BindingsFile = { v: 1, bindings: { s1: { repoRoot: 'C:/r', worktreePath: 'C:/r/.agents/worktrees/x', name: 'x', enteredAt: '2026-08-15T00:00:00Z', branch: 'feature+20260810' } } }
    expect(parseBindings(JSON.stringify(withBranch))).toEqual(withBranch)
    // Written before `branch` existed: still valid.
    const without: BindingsFile = { v: 1, bindings: { s1: { repoRoot: 'C:/r', worktreePath: 'C:/r/.agents/worktrees/x', name: 'x', enteredAt: '2026-08-15T00:00:00Z' } } }
    expect(parseBindings(JSON.stringify(without))).toEqual(without)
    // Present-but-empty is corruption: the whole record drops.
    const broken = parseBindings(JSON.stringify({ v: 1, bindings: { s1: { repoRoot: 'C:/r', worktreePath: 'w', name: 'x', enteredAt: 't', branch: '' } } }))
    expect(broken.bindings).toEqual({})
  })
  it('drops entries with missing fields', () => {
    const out = parseBindings(JSON.stringify({ v: 1, bindings: { s1: { repoRoot: 'C:/r' } } }))
    expect(out.bindings).toEqual({})
  })
  it('round-trips the optional baseCommit', () => {
    const file: BindingsFile = {
      v: 1,
      bindings: { s1: { repoRoot: 'C:/r', worktreePath: 'C:/r/.agents/worktrees/x', name: 'x', enteredAt: '2026-08-15T00:00:00Z', baseCommit: 'abc123' } },
    }
    expect(parseBindings(JSON.stringify(file))).toEqual(file)
  })
  it('keeps a binding written before baseCommit existed', () => {
    const legacy = { v: 1, bindings: { s1: { repoRoot: 'C:/r', worktreePath: 'C:/r/.agents/worktrees/x', name: 'x', enteredAt: '2026-08-15T00:00:00Z' } } }
    expect(parseBindings(JSON.stringify(legacy)).bindings['s1']?.name).toBe('x')
  })
  it('drops an entry whose baseCommit is present but malformed', () => {
    const base = { repoRoot: 'C:/r', worktreePath: 'C:/r/.agents/worktrees/x', name: 'x', enteredAt: '2026-08-15T00:00:00Z' }
    expect(parseBindings(JSON.stringify({ v: 1, bindings: { s1: { ...base, baseCommit: '' } } })).bindings).toEqual({})
    expect(parseBindings(JSON.stringify({ v: 1, bindings: { s1: { ...base, baseCommit: 42 } } })).bindings).toEqual({})
  })
})

describe('saveBindings (atomic tmp+rename)', () => {
  const path = 'C:/Users/u/.dsh/gitworkbench-worktree-bindings.json'
  const file: BindingsFile = {
    v: 1,
    bindings: { s1: { repoRoot: 'C:/r', worktreePath: 'C:/r/.agents/worktrees/x', name: 'x', enteredAt: '2026-08-15T00:00:00Z' } },
  }

  it('writes <path>.tmp then renames it over the real path', async () => {
    const ops: string[] = []
    const written = new Map<string, string>()
    await saveBindings(
      async dir => { ops.push(`mkdir ${dir}`) },
      async (p, text) => { ops.push(`write ${p}`); written.set(p, text) },
      async (from, to) => { ops.push(`rename ${from} -> ${to}`) },
      path,
      file,
    )
    expect(ops[0]).toBe(`mkdir ${join(path, '..')}`)
    // The real path only ever changes through rename, so a crash mid-write cannot truncate it.
    expect(written.has(path)).toBe(false)
    expect(written.get(`${path}.tmp`)).toBe(`${JSON.stringify(file, null, 2)}\n`)
    expect(ops.at(-1)).toBe(`rename ${path}.tmp -> ${path}`)
  })

  it('rejects when rename fails, leaving the real path unwritten', async () => {
    const targets: string[] = []
    await expect(saveBindings(
      async () => {},
      async p => { targets.push(p) },
      async () => { throw new Error('rename failed') },
      path,
      file,
    )).rejects.toThrow('rename failed')
    expect(targets).toEqual([`${path}.tmp`])
  })

  it('retries a transiently locked rename (Windows EPERM) until it succeeds', async () => {
    let calls = 0
    const renames: string[] = []
    await saveBindings(
      async () => {},
      async () => {},
      async (from, to) => {
        calls += 1
        renames.push(`${from} -> ${to}`)
        if (calls < 3) throw new Error('EPERM: operation not permitted')
      },
      path,
      file,
    )
    expect(calls).toBe(3)
    expect(renames.every(entry => entry === `${path}.tmp -> ${path}`)).toBe(true)
  })

  it('surfaces the rename error after exhausting retries', async () => {
    let calls = 0
    await expect(saveBindings(
      async () => {},
      async () => {},
      async () => { calls += 1; throw new Error('EPERM: operation not permitted') },
      path,
      file,
    )).rejects.toThrow('EPERM')
    expect(calls).toBe(6)
  })
})
