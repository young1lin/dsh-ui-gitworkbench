// tests/worktree-bindings.test.ts
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { bindingNotice, bindingsPath, lineageEdgeOf, parseBindings, resolveEffectiveBinding, saveBindings, type BindingsFile } from '../src/worktree'

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

describe('resolveEffectiveBinding (lineage)', () => {
  const bound = { name: 'x' }
  const lookup = (ids: readonly string[]) => (id: string) => (ids.includes(id) ? bound : undefined)

  it('returns the own binding, not inherited', () => {
    const parentOf = new Map([['child', 'parent']])
    expect(resolveEffectiveBinding('parent', parentOf, lookup(['parent'])))
      .toEqual({ binding: bound, inherited: false })
  })

  it('own wins over an also-bound ancestor', () => {
    const own = { name: 'own' }
    const parentOf = new Map([['child', 'parent']])
    expect(resolveEffectiveBinding('child', parentOf, id => (id === 'child' ? own : id === 'parent' ? bound : undefined)))
      .toEqual({ binding: own, inherited: false })
  })

  it('borrows the direct parent\'s binding', () => {
    const parentOf = new Map([['child', 'parent']])
    expect(resolveEffectiveBinding('child', parentOf, lookup(['parent'])))
      .toEqual({ binding: bound, inherited: true })
  })

  it('borrows through an unbound intermediate ancestor', () => {
    const parentOf = new Map([['grandchild', 'child'], ['child', 'root']])
    expect(resolveEffectiveBinding('grandchild', parentOf, lookup(['root'])))
      .toEqual({ binding: bound, inherited: true })
  })

  it('returns undefined when no ancestor is bound', () => {
    const parentOf = new Map([['child', 'parent']])
    expect(resolveEffectiveBinding('child', parentOf, lookup([]))).toBeUndefined()
  })

  it('returns undefined for an unknown session', () => {
    expect(resolveEffectiveBinding('nobody', new Map(), lookup(['parent']))).toBeUndefined()
  })

  it('stops at a lineage cycle instead of walking forever', () => {
    // a→b→a: the SEEN-SET must cut the loop, not the hop cap. With the guard
    // deleted the walk would ping-pong to the cap (8 ancestor lookups); the
    // count is what tells those apart — same return value either way.
    const parentOf = new Map([['a', 'b'], ['b', 'a']])
    let lookups = 0
    const bindingOf = (id: string): undefined => {
      lookups += 1
      return undefined
    }
    expect(resolveEffectiveBinding('a', parentOf, bindingOf)).toBeUndefined()
    expect(lookups).toBe(2) // own lookup (a) + one ancestor (b), then the guard cuts
  })

  it('gives up past the hop cap even though a distant ancestor is bound', () => {
    // A chain s0→s1→…→s9 with the binding only on the far end: the cap keeps
    // the walk bounded, so the far binding is NOT found.
    const parentOf = new Map<string, string>()
    for (let i = 0; i < 9; i += 1) parentOf.set(`s${i}`, `s${i + 1}`)
    expect(resolveEffectiveBinding('s0', parentOf, lookup(['s9']))).toBeUndefined()
    // Within the cap, the same chain resolves.
    expect(resolveEffectiveBinding('s0', parentOf, lookup(['s8']))).toEqual({ binding: bound, inherited: true })
  })
})

describe('lineageEdgeOf (header parent edge)', () => {
  it('returns the parent id from a subagent header', () => {
    expect(lineageEdgeOf({ parentSession: 'session-parent' })).toBe('session-parent')
  })
  it('returns undefined for a top-level session, a missing header, and an empty value', () => {
    expect(lineageEdgeOf({})).toBeUndefined()
    expect(lineageEdgeOf(undefined)).toBeUndefined()
    // The one guard both parentOf feeds share: an empty string is not an id.
    expect(lineageEdgeOf({ parentSession: '' })).toBeUndefined()
  })
})

describe('bindingNotice (standing prompt text)', () => {
  it('own variant names the worktree and offers worktree_exit', () => {
    const text = bindingNotice('feature-x', 'feature-x', false)
    expect(text).toContain('This session is bound to git worktree "feature-x" (branch feature-x).')
    expect(text).toContain('pass workdir ".agents/worktrees/feature-x"')
    expect(text).toContain('prefix every path with .agents/worktrees/feature-x/')
    expect(text).toContain('Call worktree_exit to unbind.')
  })

  it('inherited variant credits the parent and never offers worktree_exit', () => {
    const text = bindingNotice('feature-x', undefined, true)
    expect(text).toContain('entered by its parent session.')
    // The caller cannot unbind a parent's binding — offering exit would send
    // the model into a call that always fails.
    expect(text).not.toContain('Call worktree_exit')
    expect(text).toContain('worktree_exit here would not unbind it.')
    // Optional branch omitted cleanly — no dangling " (branch )" fragment.
    expect(text).toContain('"feature-x", entered by its parent session.')
    expect(text).not.toContain('branch')
  })
})
