import { describe, expect, it } from 'vitest'

import { buildDirTree } from '../src/client/dir-tree.ts'
import {
  IGNORED_CACHE_CAP, NO_IGNORED_READS, anyDirTruncated, attachReads, rememberDir,
  type IgnoredCache,
} from '../src/client/ignored-cache.ts'

const read = (names: readonly string[], truncated = false) =>
  ({ entries: names.map(name => ({ name, dir: name.endsWith('/') })), truncated })

/** Names ending in `/` are directories, so a fixture reads like a listing. */
const entries = (names: readonly string[]) =>
  names.map(name => ({ name: name.replace(/\/$/, ''), dir: name.endsWith('/') }))

const put = (cache: IgnoredCache, dir: string, names: readonly string[], keep: string[] = [], cap?: number) =>
  rememberDir(cache, dir, { entries: entries(names), truncated: false }, new Set(keep), cap)

describe('rememberDir', () => {
  it('reports its own size, so the bound is provable rather than trusted', () => {
    const one = put(NO_IGNORED_READS, 'node_modules', ['react/', 'vue/', '.bin/'])
    expect(one.size).toBe(3)
    const two = put(one, 'node_modules/react', ['index.js', 'package.json'])
    expect(two.size).toBe(5)
  })

  it('re-reading a directory replaces its entries rather than adding to them', () => {
    const one = put(NO_IGNORED_READS, 'logs', ['a.log', 'b.log', 'c.log'])
    const again = put(one, 'logs', ['a.log'])
    expect(again.size).toBe(1)
    expect(again.order).toEqual(['logs'])
  })

  it('evicts the oldest reads nobody is looking at once the cap is passed', () => {
    let cache = NO_IGNORED_READS
    cache = put(cache, 'a', ['1', '2'])
    cache = put(cache, 'b', ['3', '4'])
    cache = put(cache, 'c', ['5', '6'], [], 4)
    expect(cache.size).toBeLessThanOrEqual(4)
    expect(Object.keys(cache.reads).sort()).toEqual(['b', 'c'])
  })

  it('never evicts a directory the reader has open, even over the cap', () => {
    // The invariant that stops the cache fighting the viewport: dropping the
    // children of an expanded row makes the effect read them again, which
    // evicts another, which is read again — a spin with no end.
    let cache = NO_IGNORED_READS
    cache = put(cache, 'a', ['1', '2'], ['a', 'b', 'c'])
    cache = put(cache, 'b', ['3', '4'], ['a', 'b', 'c'])
    cache = put(cache, 'c', ['5', '6'], ['a', 'b', 'c'], 4)
    expect(Object.keys(cache.reads).sort()).toEqual(['a', 'b', 'c'])
    expect(cache.size).toBe(6)
  })

  it('evicts only what it must, keeping the newest unkept reads', () => {
    let cache = NO_IGNORED_READS
    cache = put(cache, 'old', ['1'])
    cache = put(cache, 'kept', ['2'], ['kept'])
    cache = put(cache, 'new', ['3'], ['kept'], 2)
    expect(Object.keys(cache.reads).sort()).toEqual(['kept', 'new'])
  })

  it('the shipped cap is a fuse, not a working number', () => {
    expect(IGNORED_CACHE_CAP).toBeGreaterThan(5_000)
  })
})

describe('anyDirTruncated', () => {
  it('is derived, so an evicted or replaced cut stops claiming it', () => {
    const cut = rememberDir(NO_IGNORED_READS, 'huge', read(['a', 'b'], true), new Set())
    expect(anyDirTruncated(cut)).toBe(true)
    // Re-read the same directory, this time whole.
    const clean = rememberDir(cut, 'huge', read(['a']), new Set())
    expect(anyDirTruncated(clean)).toBe(false)
    expect(anyDirTruncated(NO_IGNORED_READS)).toBe(false)
  })
})

describe('attachReads', () => {
  const base = buildDirTree(['src/a.ts'], new Set(['node_modules']))

  it('grafts a read directory onto the empty node the hint created', () => {
    const cache = put(NO_IGNORED_READS, 'node_modules', ['react/', '.package-lock.json'])
    const tree = attachReads(base, cache)
    const nm = tree.find(dir => dir.name === 'node_modules')!
    expect(nm.files).toEqual(['.package-lock.json'])
    expect(nm.children.map(child => child.path)).toEqual(['node_modules/react'])
    expect(nm.fileCount).toBe(1)
  })

  it('grafts nested reads, shallow first, whatever order they arrived in', () => {
    let cache = put(NO_IGNORED_READS, 'node_modules/react', ['index.js'])
    cache = put(cache, 'node_modules', ['react/'])
    const nm = attachReads(base, cache).find(dir => dir.name === 'node_modules')!
    expect(nm.children[0]!.files).toEqual(['index.js'])
    // The subtree count must climb back up the spine it was grafted onto.
    expect(nm.fileCount).toBe(1)
  })

  it('leaves untouched subtrees identical, which is what makes it cheap', () => {
    const cache = put(NO_IGNORED_READS, 'node_modules', ['react/'])
    const tree = attachReads(base, cache)
    expect(tree.find(dir => dir.name === 'src')).toBe(base.find(dir => dir.name === 'src'))
  })

  it('is a no-op for a directory the tree does not have', () => {
    const cache = put(NO_IGNORED_READS, 'gone/deep', ['x'])
    expect(attachReads(base, cache)).toBe(base)
  })

  it('never duplicates a name the path list already recorded', () => {
    const withFile = buildDirTree(['node_modules/react/index.js'], new Set(['node_modules']))
    const cache = put(NO_IGNORED_READS, 'node_modules', ['react/', 'react'])
    const nm = attachReads(withFile, cache).find(dir => dir.name === 'node_modules')!
    expect(nm.children.map(child => child.name)).toEqual(['react'])
    expect(nm.files).toEqual([])
  })

  it('returns the tree unchanged when nothing has been read', () => {
    expect(attachReads(base, NO_IGNORED_READS)).toBe(base)
  })
})
