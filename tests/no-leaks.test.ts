import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Everything acquired is released.
 *
 * The drawer lives inside a session header that is open for hours: a listener
 * left on `window`, an interval left running, an observer left attached to a
 * removed node all outlive the component that made them, and each one keeps its
 * whole closure — the panel's state included — alive with it. None of that
 * shows up as a test failure or an error in the console; it shows up as a tab
 * that gets slower the longer it is used.
 *
 * So the pairs are counted. This is a coarse rule and deliberately so: it
 * cannot see WHICH listener is removed, only that a file removes as many as it
 * adds. A file that adds one in an effect and removes it in the cleanup passes;
 * a file that forgets the cleanup fails, which is the mistake that actually
 * happens.
 *
 * Comments and string literals are stripped first. This repo's scanning guards
 * have twice been fooled by prose — a rule "described" in a comment reads as
 * code to a raw-text scan (AGENTS.md).
 */

const here = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url))

/** Source with comments and string/template literals removed, so only real
 *  code is counted. Quotes inside comments and comment markers inside strings
 *  both have to be handled, which is why this is a scanner and not a regex. */
function code(text: string): string {
  let out = ''
  let at = 0
  while (at < text.length) {
    const ch = text[at]!
    const next = text[at + 1]
    if (ch === '/' && next === '/') {
      const end = text.indexOf('\n', at)
      at = end === -1 ? text.length : end
      continue
    }
    if (ch === '/' && next === '*') {
      const end = text.indexOf('*/', at + 2)
      at = end === -1 ? text.length : end + 2
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      at += 1
      while (at < text.length && text[at] !== ch) {
        at += text[at] === '\\' ? 2 : 1
      }
      at += 1
      continue
    }
    out += ch
    at += 1
  }
  return out
}

function count(text: string, pattern: RegExp): number {
  return [...text.matchAll(pattern)].length
}

const clientDir = here('../src/client')
const sources = readdirSync(clientDir)
  .filter(name => name.endsWith('.ts') || name.endsWith('.tsx'))
  .map(name => ({ name, text: code(readFileSync(`${clientDir}/${name}`, 'utf8')) }))

describe('no leaks', () => {
  it('finds the client sources it is supposed to be scanning', () => {
    expect(sources.length).toBeGreaterThan(20)
    expect(sources.some(file => file.name === 'GitWorkbenchPanel.tsx')).toBe(true)
  })

  it('removes every event listener it adds', () => {
    for (const file of sources) {
      const added = count(file.text, /addEventListener\(/g)
      const removed = count(file.text, /removeEventListener\(/g)
      expect(`${file.name}: ${added} added, ${removed} removed`)
        .toBe(`${file.name}: ${added} added, ${added} removed`)
    }
  })

  it('clears every interval it starts', () => {
    for (const file of sources) {
      const started = count(file.text, /setInterval\(/g)
      const cleared = count(file.text, /clearInterval\(/g)
      expect(`${file.name}: ${started} started, ${cleared} cleared`)
        .toBe(`${file.name}: ${started} started, ${started} cleared`)
    }
  })

  it('disconnects every observer it attaches', () => {
    for (const file of sources) {
      const made = count(file.text, /new (?:Resize|Mutation|Intersection)Observer\b/g)
      const closed = count(file.text, /\.disconnect\(\)/g)
      expect(`${file.name}: ${made} observed, ${closed} disconnected`)
        .toBe(`${file.name}: ${made} observed, ${made} disconnected`)
    }
  })

  it('clears the timer a CodeMirror layer defers with, when the view goes', () => {
    // The one timer that survives an unmount by construction rather than by
    // oversight: it lives in a plugin, not in an effect, so React's cleanup
    // does not reach it. CodeMirror calls `destroy()`, and that is where it
    // has to be cleared.
    const editor = sources.find(file => file.name === 'CodeEditor.tsx')
    expect(editor).toBeDefined()
    const destroy = editor!.text.slice(editor!.text.indexOf('destroy()'))
    expect(destroy.slice(0, 200)).toContain('clearTimeout')
  })

  it('keeps the token caches bounded rather than trusting them', () => {
    // A cache with no ceiling is the leak this whole file is about. The
    // budgets are asserted for real in tests/token-cache.test.ts; what is
    // checked here is that the drawer's shared caches are the bounded classes
    // and not a bare Map somebody reached for later.
    const highlight = sources.find(file => file.name === 'highlight.ts')
    expect(highlight).toBeDefined()
    expect(highlight!.text).toContain('new ChunkedTokens()')
    expect(highlight!.text).toContain('new LineTokens()')
    expect(highlight!.text).not.toMatch(/const\s+\w*[Cc]ache\w*\s*=\s*new Map/)
  })
})
