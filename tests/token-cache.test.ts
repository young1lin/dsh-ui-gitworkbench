import { describe, expect, it } from 'vitest'
import {
  CHUNK_LINES,
  ChunkedTokens,
  LEAD_IN_LINES,
  LineTokens,
  type ChunkTokenizer,
} from '../src/client/token-cache.ts'
import type { HighlightRun } from '../src/client/highlight.ts'

/** A tokenizer that records every call and paints each line with its own text,
 *  so a run can be traced back to the line it was made from. */
function recorder(): { tokenize: ChunkTokenizer; calls: Array<{ lines: number; first: string; state: unknown }> } {
  const calls: Array<{ lines: number; first: string; state: unknown }> = []
  const tokenize: ChunkTokenizer = (text, state) => {
    const lines = text.split('\n')
    calls.push({ lines: lines.length, first: lines[0] ?? '', state })
    return {
      runs: lines.map(line => [{ text: line, color: '#fff' }]),
      state: `after:${lines[lines.length - 1] ?? ''}`,
    }
  }
  return { tokenize, calls }
}

const doc = (n: number, salt = 'L'): string[] => Array.from({ length: n }, (_, i) => `${salt}${i}`)

const textOf = (runs: (HighlightRun[] | undefined)[] | undefined, line: number): string | undefined =>
  runs?.[line]?.map(run => run.text).join('')

describe('ChunkedTokens', () => {
  it('fills only the requested range', () => {
    const cache = new ChunkedTokens()
    const { tokenize } = recorder()
    const lines = doc(500)
    const runs = cache.runs('k', lines, 200, 210, tokenize)
    expect(textOf(runs, 200)).toBe('L200')
    expect(textOf(runs, 209)).toBe('L209')
    // Outside the window, nothing — even inside the chunk that was tokenized.
    expect(runs?.[199]).toBeUndefined()
    expect(runs?.[210]).toBeUndefined()
    expect(runs?.length).toBe(500)
  })

  it('does not tokenize a chunk twice', () => {
    const cache = new ChunkedTokens()
    const { tokenize, calls } = recorder()
    const lines = doc(500)
    cache.runs('k', lines, 10, 20, tokenize)
    const after = calls.length
    cache.runs('k', lines, 10, 20, tokenize)
    cache.runs('k', lines, 30, 40, tokenize)
    expect(calls.length).toBe(after)
  })

  it('continues from the previous chunk instead of re-reading a lead-in', () => {
    const cache = new ChunkedTokens()
    const { tokenize, calls } = recorder()
    const lines = doc(1000)
    cache.runs('k', lines, 0, 5, tokenize)
    calls.length = 0
    // The next chunk along: its predecessor is held, so it starts at its own
    // first line and carries that chunk's end state.
    cache.runs('k', lines, CHUNK_LINES, CHUNK_LINES + 5, tokenize)
    expect(calls.length).toBe(1)
    expect(calls[0]!.first).toBe(`L${CHUNK_LINES}`)
    expect(calls[0]!.lines).toBe(CHUNK_LINES)
    expect(calls[0]!.state).toBe(`after:L${CHUNK_LINES - 1}`)
  })

  it('reads a lead-in for a cold jump, and still paints the right lines', () => {
    const cache = new ChunkedTokens()
    const { tokenize, calls } = recorder()
    const lines = doc(2000)
    const runs = cache.runs('k', lines, 900, 910, tokenize)
    expect(calls.length).toBe(1)
    expect(calls[0]!.state).toBeUndefined()
    const chunkStart = Math.floor(900 / CHUNK_LINES) * CHUNK_LINES
    expect(calls[0]!.first).toBe(`L${chunkStart - LEAD_IN_LINES}`)
    // The lead-in is context, not content: line 900 gets line 900's runs.
    expect(textOf(runs, 900)).toBe('L900')
    expect(textOf(runs, 909)).toBe('L909')
  })

  it('re-tokenizes when the text under a key changed', () => {
    const cache = new ChunkedTokens()
    const { tokenize, calls } = recorder()
    const first = cache.runs('k', doc(300, 'A'), 0, 5, tokenize)
    expect(textOf(first, 0)).toBe('A0')
    const before = calls.length
    const second = cache.runs('k', doc(300, 'B'), 0, 5, tokenize)
    expect(calls.length).toBe(before + 1)
    expect(textOf(second, 0)).toBe('B0')
  })

  it('forgets one document without touching another', () => {
    const cache = new ChunkedTokens()
    const { tokenize, calls } = recorder()
    const lines = doc(300)
    cache.runs('one', lines, 0, 5, tokenize)
    cache.runs('two', lines, 0, 5, tokenize)
    const before = calls.length
    cache.forget('one')
    cache.runs('two', lines, 0, 5, tokenize)
    expect(calls.length).toBe(before)
    cache.runs('one', lines, 0, 5, tokenize)
    expect(calls.length).toBe(before + 1)
  })

  it('stays inside its line budget, dropping the least recently used', () => {
    const budget = CHUNK_LINES * 3
    const cache = new ChunkedTokens(budget)
    const { tokenize, calls } = recorder()
    const lines = doc(CHUNK_LINES * 20)
    for (let chunk = 0; chunk < 10; chunk += 1) {
      cache.runs('k', lines, chunk * CHUNK_LINES, chunk * CHUNK_LINES + 4, tokenize)
      expect(cache.size()).toBeLessThanOrEqual(budget)
    }
    // The first chunk is long gone, so asking for it again is real work.
    const before = calls.length
    cache.runs('k', lines, 0, 4, tokenize)
    expect(calls.length).toBe(before + 1)
  })

  it('keeps the chunk that was read again, drops the one that was not', () => {
    const cache = new ChunkedTokens(CHUNK_LINES * 3)
    const { tokenize, calls } = recorder()
    const lines = doc(CHUNK_LINES * 20)
    const want = (chunk: number): void => { cache.runs('k', lines, chunk * CHUNK_LINES, chunk * CHUNK_LINES + 4, tokenize) }
    want(0); want(1); want(2)
    want(0)
    want(3)
    const before = calls.length
    want(0)
    expect(calls.length).toBe(before)
    want(1)
    expect(calls.length).toBe(before + 1)
  })

  it('caches nothing when no grammar applies', () => {
    const cache = new ChunkedTokens()
    let asked = 0
    const none: ChunkTokenizer = () => { asked += 1; return undefined }
    expect(cache.runs('k', doc(300), 0, 5, none)).toBeUndefined()
    expect(cache.size()).toBe(0)
    cache.runs('k', doc(300), 0, 5, none)
    expect(asked).toBe(2)
  })

  it('pads a tokenizer that hands back fewer lines than it was given', () => {
    const cache = new ChunkedTokens()
    const short: ChunkTokenizer = text => ({
      runs: text.split('\n').slice(0, 2).map(line => [{ text: line, color: '#fff' }]),
      state: 'x',
    })
    const runs = cache.runs('k', doc(300), 0, 5, short)
    expect(textOf(runs, 0)).toBe('L0')
    expect(textOf(runs, 4)).toBe('L4')
  })

  it('refuses an empty or inverted range', () => {
    const cache = new ChunkedTokens()
    const { tokenize } = recorder()
    expect(cache.runs('k', doc(50), 10, 10, tokenize)).toBeUndefined()
    expect(cache.runs('k', doc(50), 20, 5, tokenize)).toBeUndefined()
  })

  it('clears', () => {
    const cache = new ChunkedTokens()
    const { tokenize, calls } = recorder()
    cache.runs('k', doc(300), 0, 5, tokenize)
    cache.clear()
    expect(cache.size()).toBe(0)
    const before = calls.length
    cache.runs('k', doc(300), 0, 5, tokenize)
    expect(calls.length).toBe(before + 1)
  })
})

