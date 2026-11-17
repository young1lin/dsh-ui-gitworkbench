import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { ReferencePreview } from '../src/client/ReferencePreview.tsx'
import type { WorkbenchReference } from '../src/client/workbench-reference.ts'

vi.mock('../src/client/CodeEditor.tsx', () => ({ CodeEditor: (props: object) => createElement('code-preview', props) }))
vi.mock('../src/client/DiffViews.tsx', () => ({ DiffView: (props: object) => createElement('diff-preview', props) }))
vi.mock('../src/client/FileActions.tsx', () => ({ FileActionsProvider: ({ children }: { children: React.ReactNode }) => children, useAnnotationActions: () => undefined }))
vi.mock('../src/client/highlight.ts', () => ({ subscribeGrammarLoaded: () => () => {}, grammarLoadCount: () => 0,
  shikiLangOf: () => null, shikiThemeOf: () => 'light', highlightRange: vi.fn() }))

let renderer: ReactTestRenderer | null = null
afterEach(() => { if (renderer) act(() => renderer!.unmount()); renderer = null })
const reference: WorkbenchReference = { version: 1, repository: 'C:/repo/worktrees/review', path: 'src/a.ts',
  absolutePath: 'C:/repo/worktrees/review/src/a.ts', view: { kind: 'commit', commit: 'a'.repeat(40) }, deleted: true }
function props(target: WorkbenchReference) {
  return { target, onBack: vi.fn(), t: (key: string) => key, palette: 'light', active: true, sessionId: 'session',
    referenceBridge: { resolve: vi.fn(async () => ({})), getInput: () => null }, inputActions: undefined,
    fetchFileSides: vi.fn(async () => ({ targetText: 'current bytes' })), fetchFileDiff: vi.fn(async () => 'frozen diff') }
}
async function render(options: ReturnType<typeof props>) {
  await act(async () => { renderer = create(createElement(ReferencePreview, options as never)) })
}

it('opens an exact saved code snapshot at its original lines without reading a current file', async () => {
  const options = props({ ...reference, code: 'old bytes\r\n', displayedSnapshot: { kind: 'selection', side: 'old', startLine: 42, endLine: 43 } })
  await render(options)
  expect(renderer!.root.findByType('code-preview').props).toMatchObject({ value: 'old bytes\r\n', readOnly: true, lineOffset: 41,
    reference: { source: { side: 'old', unsaved: false } } })
  expect(options.referenceBridge.resolve).not.toHaveBeenCalled()
  expect(options.fetchFileSides).not.toHaveBeenCalled()
  expect(options.fetchFileDiff).not.toHaveBeenCalled()
})

it('renders a frozen hunk as a diff with its saved old/new line ranges', async () => {
  const options = props({ ...reference, code: '@@ -42,1 +44,1 @@\n-old\n+new', displayedSnapshot: { kind: 'hunk', side: 'unified', oldRange: [42, 1], newRange: [44, 1] } })
  await render(options)
  expect(renderer!.root.findByType('diff-preview').props.segment).toBe(options.target.code)
  expect(options.referenceBridge.resolve).not.toHaveBeenCalled()
})

it('opens native targets as working-tree diffs and forwards the gesture line without reinterpreting a historical snapshot', async () => {
  const options = { ...props({ ...reference, deleted: false, view: { kind: 'working' } }), changes: true, line: 23 }
  await render(options)
  expect(options.fetchFileDiff).toHaveBeenCalledWith(reference.repository, reference.path, undefined, undefined, expect.any(AbortSignal))
  expect(renderer!.root.findByType('diff-preview').props.initialLine).toBe(23)
  expect(options.fetchFileSides).not.toHaveBeenCalled()
})

it.each(['commit', 'compare'] as const)('resolves a deleted %s reference only in its pinned worktree and frozen revisions', async kind => {
  const target = { ...reference, view: kind === 'commit' ? reference.view : { kind: 'compare' as const, base: 'b'.repeat(40), head: 'c'.repeat(40) } }
  const options = props(target)
  await render(options)
  expect(options.referenceBridge.resolve).toHaveBeenCalledWith(reference.repository,
    expect.objectContaining({ path: reference.path, view: target.view, deleted: true }), expect.any(AbortSignal))
  expect(options.fetchFileDiff).toHaveBeenCalledWith(reference.repository, reference.path,
    kind === 'commit' ? 'a'.repeat(40) : undefined,
    kind === 'compare' ? { base: 'b'.repeat(40), head: 'c'.repeat(40) } : undefined, expect.any(AbortSignal))
  expect(options.fetchFileSides).not.toHaveBeenCalled()
  expect(renderer!.root.findByType('diff-preview').props.segment).toBe('frozen diff')
})

it('cancels a hidden preview and refuses an unresolved index deletion instead of showing another version', async () => {
  const options = props({ ...reference, view: { kind: 'working' }, file: { revision: null } as never })
  await render(options)
  expect(options.fetchFileDiff).not.toHaveBeenCalled()
  expect(renderer!.root.findByProps({ role: 'status' }).children).toEqual(['referenceContentUnavailable'])
  const signal = options.referenceBridge.resolve.mock.calls[0]![2]
  act(() => renderer!.update(createElement(ReferencePreview, { ...options, active: false } as never)))
  expect(signal.aborted).toBe(true)
})
