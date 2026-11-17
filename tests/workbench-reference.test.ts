import { describe, expect, it } from 'vitest'
import { parseWorkbenchReference, serializeWorkbenchReference, workbenchReferenceRule, type WorkbenchReference } from '../src/client/workbench-reference.ts'
import { ReferenceNavigation } from '../src/client/reference-navigation.ts'
import { workbenchInputSource } from '../src/client/workbench-input-source.ts'

const reference: WorkbenchReference = { version: 1, repository: 'C:/repo/worktrees/fix', path: 'src/文件.ts', absolutePath: 'C:/repo/worktrees/fix/src/文件.ts',
  deleted: true, previousPath: 'src/old.ts', view: { kind: 'commit', commit: 'a'.repeat(40) },
  code: '```\n实际代码\r\n@C:/other/file\n```', displayedSnapshot: { kind: 'selection', side: 'old', startLine: 12, endLine: 15, unsaved: false } }
const read = () => undefined
describe('persistent workbench message references', () => {
  it('registers an owner codec that serializes the complete snapshot and opens draft chips in the workbench', async () => {
    const opened: unknown[] = []
    const source = workbenchInputSource(async (...args) => { opened.push(args); return true })
    const text = serializeWorkbenchReference(reference)
    expect(await source.codec!.serialize(text, new AbortController().signal)).toBe(text)
    expect(source.codec!.clipboardText(text)).toBe(text)
    expect(source.openReference!({ sessionId: 'a' } as never, { ref: text })).toBe(true)
    expect(opened).toEqual([['a', { reference }]])
    await expect(source.codec!.serialize('invalid', new AbortController().signal)).rejects.toThrow()
    const aborted = new AbortController(); aborted.abort()
    await expect(source.codec!.serialize(text, aborted.signal)).rejects.toThrow()
  })
  it('restores exact source, revision, worktree and coordinates after a serialization round trip', () => {
    const text = 'draft kept\n' + serializeWorkbenchReference(reference) + ' next paragraph'
    const node = workbenchReferenceRule.match(text, 0, { read })!
    expect(node.id).toBe('git-workbench')
    expect(node.data).toEqual({ reference })
    expect(text.slice(node.start, node.end)).toBe(serializeWorkbenchReference(reference).trim())
    expect(workbenchReferenceRule.match(text, node.end, { read })).toBeUndefined()
  })
  it('leaves malformed data visible and refuses paths outside the repository and mutable refs', () => {
    expect(parseWorkbenchReference(JSON.stringify({ ...reference, path: '../another.ts' }))).toBeNull()
    expect(parseWorkbenchReference(JSON.stringify({ ...reference, absolutePath: 'C:/other/file' }))).toBeNull()
    expect(parseWorkbenchReference(JSON.stringify({ ...reference, view: { kind: 'commit', commit: 'main' } }))).toBeNull()
    expect(parseWorkbenchReference(JSON.stringify({ ...reference, displayedSnapshot: { ...reference.displayedSnapshot, startLine: -1 } }))).toBeNull()
    expect(parseWorkbenchReference(JSON.stringify({ ...reference, displayedSnapshot: { ...reference.displayedSnapshot, diffLines: 'invalid' } }))).toBeNull()
    expect(workbenchReferenceRule.match('```git-workbench\n{bad json}\n```', 0, { read })).toBeUndefined()
  })
  it('routes old absolute mentions while preserving quoted paths and normal relative mentions', () => {
    const text = 'see @"C:\\repo with spaces\\src\\file.ts" then @relative.ts'
    const node = workbenchReferenceRule.match(text, 0, { read })!
    expect(node.data).toEqual({ legacyPath: 'C:\\repo with spaces\\src\\file.ts' })
    expect(workbenchReferenceRule.match(text, node.end, { read })).toBeUndefined()
    expect(workbenchReferenceRule.match('@/repo/file.ts, next', 0, { read })?.data).toEqual({ legacyPath: '/repo/file.ts' })
  })
  it('chooses the earliest valid reference and never parses a path inside a snapshot as another node', () => {
    const text = '@/first/file.ts\n' + serializeWorkbenchReference(reference)
    const old = workbenchReferenceRule.match(text, 0, { read })!
    const next = workbenchReferenceRule.match(text, old.end, { read })!
    expect(old.data).toEqual({ legacyPath: '/first/file.ts' })
    expect(next.data).toEqual({ reference })
  })
})
describe('bounded workbench reference navigation', () => {
  it('prefers a retained source for every click, with session isolation and snapshot fallback', () => {
    const navigation = new ReferenceNavigation()
    let accepts = true, calls = 0
    const off = navigation.bindReveal('a', () => { calls++; return accepts })
    navigation.open('b', reference)
    expect(calls).toBe(0)
    navigation.open('a', reference)
    navigation.open('a', reference)
    expect(calls).toBe(2)
    expect(navigation.get('a')).toBeNull()
    accepts = false
    navigation.open('a', reference)
    expect(navigation.get('a')).toBe(reference)
    off()
    expect(navigation.revealSize()).toBe(0)
    const later = navigation.bindReveal('a', () => true)
    expect(navigation.get('a')).toBeNull()
    later(); navigation.dispose()
    expect(navigation.revealSize()).toBe(0)
  })

  it('keeps session targets independent, releases subscribers, and bounds retained snapshots', () => {
    const navigation = new ReferenceNavigation()
    let updates = 0
    const off = navigation.subscribe(() => updates++)
    navigation.open('a', reference)
    expect(navigation.get('a')).toBe(reference)
    expect(navigation.get('b')).toBeNull()
    off(); navigation.close('a')
    expect(updates).toBe(1)
    for (let i = 0; i < 50; i++) navigation.open(String(i), reference)
    expect(navigation.size()).toBe(32)
    expect(navigation.get('0')).toBeNull()
    navigation.dispose()
    expect(navigation.size()).toBe(0)
  })
})
