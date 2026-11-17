import { describe, expect, it } from 'vitest'
import { adjacentFiles, DOCK_PAGES, dockNavigate, dockVisiblePage } from '../src/client/dock-layout.ts'

describe('docked navigation', () => {
  it('reveals the selected commit diff beside the log without overwriting narrow navigation', () => {
    expect(dockVisiblePage('history', 'commits', true, true)).toBe('code')
    expect(dockVisiblePage('history', 'commits', true, false)).toBe('commits')
    expect(dockVisiblePage('history', 'files', true, true)).toBe('files')
    expect(dockVisiblePage('history', 'code', true, true)).toBe('code')
    expect(dockVisiblePage('history', 'code', false, true)).toBe('files')
    expect(dockVisiblePage('changes', 'code', true, true)).toBe('code')
    expect(DOCK_PAGES.history).toBe('commits')
  })
  it('opens changes on code, history on commits and browsers on their file list', () => {
    expect(DOCK_PAGES).toEqual({ changes: 'code', history: 'commits', compare: 'files', files: 'files' })
  })
  it('retains each view position while moving through history commits, files and code', () => {
    const files = dockNavigate(DOCK_PAGES, 'history', 'files')
    const code = dockNavigate(files, 'history', 'code')
    const back = dockNavigate(code, 'history', 'commits')
    expect(files.history).toBe('files')
    expect(code.history).toBe('code')
    expect(back.history).toBe('commits')
    expect(back.changes).toBe('code')
    expect(DOCK_PAGES.history).toBe('commits')
  })
  it('ignores unsupported commit navigation and keeps unchanged state stable', () => {
    expect(dockNavigate(DOCK_PAGES, 'changes', 'commits')).toBe(DOCK_PAGES)
    expect(dockNavigate(DOCK_PAGES, 'changes', 'code')).toBe(DOCK_PAGES)
  })
  it('uses the displayed file order without wrapping or selecting a stale path', () => {
    const files = [{ path: 'renamed/new.ts' }, { path: 'deleted.ts' }, { path: 'other.ts' }]
    expect(adjacentFiles(files, 'deleted.ts')).toEqual({ previous: 'renamed/new.ts', next: 'other.ts' })
    expect(adjacentFiles(files, 'renamed/new.ts')).toEqual({ previous: null, next: 'deleted.ts' })
    expect(adjacentFiles(files, 'other.ts')).toEqual({ previous: 'deleted.ts', next: null })
    expect(adjacentFiles(files, 'renamed/old.ts')).toEqual({ previous: null, next: null })
    expect(adjacentFiles([], null)).toEqual({ previous: null, next: null })
  })
})
