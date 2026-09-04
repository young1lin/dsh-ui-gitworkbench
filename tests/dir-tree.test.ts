import { describe, expect, it } from 'vitest'
import { buildDirTree, searchPaths } from '../src/client/dir-tree.ts'

describe('buildDirTree', () => {
  it('nests directories, lists their files, rolls counts up', () => {
    const tree = buildDirTree([
      'src/a.ts',
      'src/client/b.ts',
      'src/client/c.ts',
      'README.md',
    ])
    expect(tree).toEqual([
      {
        name: 'src', path: 'src', fileCount: 3, files: ['a.ts'],
        children: [
          { name: 'client', path: 'src/client', fileCount: 2, files: ['b.ts', 'c.ts'], children: [] },
        ],
      },
    ])
  })

  it('root-level files live on no node but the search still finds them', () => {
    const tree = buildDirTree(['README.md', 'src/x.ts'])
    expect(tree.map(dir => dir.name)).toEqual(['src'])
    expect(tree[0]!.files).toEqual(['x.ts'])
    expect(searchPaths(['README.md', 'src/x.ts'], 'readme')).toEqual([
      { path: 'README.md', isFile: true },
    ])
  })

  it('sorts children and files alphabetically so the tree scans predictably', () => {
    const tree = buildDirTree(['zebra/z.ts', 'alpha/b.ts', 'alpha/a.ts', 'mid/y.ts'])
    expect(tree.map(dir => dir.name)).toEqual(['alpha', 'mid', 'zebra'])
    expect(tree[0]!.files).toEqual(['a.ts', 'b.ts'])
  })

  it('creates intermediate directories a file skips past', () => {
    const tree = buildDirTree(['a/b/c/file.ts'])
    expect(tree[0]!.children[0]!.children[0]!.fileCount).toBe(1)
    expect(tree[0]!.children[0]!.children[0]!.files).toEqual(['file.ts'])
  })

  it('empty input is an empty tree — an empty repo has nothing to pick', () => {
    expect(buildDirTree([])).toEqual([])
  })
})

describe('searchPaths', () => {
  const paths = [
    'src/client/Main.java',
    'src/client/Queue.ts',
    'src/server/Main.java',
    'docs/guide.md',
  ]

  it('finds files by fragment, case-insensitive, flat — search results are not a tree', () => {
    expect(searchPaths(paths, 'main.j')).toEqual([
      { path: 'src/client/Main.java', isFile: true },
      { path: 'src/server/Main.java', isFile: true },
    ])
  })

  it('matches directories too — files first, directories after', () => {
    expect(searchPaths(paths, 'client')).toEqual([
      { path: 'src/client/Main.java', isFile: true },
      { path: 'src/client/Queue.ts', isFile: true },
      { path: 'src/client', isFile: false },
    ])
  })

  it('a directory fragment yields its files and the directory itself', () => {
    expect(searchPaths(paths, 'docs')).toEqual([
      { path: 'docs/guide.md', isFile: true },
      { path: 'docs', isFile: false },
    ])
  })

  it('matches on any path segment, so a filename alone finds its nested file', () => {
    expect(searchPaths(paths, 'guide')).toEqual([{ path: 'docs/guide.md', isFile: true }])
  })

  it('empty needle matches nothing — the caller shows the tree instead', () => {
    expect(searchPaths(paths, '')).toEqual([])
    expect(searchPaths(paths, '   ')).toEqual([])
  })
})

describe('buildDirTree with dirHints', () => {
  it('shows a hinted directory with no files under it as a real directory', () => {
    // The ignored listing collapses `node_modules/` to one line with nothing
    // under it; a path list cannot express "a directory that exists but is
    // empty here" — without the hint the browser would render no row at all,
    // and there would be nothing to click to expand.
    const tree = buildDirTree(['src/a.ts'], new Set(['node_modules']))
    expect(tree).toEqual([
      { name: 'node_modules', path: 'node_modules', fileCount: 0, files: [], children: [] },
      { name: 'src', path: 'src', fileCount: 1, files: ['a.ts'], children: [] },
    ])
  })

  it('hints nest, and a hint whose children have loaded is redundant but harmless', () => {
    // Once a lazy directory's children arrive they are ordinary paths; the
    // hint still names the directory and must not duplicate or damage it.
    const tree = buildDirTree(['node_modules/react/index.js'], new Set(['node_modules']))
    expect(tree).toEqual([
      {
        name: 'node_modules', path: 'node_modules', fileCount: 1, files: [],
        children: [
          { name: 'react', path: 'node_modules/react', fileCount: 1, files: ['index.js'], children: [] },
        ],
      },
    ])
    const nested = buildDirTree(['a/b/c.ts'], new Set(['a/b']))
    expect(nested[0]!.children.map(dir => dir.name)).toEqual(['b'])
  })

  it('never demotes a name the path list recorded as a file', () => {
    // The list is the primary source; a hint is hearsay next to it. A stale
    // listing claiming `x` is a directory must not turn the file `x` into a
    // folder, nor split one name into two rows.
    const tree = buildDirTree(['x', 'src/a.ts'], new Set(['x']))
    expect(tree.map(dir => dir.name)).toEqual(['src'])
    expect(tree.length).toBe(1)
    // And a hint walking THROUGH a recorded file name is skipped entire.
    expect(buildDirTree(['a'], new Set(['a/b'])).length).toBe(0)
  })

  it('ignores empty hint strings', () => {
    expect(buildDirTree(['a/b.ts'], new Set(['']))[0]!.files).toEqual(['b.ts'])
  })
})
