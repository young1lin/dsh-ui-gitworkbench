/**
 * The cache that stops the stats pass re-reading every untracked file on
 * every poll. All rules run against a fake filesystem: what matters is
 * WHEN a read happens, and that is countable without a disk.
 */
import { describe, expect, it } from 'vitest'

import { UNTRACKED_MEASURE_CAPACITY, UntrackedMeasures, type UntrackedIo } from '../src/untracked.ts'

interface FakeFile {
  mtimeMs: number
  size: number
  bytes: Buffer
}

/** An in-memory filesystem that counts every read, whole or prefix. */
class FakeDisk {
  readonly reads: string[] = []
  readonly prefixes: string[] = []
  /** Paths whose whole read must fail once (EBUSY), then succeed. */
  readonly failOnce = new Set<string>()

  constructor(readonly files: Map<string, FakeFile>) {}

  get io(): UntrackedIo {
    return {
      stat: async path => {
        const file = this.files.get(path)
        return file === undefined ? null : { mtimeMs: file.mtimeMs, size: file.size }
      },
      readPrefix: async (path, length) => {
        const file = this.files.get(path)
        if (file === undefined) return null
        this.prefixes.push(path)
        return file.bytes.subarray(0, length)
      },
      readFile: async path => {
        const file = this.files.get(path)
        if (file === undefined) return null
        if (this.failOnce.delete(path)) return null
        this.reads.push(path)
        return file.bytes
      },
    }
  }

  /** Write a text file with a plausible size for its content. */
  put(path: string, text: string, mtimeMs = 1_000): void {
    const bytes = Buffer.from(text, 'utf8')
    this.files.set(path, { mtimeMs, size: bytes.length, bytes })
  }
}

describe('UntrackedMeasures', () => {
  it('reads an unchanged file once, however many polls ask', async () => {
    const disk = new FakeDisk(new Map([['a.txt', { mtimeMs: 5, size: 4, bytes: Buffer.from('abcd') }]]))
    const cache = new UntrackedMeasures(1_000_000)
    const first = await cache.measure(disk.io, 'a.txt')
    const second = await cache.measure(disk.io, 'a.txt')
    const third = await cache.measure(disk.io, 'a.txt')
    expect(first).toEqual({ lineCount: 1, binary: false, diffable: true })
    expect(second).toEqual(first)
    expect(third).toEqual(first)
    expect(disk.reads).toEqual(['a.txt'])
  })

  it('re-reads when the mtime moves, and when only the size does', async () => {
    const disk = new FakeDisk(new Map())
    disk.put('a.txt', 'one\ntwo', 1_000)
    const cache = new UntrackedMeasures(1_000_000)
    await cache.measure(disk.io, 'a.txt')
    disk.files.get('a.txt')!.mtimeMs = 2_000
    await cache.measure(disk.io, 'a.txt')
    disk.files.get('a.txt')!.size = 99
    await cache.measure(disk.io, 'a.txt')
    expect(disk.reads).toHaveLength(3)
  })

  it('sniff-tests a NUL prefix as binary, without counting its lines', async () => {
    const disk = new FakeDisk(new Map())
    disk.put('blob.bin', 'x\0y')
    const cache = new UntrackedMeasures(1_000_000)
    expect(await cache.measure(disk.io, 'blob.bin')).toEqual({
      lineCount: 0, binary: true, diffable: false,
    })
  })

  it('answers a file past the cap from its prefix, never a whole read', async () => {
    const disk = new FakeDisk(new Map())
    // Past the 10-byte cap, with a NUL in the head to prove the badge survives.
    disk.files.set('huge.bin', { mtimeMs: 1, size: 50, bytes: Buffer.from('a\0bcdefghijklmnop') })
    const cache = new UntrackedMeasures(10)
    const measure = await cache.measure(disk.io, 'huge.bin')
    expect(measure).toEqual({ lineCount: 0, binary: true, diffable: false })
    expect(disk.reads).toEqual([])
    expect(disk.prefixes).toEqual(['huge.bin'])
    // And the prefix answer is cached like any other.
    await cache.measure(disk.io, 'huge.bin')
    expect(disk.prefixes).toHaveLength(1)
  })

  it('never caches a failed read — the next poll gets to try again', async () => {
    const disk = new FakeDisk(new Map())
    disk.put('locked.txt', 'content', 1_000)
    disk.failOnce.add('locked.txt')
    const cache = new UntrackedMeasures(1_000_000)
    expect(await cache.measure(disk.io, 'locked.txt')).toEqual({
      lineCount: 0, binary: false, diffable: false,
    })
    expect(await cache.measure(disk.io, 'locked.txt')).toEqual({
      lineCount: 1, binary: false, diffable: true,
    })
  })

  it('drops the least recently used measure at the bound', async () => {
    const disk = new FakeDisk(new Map())
    disk.put('a.txt', 'a')
    disk.put('b.txt', 'b')
    const cache = new UntrackedMeasures(1_000_000, 2)
    await cache.measure(disk.io, 'a.txt')
    await cache.measure(disk.io, 'b.txt')
    expect(cache.size()).toBe(2)
    // Touching a.txt makes b.txt the oldest; a third path evicts b, not a.
    await cache.measure(disk.io, 'a.txt')
    disk.put('c.txt', 'c')
    await cache.measure(disk.io, 'c.txt')
    expect(cache.size()).toBe(2)
    expect(disk.reads).toEqual(['a.txt', 'b.txt', 'c.txt'])
    // b.txt was evicted, so asking for it reads again — and its insertion
    // makes a.txt the oldest, so a drops out at the bound.
    await cache.measure(disk.io, 'b.txt')
    expect(disk.reads).toEqual(['a.txt', 'b.txt', 'c.txt', 'b.txt'])
    // c.txt survived b's insertion: a hit, not a read.
    await cache.measure(disk.io, 'c.txt')
    expect(disk.reads).toEqual(['a.txt', 'b.txt', 'c.txt', 'b.txt'])
    // a.txt was the one evicted: asking for it is a read again.
    await cache.measure(disk.io, 'a.txt')
    expect(disk.reads).toEqual(['a.txt', 'b.txt', 'c.txt', 'b.txt', 'a.txt'])
  })

  it('reports a missing file as nothing, and caches no claim about it', async () => {
    const disk = new FakeDisk(new Map())
    const cache = new UntrackedMeasures(1_000_000)
    expect(await cache.measure(disk.io, 'gone.txt')).toEqual({
      lineCount: 0, binary: false, diffable: false,
    })
    expect(cache.size()).toBe(0)
    disk.put('gone.txt', 'appeared')
    expect((await cache.measure(disk.io, 'gone.txt')).diffable).toBe(true)
  })
})

describe('the default capacity', () => {
  it('is a stated bound, not an accident', () => {
    expect(UNTRACKED_MEASURE_CAPACITY).toBeGreaterThan(0)
  })
})
