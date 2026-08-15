import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { COLOR_MODES, DEFAULT_APPEARANCE, DSH_DARK_ATTR, THEME_FAMILIES, hostSchemeDark, isAppearance, resolveTheme } from '../src/client/themes.ts'

/** The stylesheet as code, comments stripped. This repo's scanning guards
 *  have been fooled by prose in comments before (AGENTS.md): a token that is
 *  "declared" only inside a comment reads as present to a raw-text scan. */
const css = readFileSync(fileURLToPath(new URL('../src/client/GitWorkbenchPanel.module.css', import.meta.url)), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')

/** Palette names the stylesheet actually defines, read from its selectors. */
function declaredPalettes(): Set<string> {
  return new Set([...css.matchAll(/\[data-gs-theme='([^']+)'\]/g)].map(match => match[1]!))
}

describe('theme palettes', () => {
  // A family with no palette is invisible in review and silent at runtime: the
  // overlay simply defines no --gs-* token, so every colour falls back to the
  // browser default and the drawer renders unstyled rather than reporting a fault.
  it('defines a light and a dark palette for every family the menu offers', () => {
    const declared = declaredPalettes()
    expect(declared.size).toBeGreaterThan(0)
    for (const family of THEME_FAMILIES) {
      for (const suffix of ['dark', 'light']) {
        expect(declared.has(`${family.id}-${suffix}`), `${family.id}-${suffix}`).toBe(true)
      }
    }
  })

  it('leaves no palette the menu cannot reach', () => {
    const reachable = new Set(THEME_FAMILIES.flatMap(family => [`${family.id}-dark`, `${family.id}-light`]))
    for (const palette of declaredPalettes()) {
      expect(reachable.has(palette), palette).toBe(true)
    }
  })

  // A palette that forgets a token does not fail — it inherits whatever the
  // previously applied palette left on `.overlay`, so the drawer renders in a
  // mix of two themes and only an eye catches it. This is the check a new
  // family most needs, since a palette is written by copying a neighbour.
  it('gives every palette the whole core token set', () => {
    const CORE = [
      'bg', 'panel', 'raise', 'border', 'border-soft',
      'fg', 'fg-muted', 'fg-dim', 'fg-faint', 'fg-fainter',
      'accent', 'accent-bg', 'accent-border',
      'add', 'del', 'warn', 'info',
      'add-bg', 'del-bg', 'warn-bg', 'info-bg',
      'add-line', 'del-line', 'add-word', 'del-word',
      'hunk', 'neutral-bg', 'backdrop', 'shadow',
    ]
    for (const palette of declaredPalettes()) {
      const body = new RegExp(`\\[data-gs-theme='${palette}'\\]\\s*\\{([\\s\\S]*?)\\n\\}`).exec(css)?.[1] ?? ''
      expect(body, palette).not.toBe('')
      for (const token of CORE) {
        expect(new RegExp(`--gs-${token}:`).test(body), `${palette} is missing --gs-${token}`).toBe(true)
      }
    }
  })

  it('names every family once', () => {
    const ids = THEME_FAMILIES.map(family => family.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('hostSchemeDark', () => {
  it('reads dsh\'s body attribute, not prefers-color-scheme', () => {
    expect(hostSchemeDark({ hasAttribute: name => name === DSH_DARK_ATTR })).toBe(true)
    expect(hostSchemeDark({ hasAttribute: () => false })).toBe(false)
  })
})

describe('resolveTheme', () => {
  it('follows the host scheme in system mode', () => {
    expect(resolveTheme({ mode: 'system', family: 'github' }, true)).toBe('github-dark')
    expect(resolveTheme({ mode: 'system', family: 'github' }, false)).toBe('github-light')
  })

  it('ignores the host scheme when the mode is explicit', () => {
    expect(resolveTheme({ mode: 'light', family: 'nord' }, true)).toBe('nord-light')
    expect(resolveTheme({ mode: 'dark', family: 'nord' }, false)).toBe('nord-dark')
  })
})

describe('isAppearance', () => {
  it('accepts what this build can render', () => {
    expect(isAppearance(DEFAULT_APPEARANCE)).toBe(true)
    for (const mode of COLOR_MODES) {
      expect(isAppearance({ mode, family: 'solarized' }), mode).toBe(true)
    }
  })

  it('rejects a value an older or newer build wrote', () => {
    // localStorage is a durable boundary: a family this build dropped would
    // otherwise reach `data-gs-theme` and match no palette at all.
    expect(isAppearance({ mode: 'auto', family: 'monokai' })).toBe(false)
    expect(isAppearance({ mode: 'sepia', family: 'github' })).toBe(false)
    expect(isAppearance({ family: 'github' })).toBe(false)
    expect(isAppearance(null)).toBe(false)
    expect(isAppearance('github-dark')).toBe(false)
  })
})
