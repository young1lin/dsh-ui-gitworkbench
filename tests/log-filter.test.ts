import { describe, expect, it } from 'vitest'
import { emptyLogFilter, logFilterArgs, type LogFilter } from '../src/log-filter.ts'

describe('logFilterArgs', () => {
  it('emits nothing for an empty filter', () => {
    expect(logFilterArgs(emptyLogFilter())).toEqual([])
  })

  it('matches an author case-insensitively as a LITERAL substring', () => {
    // liam must find "Liam Wright" without any regex meaning of its own.
    expect(logFilterArgs({ ...emptyLogFilter(), users: ['liam'] }))
      .toEqual(['-i', '-E', '--author=liam'])
  })

  it('repeats --author for multiple users — git ORs them, as IDEA does', () => {
    const args = logFilterArgs({ ...emptyLogFilter(), users: ['liam', 'richard'] })
    expect(args).toEqual(['-i', '-E', '--author=liam', '--author=richard'])
  })

  it('escapes ERE metacharacters in literal inputs — a dot matches a dot', () => {
    const args = logFilterArgs({ ...emptyLogFilter(), users: ['young1lin.dev'] })
    expect(args).toContain('--author=young1lin\\.dev')
  })

  it('escapes plain text, passes regex text through raw', () => {
    const plain = logFilterArgs({ ...emptyLogFilter(), text: 'fix(pause).btn', textRegex: false })
    expect(plain).toEqual(['-i', '-E', '--grep=fix\\(pause\\)\\.btn'])
    const regex = logFilterArgs({ ...emptyLogFilter(), text: '^fix(panic)?', textRegex: true })
    expect(regex).toEqual(['-i', '-E', '--grep=^fix(panic)?'])
  })

  it('passes dates through verbatim — approxidate belongs to git', () => {
    const args = logFilterArgs({ ...emptyLogFilter(), after: '2 weeks ago', before: '2026-01-01' })
    expect(args).toContain('--since=2 weeks ago')
    expect(args).toContain('--until=2026-01-01T23:59:59')
  })

  it('expands a picker day to the whole day — midnight in, last second out', () => {
    // Bare yyyy-mm-dd is approxidate roulette on Windows (the day's own
    // commits can fall outside the parse); explicit instants are not.
    const args = logFilterArgs({ ...emptyLogFilter(), after: '2026-08-18', before: '2026-08-18' })
    expect(args).toContain('--since=2026-08-18T00:00:00')
    expect(args).toContain('--until=2026-08-18T23:59:59')
  })

  it('appends pathspecs after a bare --, the segment the caller must keep last', () => {
    const args = logFilterArgs({ ...emptyLogFilter(), paths: ['src', 'docs/*.md'] })
    expect(args).toEqual(['--', 'src', 'docs/*.md'])
  })

  it('emits every criterion in a stable order', () => {
    const filter: LogFilter = {
      users: ['liam'],
      text: 'fix',
      textRegex: false,
      paths: ['src'],
      after: '1 week ago',
      before: '',
    }
    expect(logFilterArgs(filter)).toEqual([
      '-i', '-E',
      '--author=liam',
      '--grep=fix',
      '--since=1 week ago',
      '--', 'src',
    ])
  })

  it('ignores blank entries so a stray empty chip cannot become an empty pattern', () => {
    const args = logFilterArgs({ ...emptyLogFilter(), users: ['liam', '  '], paths: [''] })
    expect(args).toEqual(['-i', '-E', '--author=liam'])
  })
})
