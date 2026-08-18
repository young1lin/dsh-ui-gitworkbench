import { describe, expect, it } from 'vitest'
import { chipsFromFilter, emptyQueryFilter, parseLogQuery, removeChip, serializeLogQuery } from '../src/client/log-filter-query.ts'

const F = emptyQueryFilter

describe('parseLogQuery', () => {
  it('empty and blank queries filter nothing', () => {
    expect(parseLogQuery('')).toEqual(F())
    expect(parseLogQuery('   ')).toEqual(F())
  })

  it('bare words become the text criterion', () => {
    expect(parseLogQuery('fix panic btn')).toEqual({ ...F(), text: 'fix panic btn' })
  })

  it('user: accumulates — multiple authors OR', () => {
    expect(parseLogQuery('user:lia user:richard')).toEqual({ ...F(), users: ['lia', 'richard'] })
  })

  it('prefixes are case-insensitive; path: accumulates', () => {
    expect(parseLogQuery('USER:lia Path:src PATH:docs')).toEqual({ ...F(), users: ['lia'], paths: ['src', 'docs'] })
  })

  it('an unquoted date value runs until the next known prefix', () => {
    expect(parseLogQuery('after:2 weeks ago user:lia')).toEqual({ ...F(), after: '2 weeks ago', users: ['lia'] })
  })

  it('a quoted value is exact, spaces included', () => {
    expect(parseLogQuery('before:"Jan 1, 2026"')).toEqual({ ...F(), before: 'Jan 1, 2026' })
  })

  it('a quoted span with no prefix is text — even one that looks like a prefix', () => {
    expect(parseLogQuery('"user:lia was here"')).toEqual({ ...F(), text: 'user:lia was here' })
  })

  it('an unknown prefix is an ordinary word, not an error', () => {
    expect(parseLogQuery('foo:bar fix')).toEqual({ ...F(), text: 'foo:bar fix' })
  })

  it('a later after: overwrites an earlier one — one bound, one value', () => {
    expect(parseLogQuery('after:1 week ago after:2 weeks ago')).toEqual({ ...F(), after: '2 weeks ago' })
  })
})

describe('serializeLogQuery / round-trip', () => {
  it('serializes values with spaces in quotes', () => {
    expect(serializeLogQuery({ ...F(), after: '1 week ago' })).toBe('after:"1 week ago"')
  })

  it('round-trips every criterion', () => {
    const filter = { users: ['lia', 'richard'], text: 'fix pause', textRegex: false, paths: ['src', 'docs/*.md'], after: '1 week ago', before: '' }
    expect(parseLogQuery(serializeLogQuery(filter))).toEqual(filter)
  })

  it('round-trips text that itself looks like a prefix token', () => {
    const filter = { ...F(), text: 'user:lia typo' }
    expect(parseLogQuery(serializeLogQuery(filter))).toEqual(filter)
  })
})

describe('chips model', () => {
  const filter = { users: ['lia', 'richard'], text: 'fix', textRegex: false, paths: ['src'], after: '1 week ago', before: '' }

  it('lists one chip per criterion', () => {
    expect(chipsFromFilter(filter)).toEqual([
      { kind: 'user', value: 'lia' },
      { kind: 'user', value: 'richard' },
      { kind: 'path', value: 'src' },
      { kind: 'after', value: '1 week ago' },
      { kind: 'text', value: 'fix' },
    ])
  })

  it('removing a user chip drops only that user', () => {
    const next = removeChip(filter, 'user', 'lia')
    expect(next.users).toEqual(['richard'])
    expect(next.paths).toEqual(['src'])
  })

  it('removing the last criterion empties the filter', () => {
    expect(removeChip({ ...F(), users: ['lia'] }, 'user', 'lia')).toEqual(F())
  })
})
