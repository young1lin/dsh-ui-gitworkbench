import { describe, expect, it } from 'vitest'

import { buildDirTree } from '../src/client/dir-tree.ts'
import { ancestorsOf, mergePaths, rootFiles, searchRows, treeRows } from '../src/client/file-rows.ts'

const PATHS = [
  'package.json',
  'README.md',
  'src/index.ts',
  'src/client/index.ts',
  'src/client/themes.ts',
  'tests/themes.test.ts',
]

const rows = (expanded: string[]) => treeRows(buildDirTree(PATHS), rootFiles(PATHS), new Set(expanded))
const shown = (expanded: string[]) => rows(expanded).map(row => `${row.depth}:${row.kind}:${row.path}`)

describe('rootFiles', () => {
  it('picks the files that live on no directory', () => {
    // buildDirTree drops these — it returns the root's CHILDREN, and a
    // root-level file is not a child directory. A browser that cannot open
    // package.json is not a browser, so they are recovered here.
    // Sorted with localeCompare, like dir-tree's own siblings: p before R.
    expect(rootFiles(PATHS)).toEqual(['package.json', 'README.md'])
  })

  it('sorts by name and ignores nested paths', () => {
    expect(rootFiles(['b.txt', 'a/deep.txt', 'a.txt'])).toEqual(['a.txt', 'b.txt'])
  })

  it('answers empty for a repo whose files all live in directories', () => {
    expect(rootFiles(['src/a.ts'])).toEqual([])
  })
})

describe('treeRows', () => {
  it('shows only top-level directories and root files when nothing is expanded', () => {
    expect(shown([])).toEqual([
      '0:dir:src',
      '0:dir:tests',
      '0:file:package.json',
      '0:file:README.md',
    ])
  })

  it('puts directories above files at every level', () => {
    // src has both a subdirectory and a file; the subdirectory reads first.
    const out = shown(['src'])
    expect(out.indexOf('1:dir:src/client')).toBeLessThan(out.indexOf('1:file:src/index.ts'))
  })

  it('reveals a directory contents only while it is expanded', () => {
    expect(shown([])).not.toContain('1:file:src/index.ts')
    expect(shown(['src'])).toContain('1:file:src/index.ts')
  })

  it('nests deeper directories one level further in', () => {
    const out = rows(['src', 'src/client'])
    const deep = out.find(row => row.path === 'src/client/themes.ts')
    expect(deep?.depth).toBe(2)
  })

  it('does not open a nested directory just because its parent is open', () => {
    expect(shown(['src'])).not.toContain('2:file:src/client/themes.ts')
  })

  it('keeps a collapsed child out even when the child itself is in the set', () => {
    // The child is expanded but its parent is not, so nothing of it shows —
    // expansion is only meaningful along a visible path.
    expect(shown(['src/client'])).toEqual([
      '0:dir:src',
      '0:dir:tests',
      '0:file:package.json',
      '0:file:README.md',
    ])
  })

  it('reports a directory own open flag', () => {
    const closed = rows([]).find(row => row.path === 'src')
    const open = rows(['src']).find(row => row.path === 'src')
    expect(closed?.open).toBe(false)
    expect(open?.open).toBe(true)
  })

  it('names a row by its last segment, not its whole path', () => {
    const row = rows(['src', 'src/client']).find(entry => entry.path === 'src/client/themes.ts')
    expect(row?.name).toBe('themes.ts')
  })

  it('answers empty for an empty repository', () => {
    expect(treeRows([], [], new Set())).toEqual([])
  })
})

describe('ancestorsOf', () => {
  it('lists every directory on the way down, outermost first', () => {
    expect(ancestorsOf('src/client/themes.ts')).toEqual(['src', 'src/client'])
  })

  it('answers empty for a root-level file', () => {
    expect(ancestorsOf('package.json')).toEqual([])
  })

  it('expands the path to a file when fed to treeRows', () => {
    // What "open this file" does to the tree: every directory above it opens,
    // and nothing else does.
    const out = shown(ancestorsOf('src/client/themes.ts'))
    expect(out).toContain('2:file:src/client/themes.ts')
    expect(out).not.toContain('1:file:tests/themes.test.ts')
  })
})

