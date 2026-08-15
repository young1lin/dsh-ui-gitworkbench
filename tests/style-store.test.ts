import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STYLE, STYLE_BLUR_MAX, STYLE_CSS_MAX, emptyStyleFile, isBlankEntry, parseStyle, sanitizeEntry, stylePath,
} from '../src/style-store.js'

/** A minimal, well-formed data URL of the kind the picker produces. */
const IMAGE = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ=='

describe('stylePath', () => {
  it('lands beside the other dsh state and is forward-slashed', () => {
    expect(stylePath('C:/Users/x')).toBe('C:/Users/x/.dsh/gitworkbench-style.json')
  })
})

describe('sanitizeEntry', () => {
  it('keeps a well-formed entry', () => {
    const entry = { css: 'a{}', image: IMAGE, blur: 12, veil: 60 }
    expect(sanitizeEntry(entry)).toEqual(entry)
  })

  it('falls back for anything that is not an entry', () => {
    for (const value of [null, undefined, 'x', 7, []]) {
      expect(sanitizeEntry(value), String(value)).toEqual(DEFAULT_STYLE)
    }
  })

  it('clamps the sliders into range', () => {
    expect(sanitizeEntry({ blur: -5, veil: 400 })).toMatchObject({ blur: 0, veil: 100 })
    expect(sanitizeEntry({ blur: 9e9 })).toMatchObject({ blur: STYLE_BLUR_MAX })
    expect(sanitizeEntry({ blur: Number.NaN, veil: 'x' })).toMatchObject({ blur: DEFAULT_STYLE.blur, veil: DEFAULT_STYLE.veil })
  })

  it('drops an image that is not a base64 data URL', () => {
    // The client interpolates this into `url("…")`. A value carrying a quote or a
    // brace could close the function and append rules of its own, so nothing but
    // the base64 alphabet is allowed through.
    const rejected = [
      'https://example.com/a.png',
      'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
      'data:image/png;base64,AAA");} body{display:none}',
      'data:text/html;base64,PGgxPmhpPC9oMT4=',
      'javascript:alert(1)',
      `data:image/png;base64,${'A'.repeat(4_000_000)}`,
    ]
    for (const image of rejected) {
      expect(sanitizeEntry({ image }).image, image.slice(0, 40)).toBe('')
    }
  })

  it('drops a stylesheet past the cap', () => {
    expect(sanitizeEntry({ css: 'a'.repeat(STYLE_CSS_MAX) }).css.length).toBe(STYLE_CSS_MAX)
    expect(sanitizeEntry({ css: 'a'.repeat(STYLE_CSS_MAX + 1) }).css).toBe('')
  })
})

describe('isBlankEntry', () => {
  it('is blank when neither the image nor the CSS is set', () => {
    expect(isBlankEntry(DEFAULT_STYLE)).toBe(true)
    // Sliders alone are not a configuration: they describe an image that is not there.
    expect(isBlankEntry({ ...DEFAULT_STYLE, blur: 40, veil: 10 })).toBe(true)
    expect(isBlankEntry({ ...DEFAULT_STYLE, image: IMAGE })).toBe(false)
    expect(isBlankEntry({ ...DEFAULT_STYLE, css: 'a{}' })).toBe(false)
  })
})

describe('parseStyle', () => {
  it('reads a well-formed file', () => {
    const file = parseStyle(JSON.stringify({
      v: 1,
      global: { css: 'g{}', image: '', blur: 5, veil: 50 },
      projects: { 'C:/repo': { css: '', image: IMAGE, blur: 30, veil: 70 } },
    }))
    expect(file.global.css).toBe('g{}')
    expect(file.projects['C:/repo']!.image).toBe(IMAGE)
  })

  it('reads a corrupt, empty or foreign-version file as empty', () => {
    for (const raw of ['', '{', 'null', '[]', '{"v":2,"global":{}}', '{"v":1}']) {
      expect(parseStyle(raw), raw).toEqual(emptyStyleFile())
    }
  })

  it('sanitizes every project entry rather than trusting the file', () => {
    const file = parseStyle('{"v":1,"projects":{"C:/repo":{"image":"https://x/y.png","blur":999}}}')
    expect(file.projects['C:/repo']).toEqual({ ...DEFAULT_STYLE, blur: STYLE_BLUR_MAX })
  })

  it('drops an entry with no key', () => {
    expect(Object.keys(parseStyle('{"v":1,"projects":{"":{"css":"a{}"}}}').projects)).toEqual([])
  })
})
