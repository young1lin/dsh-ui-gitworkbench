import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { freezeComparison, resolveFileReference } from '../src/file-reference.js'
import { fileMention, insertionPoint, insertFileReference, prepareFileInsertion, referencePaths, referenceText, referenceView } from '../src/client/file-reference.ts'
import type { FileReference } from '../src/reference-contract.js'

let root: string
let tree: string
let first: string
let deleted: string
const gitAt = (cwd: string, args: readonly string[]) => {
  try { return { stdout: execFileSync('git', [...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), exitCode: 0 } }
  catch (error) { return { stdout: '', exitCode: (error as { status: number }).status } }
}
const git = async (args: readonly string[]) => gitAt(root, args)
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'gw-reference-'))
  gitAt(root, ['init', '-q'])
  gitAt(root, ['config', 'user.name', 'Reference Test'])
  gitAt(root, ['config', 'user.email', 'test@example.invalid'])
  writeFileSync(join(root, 'gone.txt'), 'original\n')
  mkdirSync(join(root, 'nested'))
  writeFileSync(join(root, 'nested', '文件 name.txt'), 'main\n')
  gitAt(root, ['add', '.'])
  gitAt(root, ['commit', '-qm', 'initial'])
  first = gitAt(root, ['rev-parse', 'HEAD']).stdout.trim()
  tree = join(root, 'other-tree')
  gitAt(root, ['worktree', 'add', '-qb', 'other', tree])
  writeFileSync(join(tree, 'nested', '文件 name.txt'), 'other tree\n')
  unlinkSync(join(root, 'gone.txt'))
  gitAt(root, ['add', '-u'])
  gitAt(root, ['commit', '-qm', 'delete'])
  deleted = gitAt(root, ['rev-parse', 'HEAD']).stdout.trim()
})
afterAll(() => {
  if (root && resolve(root).startsWith(resolve(tmpdir()) + sep)) rmSync(root, { recursive: true, force: true })
})

describe('file reference identity', () => {
  it('uses the selected worktree root, including a session opened in a subdirectory', async () => {
    const file = await resolveFileReference(tree, { path: 'nested/文件 name.txt', deleted: false, view: { kind: 'working' } }, async args => gitAt(tree, args))
    expect(file.absolutePath).toBe(join(tree, 'nested', '文件 name.txt').replace(/\\/g, '/'))
    expect(file.kind).toBe('file')
    expect(referencePaths(tree, file.path).absolute).toBe(file.absolutePath)
  })
  it('references the first parent when the selected commit deleted a file', async () => {
    const file = await resolveFileReference(root, { path: 'gone.txt', deleted: true, view: { kind: 'commit', commit: deleted } }, git)
    expect(file).toMatchObject({ kind: 'git', revision: first, change: deleted, deleted: true })
    expect(gitAt(root, ['cat-file', '-p', file.blob!]).stdout).toBe('original\n')
    expect(referenceText(file, 'Git reference')).not.toContain('@')
  })
  it('never points a working-tree deletion at a live file', async () => {
    const file = await resolveFileReference(tree, { path: 'gone.txt', deleted: true, view: { kind: 'working' } }, async args => gitAt(tree, args))
    expect(file).toMatchObject({ kind: 'git', deleted: true, revision: first })
  })
  it('freezes an index-only version when HEAD never contained the deleted file', async () => {
    writeFileSync(join(tree, 'added.txt'), 'staged version\n')
    gitAt(tree, ['add', 'added.txt'])
    unlinkSync(join(tree, 'added.txt'))
    const file = await resolveFileReference(tree, { path: 'added.txt', deleted: true, view: { kind: 'working' } }, async args => gitAt(tree, args))
    expect(file.revision).toBeNull()
    expect(gitAt(tree, ['cat-file', '-p', file.blob!]).stdout).toBe('staged version\n')
  })
  it('freezes the actual merge base and refuses symbolic compare refs at insertion', async () => {
    const range = await freezeComparison(git, deleted, 'other')
    expect(range).toMatchObject({ base: first, head: first, tipBase: deleted })
    await expect(resolveFileReference(root, { path: 'gone.txt', deleted: true, view: { kind: 'compare', base: 'HEAD', head: 'other' } }, git)).rejects.toThrow('frozen')
    const file = await resolveFileReference(root, { path: 'gone.txt', deleted: true, view: { kind: 'compare', base: first, head: deleted } }, git)
    expect(file.revision).toBe(first)
  })
  it('falls back to the base tip for unrelated histories', async () => {
    const read = vi.fn(async (args: readonly string[]) => args[0] === 'merge-base'
      ? { stdout: '', exitCode: 1 } : { stdout: args[2]!.startsWith('left') ? first : deleted, exitCode: 0 })
    expect(await freezeComparison(read, 'left', 'right')).toEqual({ base: first, head: deleted, tipBase: first })
  })
  it('rejects traversal and missing historical objects instead of falling back to today', async () => {
    await expect(resolveFileReference(root, { repoRoot: tree, path: 'gone.txt', deleted: true, view: { kind: 'working' } }, git)).rejects.toThrow('root changed')
    await expect(resolveFileReference(root, { path: '../outside', deleted: false, view: { kind: 'working' } }, git)).rejects.toThrow()
    await expect(resolveFileReference(root, { path: 'missing', deleted: false, view: { kind: 'commit', commit: first } }, git)).rejects.toThrow('version unavailable')
    await expect(resolveFileReference(root, { path: 'nested', deleted: false, view: { kind: 'commit', commit: first } }, git)).rejects.toThrow('not a file blob')
  })
})

