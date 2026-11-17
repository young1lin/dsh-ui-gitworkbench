import { describe, expect, it, vi } from 'vitest'
import { combineSelections, editorQuote } from '../src/client/editor-quote.ts'
import type { CodeExcerpt } from '../src/client/code-excerpt.ts'

describe('editor toolbar quote target', () => {
  const old: CodeExcerpt = { kind: 'selection', side: 'old', text: 'deleted code\r', startLine: 12, endLine: 12, layer: 'staged', diffSha: 'immutable' }
  it('checks a live static deletion before the editable pane even if availability still describes the previous selection', () => {
    const next = vi.fn(() => ({ ...old, side: 'new' as const, text: 'current code' }))
    const prior = vi.fn<() => CodeExcerpt | null>(() => old)
    const combined = combineSelections({ path: 'a', available: false, capture: prior }, { path: 'a', available: true, capture: next })
    expect(editorQuote('a', combined, null, false)!.capture()).toBe(old)
    expect(next).not.toHaveBeenCalled()
    prior.mockReturnValue(null)
    expect(combined.capture()!.text).toBe('current code')
    expect(combineSelections({ path: 'a', available: false, capture: prior }, { path: 'b', available: true, capture: next }).capture()).toBeNull()
  })
  it('prefers the selected old code and preserves its identity, even with a dirty buffer', () => {
    const capture = vi.fn(() => old)
    const hunk = vi.fn(() => null)
    const quote = editorQuote('src/a.ts', { path: 'src/a.ts', available: true, capture }, hunk, true)!
    expect(capture).not.toHaveBeenCalled()
    expect(hunk).not.toHaveBeenCalled()
    expect(quote.kind).toBe('selection')
    expect(quote.disabled).toBe(false)
    expect(quote.capture()).toBe(old)
  })
  it('does not fall back to a hunk when a selected range has become unavailable', () => {
    const hunk = vi.fn(() => old)
    const quote = editorQuote('a', { path: 'a', available: true, capture: () => null }, hunk, false)!
    expect(quote.capture()).toBeNull()
    expect(hunk).not.toHaveBeenCalled()
  })
  it('reads a just-created old selection before the toolbar availability notification arrives', () => {
    const hunk = vi.fn(() => ({ ...old, text: '-old\n+new' }))
    const quote = editorQuote('a', { path: 'a', available: false, capture: () => old }, hunk, false)!
    expect(quote.capture()).toBe(old)
    expect(hunk).not.toHaveBeenCalled()
  })
  it.each([null, { path: 'another-file', available: true, capture: () => old }, { path: 'a', available: false, capture: () => old }])('uses the current hunk without a selection in this file: %j', selection => {
    const capture = vi.fn(() => old)
    const quote = editorQuote('a', selection, capture, true)!
    expect(quote.kind).toBe('hunk')
    expect(quote.disabled).toBe(true)
    expect(capture).not.toHaveBeenCalled()
  })
  it('offers no quote for an empty pane, and permits a file selection without a hunk', () => {
    expect(editorQuote('a', null, null, false)).toBeNull()
    expect(editorQuote('a', { path: 'a', available: true, capture: () => old }, null, false)?.kind).toBe('selection')
  })
})
