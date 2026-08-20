import { describe, expect, it } from 'vitest'
import { highlightRange, highlightWindow, shikiThemeOf } from '../src/client/highlight.ts'
import { CHUNK_LINES } from '../src/client/token-cache.ts'
import type { HighlightRun } from '../src/client/highlight.ts'

const THEME = shikiThemeOf('github-dark')

const colours = (runs: HighlightRun[] | undefined): string =>
  (runs ?? []).map(run => run.color ?? '-').join(',')

/** A file with a block comment that opens well before the window and closes
 *  well after it, so every line in between is comment text and NOTHING inside
 *  the window says so. */
function commentedFile(lines: number, openAt: number, closeAt: number): string[] {
  const out: string[] = []
  for (let i = 0; i < lines; i += 1) {
    if (i === openAt) out.push('/* the comment opens here')
    else if (i === closeAt) out.push('the comment closes here */')
    else out.push(`const value${i} = compute(alpha, beta, ${i})`)
  }
  return out
}

describe('highlightWindow', () => {
  it('keeps the file pass on lines that look like comment continuations', () => {
    // The two-pass rule: a line the reader would read as comment text keeps
    // the file pass, and everything else is re-lexed alone so a diff hunk
    // colours as top-level code. This is the half a diff reconstruction needs.
    const lines = ['/**', ' * const inside = 1', ' */', 'const after = 2']
    const runs = highlightWindow(lines, 'typescript', THEME, 0, lines.length)
    expect(colours(runs?.[1])).not.toContain('#FF7B72')
    expect(colours(runs?.[3])).toContain('#FF7B72')
  })

  it('returns the same runs when the same window is asked for twice', () => {
    const lines = commentedFile(600, 10, 20)
    const first = highlightWindow(lines, 'typescript', THEME, 300, 310)
    const again = highlightWindow(lines, 'typescript', THEME, 300, 310)
    expect(colours(again?.[305])).toBe(colours(first?.[305]))
    expect(again?.[305]?.map(run => run.text).join('')).toBe(lines[305])
  })

  it('fills only the window', () => {
    const lines = commentedFile(600, 10, 20)
    const runs = highlightWindow(lines, 'typescript', THEME, 300, 310)
    expect(runs?.[299]).toBeUndefined()
    expect(runs?.[310]).toBeUndefined()
    expect(runs?.[300]).toBeDefined()
  })

  it('has nothing to say about a file with no grammar', () => {
    expect(highlightWindow(['a', 'b'], undefined, THEME, 0, 2)).toBeUndefined()
    expect(highlightRange('k', ['a', 'b'], undefined, THEME, 0, 2)).toBeUndefined()
  })
})

describe('highlightRange', () => {
  it('reaches a construct that opened before the window, on a cold jump', () => {
    // Nothing inside [640, 650) says it is inside a comment; only the lead-in
    // above the chunk can know. This is what a click into the middle of a long
    // file does, and painting it as code is what the lead-in exists to stop.
    const lines = commentedFile(1200, 400, 900)
    const runs = highlightRange('cold', lines, 'typescript', THEME, 640, 650)
    expect(colours(runs?.[645])).not.toContain('#FF7B72')
  })

  it('agrees whether the reader scrolled there or jumped there', () => {
    const lines = commentedFile(1200, 400, 900)
    const jumped = highlightRange('jump', lines, 'typescript', THEME, 640, 650)
    // The same file read from the top, chunk by chunk, as scrolling does: each
    // chunk continues from the grammar state of the one before it.
    for (let at = 0; at < 700; at += CHUNK_LINES) {
      highlightRange('walk', lines, 'typescript', THEME, at, at + 10)
    }
    const scrolled = highlightRange('walk', lines, 'typescript', THEME, 640, 650)
    expect(colours(scrolled?.[645])).toBe(colours(jumped?.[645]))
  })

  it('paints a range of a real file without re-lexing lines on their own', () => {
    // A template literal spanning lines: the file pass knows, and a per-line
    // re-lex would not. This is what the editor and the file browser need.
    const lines = ['const t = `', 'const inside = 1', '`', 'const after = 2']
    const runs = highlightRange('doc', lines, 'typescript', THEME, 0, lines.length)
    const inside = runs?.[1]
    expect(inside).toBeDefined()
    // Inside a template literal, `const` is string text, not a keyword.
    expect(colours(inside)).not.toContain('#FF7B72')
    expect(colours(runs?.[3])).toContain('#FF7B72')
  })

  it('serves a second document under a different key', () => {
    const a = ['const a = 1']
    const b = ['const b = 2']
    expect(highlightRange('A', a, 'typescript', THEME, 0, 1)?.[0]?.map(r => r.text).join('')).toBe('const a = 1')
    expect(highlightRange('B', b, 'typescript', THEME, 0, 1)?.[0]?.map(r => r.text).join('')).toBe('const b = 2')
  })

  it('notices that the text under a key changed', () => {
    const before = ['const a = 1']
    const after = ['const bbbbb = 2']
    expect(highlightRange('same', before, 'typescript', THEME, 0, 1)?.[0]?.map(r => r.text).join('')).toBe('const a = 1')
    expect(highlightRange('same', after, 'typescript', THEME, 0, 1)?.[0]?.map(r => r.text).join('')).toBe('const bbbbb = 2')
  })
})
