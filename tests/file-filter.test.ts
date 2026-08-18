/**
 * The filter over a big file list. Its whole job is to be predictable while
 * someone types, so the cases here are the ones a reader would notice going
 * wrong: word order, case, and a blank query that must not hide anything.
 */
import { describe, expect, it } from 'vitest'
import { filterFiles, matchesPath } from '../src/client/file-filter.ts'

const FILES = [
  { path: 'src/client/GitWorkbenchPanel.module.css' },
  { path: 'src/client/GitWorkbenchPanel.tsx' },
  { path: 'src/git-ops.ts' },
  { path: 'tests/git-ops.test.ts' },
  { path: 'README.md' },
  { path: 'docs/readme-generator/index.md' },
] as const

describe('matchesPath', () => {
  it('matches a plain substring anywhere in the path', () => {
    expect(matchesPath('src/client/GitWorkbenchPanel.tsx', 'client')).toBe(true)
    expect(matchesPath('src/client/GitWorkbenchPanel.tsx', 'Panel.tsx')).toBe(true)
    expect(matchesPath('src/git-ops.ts', 'client')).toBe(false)
  })

  it('ands the terms and ignores their order', () => {
    expect(matchesPath('src/client/GitWorkbenchPanel.module.css', 'panel css')).toBe(true)
    expect(matchesPath('src/client/GitWorkbenchPanel.module.css', 'css panel')).toBe(true)
    expect(matchesPath('src/client/GitWorkbenchPanel.tsx', 'panel css')).toBe(false)
  })

  it('treats a blank or whitespace-only query as no filter at all', () => {
    // The tree renders the filtered list unconditionally; if blank matched
    // nothing, the pane would be empty before anyone typed.
    expect(matchesPath('anything', '')).toBe(true)
    expect(matchesPath('anything', '   ')).toBe(true)
  })

  it('ignores case until the reader types a capital', () => {
    expect(matchesPath('README.md', 'readme')).toBe(true)
    expect(matchesPath('docs/readme-generator/index.md', 'readme')).toBe(true)
    expect(matchesPath('docs/readme-generator/index.md', 'README')).toBe(false)
    expect(matchesPath('README.md', 'README')).toBe(true)
  })

  it('decides case per term rather than for the whole query', () => {
    // `docs README` must still find a lowercase `docs` segment while holding
    // the capitalised term to its spelling.
    expect(matchesPath('docs/README.md', 'docs README')).toBe(true)
    expect(matchesPath('docs/readme.md', 'docs README')).toBe(false)
  })
})

describe('filterFiles', () => {
  it('keeps the caller order', () => {
    expect(filterFiles(FILES, 'git-ops').map(file => file.path))
      .toEqual(['src/git-ops.ts', 'tests/git-ops.test.ts'])
  })

  it('returns the very same array when nothing is being filtered', () => {
    // Identity, not equality: the tree memoises on this reference, so a blank
    // filter box must not rebuild the tree on every keystroke elsewhere.
    expect(filterFiles(FILES, '')).toBe(FILES)
    expect(filterFiles(FILES, '  ')).toBe(FILES)
  })

  it('can filter everything out, and says so by being empty', () => {
    expect(filterFiles(FILES, 'nothing-here')).toEqual([])
  })
})
