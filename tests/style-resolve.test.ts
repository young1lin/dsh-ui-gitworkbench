import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STYLE, EMPTY_SETTINGS, effectiveBackground, effectiveCss, entryFor, withScope,
  type StyleEntry, type StyleSettings,
} from '../src/client/themes.ts'

const PROJECT_IMAGE = 'data:image/jpeg;base64,UFJPSg=='
const GLOBAL_IMAGE = 'data:image/jpeg;base64,R0xPQg=='

/**
 * @param project - the project scope, or null.
 * @param global - the global scope, or null.
 * @returns settings naming a repository, as the host reports inside one.
 */
function settings(project: StyleEntry | null, global: StyleEntry | null): StyleSettings {
  return { project, global, repoRoot: 'C:/repo' }
}

describe('effectiveBackground', () => {
  it('prefers the project image over the global one', () => {
    const resolved = effectiveBackground(settings(
      { ...DEFAULT_STYLE, image: PROJECT_IMAGE, blur: 4 },
      { ...DEFAULT_STYLE, image: GLOBAL_IMAGE, blur: 40 },
    ))
    // The whole entry wins, not the image alone: a blur tuned for one photograph
    // says nothing about another, so the two must not be mixed.
    expect(resolved).toMatchObject({ image: PROJECT_IMAGE, blur: 4 })
  })

  it('falls back to the global image when the project sets none', () => {
    expect(effectiveBackground(settings(
      { ...DEFAULT_STYLE, css: 'a{}' },
      { ...DEFAULT_STYLE, image: GLOBAL_IMAGE },
    ))).toMatchObject({ image: GLOBAL_IMAGE })
  })

  it('is null when neither scope sets an image', () => {
    expect(effectiveBackground(EMPTY_SETTINGS)).toBe(null)
    expect(effectiveBackground(settings({ ...DEFAULT_STYLE, css: 'a{}' }, null))).toBe(null)
  })
})

describe('effectiveCss', () => {
  it('applies both scopes with the project last, so its rules win by cascade order', () => {
    expect(effectiveCss(settings(
      { ...DEFAULT_STYLE, css: '.p{}' },
      { ...DEFAULT_STYLE, css: '.g{}' },
    ))).toBe('.g{}\n.p{}')
  })

  it('skips a scope whose stylesheet is absent or blank', () => {
    expect(effectiveCss(settings({ ...DEFAULT_STYLE, css: '  \n ' }, { ...DEFAULT_STYLE, css: '.g{}' }))).toBe('.g{}')
    expect(effectiveCss(settings(null, { ...DEFAULT_STYLE, css: '.g{}' }))).toBe('.g{}')
    expect(effectiveCss(EMPTY_SETTINGS)).toBe('')
  })
})

describe('entryFor / withScope', () => {
  it('opens an unconfigured scope on the defaults', () => {
    expect(entryFor(EMPTY_SETTINGS, 'project')).toBe(DEFAULT_STYLE)
    expect(entryFor(EMPTY_SETTINGS, 'global')).toBe(DEFAULT_STYLE)
  })

  it('replaces one scope and leaves the other alone', () => {
    const before = settings({ ...DEFAULT_STYLE, css: '.p{}' }, { ...DEFAULT_STYLE, css: '.g{}' })
    const after = withScope(before, 'project', { ...DEFAULT_STYLE, css: '.p2{}' })
    expect(after.project?.css).toBe('.p2{}')
    expect(after.global).toBe(before.global)
    expect(after.repoRoot).toBe('C:/repo')
  })
})