describe('searchRows', () => {
  it('answers file rows only', () => {
    // The filter popover lists directories too because a directory is a
    // tickable pathspec there. Here a row is something to OPEN, and a
    // directory does not open.
    const out = searchRows(PATHS, 'client', 50)
    expect(out.every(row => row.kind === 'file')).toBe(true)
    expect(out.map(row => row.path)).toContain('src/client/themes.ts')
  })

  it('matches anywhere in the path, case-insensitively', () => {
    expect(searchRows(PATHS, 'THEMES', 50).map(row => row.path))
      .toEqual(['src/client/themes.ts', 'tests/themes.test.ts'])
  })

  it('renders a hit with its whole path as the name', () => {
    // A flat list of bare filenames cannot be told apart — two themes.ts here.
    expect(searchRows(PATHS, 'themes', 50)[0]?.name).toBe('src/client/themes.ts')
  })

  it('answers empty for blank search text', () => {
    expect(searchRows(PATHS, '   ', 50)).toEqual([])
  })

  it('stops at the cap rather than rendering a whole repository', () => {
    const many = Array.from({ length: 200 }, (_, i) => `src/f${i}.ts`)
    expect(searchRows(many, 'src', 25)).toHaveLength(25)
  })

  it('keeps every row at depth zero', () => {
    expect(searchRows(PATHS, 'themes', 50).every(row => row.depth === 0)).toBe(true)
  })
})

describe('mergePaths', () => {
  it('adds a file that exists on disk but not in HEAD', () => {
    // repoTree is ls-tree HEAD, so a file written five minutes ago is missing
    // from it — and a browser that cannot open it reads as broken.
    expect(mergePaths(['src/a.ts'], ['src/new.ts'])).toEqual(['src/a.ts', 'src/new.ts'])
  })

  it('does not list a path twice when it is in both', () => {
    expect(mergePaths(['src/a.ts'], ['src/a.ts'])).toEqual(['src/a.ts'])
  })

  it('sorts the union, so the tree does not depend on which list won', () => {
    expect(mergePaths(['z.ts', 'm.ts'], ['a.ts'])).toEqual(['a.ts', 'm.ts', 'z.ts'])
  })

  it('ignores empty entries', () => {
    expect(mergePaths(['a.ts'], [''])).toEqual(['a.ts'])
  })

  it('answers the tracked list when there is nothing extra', () => {
    expect(mergePaths(['a.ts', 'b.ts'], [])).toEqual(['a.ts', 'b.ts'])
  })
})

describe('treeRows file cap', () => {
  const wide = Array.from({ length: 250 }, (_, i) => `gen/f${String(i).padStart(3, '0')}.ts`)
  const capped = (cap: number) =>
    treeRows(buildDirTree(wide), rootFiles(wide), new Set(['gen']), cap)

  it('stops after the cap and says how many it held back', () => {
    // 1500 files in one directory is 7500 DOM nodes with the icons on them.
    // The history filter's picker has capped this since it shipped.
    const rows = capped(100)
    expect(rows.filter(row => row.kind === 'file')).toHaveLength(100)
    const more = rows.find(row => row.kind === 'more')
    expect(more?.hidden).toBe(150)
  })

  it('puts the marker at the files own depth, under the last of them', () => {
    const rows = capped(100)
    const more = rows.find(row => row.kind === 'more')
    expect(more?.depth).toBe(1)
    expect(rows[rows.length - 1]).toBe(more)
  })

  it('adds no marker when everything fits', () => {
    expect(capped(250).some(row => row.kind === 'more')).toBe(false)
    expect(capped(999).filter(row => row.kind === 'file')).toHaveLength(250)
  })

  it('caps each directory on its own, not the whole tree', () => {
    const two = [...wide, ...wide.map(p => p.replace('gen/', 'other/'))]
    const rows = treeRows(buildDirTree(two), rootFiles(two), new Set(['gen', 'other']), 10)
    expect(rows.filter(row => row.kind === 'file')).toHaveLength(20)
    expect(rows.filter(row => row.kind === 'more')).toHaveLength(2)
  })

  it('caps root-level files too', () => {
    const roots = Array.from({ length: 30 }, (_, i) => `r${i}.md`)
    const rows = treeRows([], rootFiles(roots), new Set(), 10)
    expect(rows.filter(row => row.kind === 'file')).toHaveLength(10)
    expect(rows.find(row => row.kind === 'more')?.hidden).toBe(20)
  })

  it('is uncapped when no cap is given, so existing callers are unchanged', () => {
    expect(treeRows(buildDirTree(wide), rootFiles(wide), new Set(['gen']))
      .filter(row => row.kind === 'file')).toHaveLength(250)
  })
})
