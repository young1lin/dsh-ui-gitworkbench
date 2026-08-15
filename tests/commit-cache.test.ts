import { describe, expect, it } from 'vitest'
import { CommitPayloadCache, cacheKey } from '../src/commit-cache.js'

describe('cacheKey', () => {
  it('separates parts with a character no path or object name can contain', () => {
    // Without a separator, ('ab', 'c') and ('a', 'bc') would name one entry.
    expect(cacheKey('ab', 'c')).not.toBe(cacheKey('a', 'bc'))
  })

  it('keeps a Windows path with spaces distinct from one with a different hash', () => {
    const repo = 'C:/Program Files/repo'
    expect(cacheKey(repo, 'abc1234')).not.toBe(cacheKey(repo, 'abc1235'))
  })
})

describe('CommitPayloadCache', () => {
  it('returns undefined for an absent key and the payload for a stored one', () => {
    const cache = new CommitPayloadCache<number>(2)
    expect(cache.get('a')).toBeUndefined()
    cache.set('a', 1)
    expect(cache.get('a')).toBe(1)
  })

  it('replaces the payload of an existing key without growing', () => {
    const cache = new CommitPayloadCache<number>(2)
    cache.set('a', 1)
    cache.set('a', 2)
    expect(cache.get('a')).toBe(2)
    expect(cache.size).toBe(1)
  })

  it('never exceeds its capacity', () => {
    const cache = new CommitPayloadCache<number>(3)
    for (let i = 0; i < 20; i += 1) cache.set(`k${i}`, i)
    expect(cache.size).toBe(3)
  })

  it('evicts the least recently INSERTED entry when nothing was read', () => {
    const cache = new CommitPayloadCache<number>(2)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('c', 3)
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBe(2)
    expect(cache.get('c')).toBe(3)
  })

  it('evicts the least recently READ entry, so a re-read entry survives', () => {
    const cache = new CommitPayloadCache<number>(2)
    cache.set('a', 1)
    cache.set('b', 2)
    // Reading 'a' makes 'b' the least recently used, reversing the insertion order.
    expect(cache.get('a')).toBe(1)
    cache.set('c', 3)
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('a')).toBe(1)
  })

  it('holds exactly one entry at capacity 1', () => {
    const cache = new CommitPayloadCache<string>(1)
    cache.set('a', 'first')
    cache.set('b', 'second')
    expect(cache.size).toBe(1)
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBe('second')
  })
})