describe('LineTokens', () => {
  const lex = (line: string) => (): HighlightRun[] => [{ text: line, color: '#abc' }]

  it('lexes a line once', () => {
    const cache = new LineTokens()
    let asked = 0
    const count = (line: string) => (): HighlightRun[] => { asked += 1; return lex(line)() }
    expect(cache.get('const a = 1', count('const a = 1'))?.[0]?.text).toBe('const a = 1')
    cache.get('const a = 1', count('const a = 1'))
    cache.get('const a = 1', count('const a = 1'))
    expect(asked).toBe(1)
  })

  it('does not cache "no grammar yet"', () => {
    const cache = new LineTokens()
    let asked = 0
    const none = (): HighlightRun[] | undefined => { asked += 1; return undefined }
    expect(cache.get('x', none)).toBeUndefined()
    expect(cache.get('x', none)).toBeUndefined()
    expect(asked).toBe(2)
    expect(cache.size()).toBe(0)
  })

  it('stays inside its budget, dropping the least recently used', () => {
    const cache = new LineTokens(3)
    for (const line of ['a', 'b', 'c']) cache.get(line, lex(line))
    // Touch 'a' so 'b' becomes the oldest.
    cache.get('a', lex('a'))
    cache.get('d', lex('d'))
    expect(cache.size()).toBe(3)
    let asked = 0
    const count = (line: string) => (): HighlightRun[] => { asked += 1; return lex(line)() }
    cache.get('a', count('a'))
    expect(asked).toBe(0)
    cache.get('b', count('b'))
    expect(asked).toBe(1)
  })
})