describe('draft-safe insertion and path copies', () => {
  const file: FileReference = { repoRoot: 'C:/repo/other tree', path: 'src/文件.ts', absolutePath: 'C:/repo/other tree/src/文件.ts', kind: 'file', deleted: false, revision: null, revisionPath: 'src/文件.ts', blob: null, change: null }
  it('formats native mentions, preserving spaces and declining unrepresentable quotes', () => {
    expect(fileMention(file.absolutePath)).toBe('@"C:/repo/other tree/src/文件.ts"')
    expect(fileMention('/repo/a"b')).toBeNull()
    expect(fileMention('/repo/a\nb')).toBeNull()
    expect(fileMention('//server/share/f')).toBe('@//server/share/f')
  })
  it('copies repo-relative names without stripping nested directories or UNC roots', () => {
    expect(referencePaths('C:\\repo\\tree', 'src/文件.ts')).toEqual({ name: '文件.ts', relative: 'src/文件.ts', absolute: 'C:/repo/tree/src/文件.ts' })
    expect(referencePaths('//server/share', 'a/b')).toMatchObject({ absolute: '//server/share/a/b' })
    expect(referencePaths('/', 'a')).toMatchObject({ absolute: '/a' })
    expect(() => referencePaths('/repo', '../a')).toThrow()
  })
  it('collapses the captured editor selection and preserves its revision', () => {
    const actions = { captureInsertion: vi.fn(), insertText: vi.fn() }
    const input = { insertReference: vi.fn(() => false), focus: vi.fn() }
    const span = { start: 2, end: 7, draftRev: 12 }
    expect(insertionPoint(span)).toEqual({ start: 7, end: 7, draftRev: 12 })
    expect(insertFileReference(file, actions, input, span, 'Reference')).toBe(false)
    expect(input.insertReference).toHaveBeenCalledWith(expect.objectContaining({ source: 'git-workbench', ref: expect.stringContaining(file.absolutePath) }), { start: 7, end: 7, draftRev: 12 })
    expect(actions.insertText).not.toHaveBeenCalled()
  })
  it('inserts a workbench reference preserving the frozen blob and rename path', () => {
    const actions = { captureInsertion: vi.fn(), insertText: vi.fn(() => true) }
    const input = { insertReference: vi.fn(() => true), focus: vi.fn() }
    const historical = { ...file, kind: 'git' as const, revision: 'a'.repeat(40), revisionPath: 'old.ts', previousPath: 'old.ts', blob: 'b'.repeat(40), deleted: true }
    expect(insertFileReference(historical, actions, input, { start: 0, end: 0, draftRev: 4 }, 'Reference')).toBe(true)
    expect(input.insertReference.mock.calls[0]![0].ref).toContain('"revisionPath": "old.ts"')
    expect(input.insertReference.mock.calls[0]![0].ref).toContain('"blob": "' + 'b'.repeat(40))
    expect(actions.insertText).not.toHaveBeenCalled()
  })
  it('takes history and comparison identity from the loaded snapshot', () => {
    expect(referenceView('history', { commits: [{ hash: 'old-commit' }] }, false)).toEqual({ kind: 'commit', commit: 'old-commit' })
    expect(referenceView('files', { commits: [] }, false)).toEqual({ kind: 'working' })
    expect(referenceView('history', { commits: [] }, true)).toBeNull()
    expect(referenceView('compare', { commits: [] }, false)).toBeNull()
    expect(referenceView('compare', { commits: [], referenceRange: { base: first, head: deleted } }, false)).toEqual({ kind: 'compare', base: first, head: deleted })
  })
  it('captures the cursor before resolving and never overwrites or submits the draft', async () => {
    let rev = 3
    const original = ['existing text', { chip: 'existing reference' }, 'selected text']
    const draft: unknown[] = [...original]
    let release!: (file: FileReference) => void
    const input = { insertReference: vi.fn((ref, span) => {
      if (span.draftRev !== rev) return false
      draft.push(ref)
      return true
    }), focus: vi.fn() }
    const actions = { captureInsertion: vi.fn(() => ({ start: 0, end: 4, draftRev: rev })), insertText: vi.fn(), setDraft: vi.fn(), submit: vi.fn() }
    const bridge = { getInput: vi.fn(() => input), resolve: vi.fn(() => new Promise<FileReference>(resolve => { release = resolve })) }
    const request = { path: file.path, deleted: false, view: { kind: 'working' as const } }
    const task = prepareFileInsertion(bridge, 'session-a', file.repoRoot, request, actions, 'Reference', new AbortController().signal)
    expect(actions.captureInsertion).toHaveBeenCalledOnce()
    release(file)
    const prepared = await task
    expect(prepared.kind).toBe('ready')
    expect(prepared.kind === 'ready' && prepared.insert().kind).toBe('inserted')
    expect(draft.slice(0, 3)).toEqual(original)
    expect(actions.setDraft).not.toHaveBeenCalled()
    expect(actions.submit).not.toHaveBeenCalled()
    expect(input.insertReference.mock.calls[0]![1]).toEqual({ start: 4, end: 4, draftRev: 3 })
    const changed = prepareFileInsertion(bridge, 'session-a', file.repoRoot, request, actions, 'Reference', new AbortController().signal)
    rev++
    release(file)
    const stale = await changed
    expect(stale.kind === 'ready' && stale.insert().kind).toBe('changed')
    expect(draft).toHaveLength(4)
  })
  it('does not insert into a replaced session binding or after drawer disposal', async () => {
    let release!: (file: FileReference) => void
    const firstInput = { insertReference: vi.fn(() => true), focus: vi.fn() }
    let input = firstInput
    const bridge = { getInput: () => input, resolve: () => new Promise<FileReference>(resolve => { release = resolve }) }
    const actions = { captureInsertion: () => ({ start: 0, end: 0, draftRev: 1 }), insertText: vi.fn() }
    const request = { path: file.path, deleted: false, view: { kind: 'working' as const } }
    const replaced = prepareFileInsertion(bridge, 'a', file.repoRoot, request, actions, 'Reference', new AbortController().signal)
    input = { insertReference: vi.fn(() => true), focus: vi.fn() }
    release(file)
    const stale = await replaced
    expect(stale.kind === 'ready' && stale.insert().kind).toBe('changed')
    expect(firstInput.insertReference).not.toHaveBeenCalled()
    expect(input.insertReference).not.toHaveBeenCalled()
    const ctrl = new AbortController()
    const closed = prepareFileInsertion(bridge, 'a', file.repoRoot, request, actions, 'Reference', ctrl.signal)
    ctrl.abort()
    release(file)
    expect((await closed).kind).toBe('aborted')
    expect(input.insertReference).not.toHaveBeenCalled()
  })
})
