import { describe, expect, it } from 'vitest'

import { DIR_CHILD_CAP, shapeDirChildren } from '../src/dir-listing.ts'

describe('shapeDirChildren', () => {
  it('orders directories before files, each run by name', () => {
    // The shape every file tree has — `treeRows` renders exactly this order,
    // and a directory level that arrived files-first would flash-reorder the
    // rows once the client re-sorted.
    const shaped = shapeDirChildren([
      { name: 'zebra.ts', dir: false },
      { name: 'react', dir: true },
      { name: '.package-lock.json', dir: false },
      { name: '@types', dir: true },
    ])
    expect(shaped.entries.map(entry => `${entry.dir ? 'd' : 'f'}:${entry.name}`)).toEqual([
      'd:@types',
      'd:react',
      'f:.package-lock.json',
      'f:zebra.ts',
    ])
    expect(shaped.truncated).toBe(false)
  })

  it('caps and reports the cut rather than truncating silently', () => {
    const raw = Array.from({ length: 12 }, (_, i) => ({ name: `f${i}.ts`, dir: false }))
    const shaped = shapeDirChildren(raw, 10)
    expect(shaped.entries).toHaveLength(10)
    expect(shaped.truncated).toBe(true)
  })

  it('the shipped cap is a fuse, not a working number', () => {
    // A real directory level is a few hundred entries at most; the cap exists
    // so a pathological directory cannot blow the RPC payload, and it must be
    // far above anything a reader actually expands.
    expect(DIR_CHILD_CAP).toBeGreaterThan(1_000)
  })

  it('leaves a short directory untouched and uncut', () => {
    const shaped = shapeDirChildren([{ name: 'only.ts', dir: false }])
    expect(shaped.entries).toEqual([{ name: 'only.ts', dir: false }])
    expect(shaped.truncated).toBe(false)
  })
})
