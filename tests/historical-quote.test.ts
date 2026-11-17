import { describe, expect, it, vi } from 'vitest'
import type { FileReference } from '../src/reference-contract.ts'
import { prepareExcerptInsertion } from '../src/client/code-excerpt.ts'
import { prepareFileInsertion } from '../src/client/file-reference.ts'
import { parseWorkbenchReference } from '../src/client/workbench-reference.ts'

const commit = 'a'.repeat(40)
const parent = 'b'.repeat(40)
const request = { repoRoot: 'C:/repo/worktrees/fix', path: 'gone.ts', previousPath: 'old.ts', deleted: true,
  view: { kind: 'commit' as const, commit: commit.slice(0, 7) } }
const file: FileReference = { repoRoot: request.repoRoot, path: request.path, absolutePath: `${request.repoRoot}/${request.path}`,
  kind: 'git', deleted: true, revision: parent, change: commit, revisionPath: 'old.ts', blob: 'c'.repeat(40) }
const excerpt = { kind: 'selection' as const, side: 'old' as const, text: 'captured code', startLine: 12, endLine: 12 }

function setup() {
  let revision = 9
  const input = { insertReference: vi.fn((_ref, span) => span.draftRev === revision), focus: vi.fn() }
  let current = input
  let release!: (file: FileReference) => void
  const bridge = { getInput: vi.fn(() => current), resolve: vi.fn(() => new Promise<FileReference>(resolve => { release = resolve })) }
  const actions = { captureInsertion: vi.fn(() => ({ start: 2, end: 7, draftRev: revision })), insertText: vi.fn(), submit: vi.fn() }
  const ctrl = new AbortController()
  const start = () => prepareExcerptInsertion(bridge, 'session', request.repoRoot, request, excerpt, actions, 'Code', ctrl.signal)
  return { input, bridge, actions, ctrl, start, release: (value = file) => release(value), edit: () => revision++,
    rebind: () => { current = { ...input, insertReference: vi.fn(() => true) } } }
}
const parsed = (input: ReturnType<typeof setup>['input']) => {
  const text = input.insertReference.mock.calls[0]![0].ref as string
  return parseWorkbenchReference(text.split('```git-workbench\n')[1]!.split('\n```')[0]!)
}

describe('historical references from abbreviated commit rows', () => {
  it('resolves the selected commit and keeps deleted-file coordinates and the captured draft revision', async () => {
    const ui = setup()
    const task = ui.start()
    expect(ui.actions.captureInsertion).toHaveBeenCalledOnce()
    expect(ui.bridge.resolve).toHaveBeenCalledWith(request.repoRoot, request, ui.ctrl.signal)
    ui.release()
    const result = await task
    expect(result.kind === 'ready' && result.insert()).toBe('inserted')
    expect(parsed(ui.input)).toMatchObject({ view: { kind: 'commit', commit }, deleted: true, previousPath: 'old.ts',
      displayedSnapshot: { side: 'old', startLine: 12 }, code: 'captured code' })
    expect(ui.input.insertReference.mock.calls[0]![1]).toEqual({ start: 7, end: 7, draftRev: 9 })
    expect(result.kind === 'ready' && result.insert()).toBe('changed')
    expect(ui.actions.insertText).not.toHaveBeenCalled()
    expect(ui.actions.submit).not.toHaveBeenCalled()
  })
  it.each(['edit', 'rebind', 'abort'] as const)('refuses insertion after %s while resolving', async change => {
    const ui = setup()
    const task = ui.start()
    if (change === 'edit') ui.edit()
    else if (change === 'rebind') ui.rebind()
    else ui.ctrl.abort()
    ui.release()
    const result = await task
    expect(result.kind === 'ready' ? result.insert() : result.kind).toBe(change === 'abort' ? 'aborted' : 'changed')
    expect(ui.input.focus).not.toHaveBeenCalled()
    expect(ui.actions.insertText).not.toHaveBeenCalled()
  })
  it('rejects a resolved identity that belongs to another commit', async () => {
    const ui = setup()
    const task = ui.start()
    ui.release({ ...file, change: parent })
    await expect(task).rejects.toThrow('commit identity')
    expect(ui.input.insertReference).not.toHaveBeenCalled()
  })
  it('also serializes a full-file reference with the full change commit, not its deletion parent', async () => {
    const ui = setup()
    const task = prepareFileInsertion(ui.bridge, 'session', request.repoRoot, request, ui.actions, 'File', ui.ctrl.signal)
    ui.release()
    const result = await task
    expect(result.kind === 'ready' && result.insert().kind).toBe('inserted')
    expect(parsed(ui.input)).toMatchObject({ view: { kind: 'commit', commit }, file: { revision: parent, change: commit } })
  })
})
