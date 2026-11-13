import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Every .ts/.tsx under src/ is plain text — no raw NUL bytes.
 *
 * This is a guard about the TOOLING, not the code: ripgrep classifies a file
 * containing NUL as binary and silently skips it, which blinds every
 * rg-backed scan in this repo (the no-leaks pairing counts, the panel
 * boundary checks, and the harness's own grep that audits feed on) while
 * fs-reading tests keep passing — a hole nothing else reports. It happened
 * once: token-cache.ts embedded six raw NUL bytes as a cache-key separator,
 * and the whole file was invisible to rg-based audits until they were
 * re-run against an fs walk. The runtime separator still exists; it is
 * spelled as the escape \\0 now, which reads the same to the machine and
 * as text to everything else.
 */
describe('text sources', () => {
  it('keeps every TypeScript source free of raw NUL bytes', () => {
    const root = fileURLToPath(new URL('../src', import.meta.url))
    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = `${dir}/${entry.name}`
        if (entry.isDirectory()) { walk(full); continue }
        if (!/\.tsx?$/.test(entry.name)) continue
        if (readFileSync(full).includes(0)) offenders.push(full)
      }
    }
    walk(root)
    // Self-check against vacuous passes: the walk must have seen a real tree.
    expect(offenders).toEqual([])
  })
})
