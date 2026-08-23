import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { describe, expect, it } from 'vitest'
import { transform } from 'lightningcss'

import { PANEL_CSS_ENTRY, readPanelCss } from './helpers/panel-css.ts'

const MODULES = [
  'environment.css', 'themes.css', 'shell.css', 'history-filters.css', 'history.css',
  'changes.css', 'operations.css', 'controls.css', 'files.css', 'image.css',
]

describe('modular panel stylesheet', () => {
  it('keeps feature sources bounded and in manifest order', () => {
    const { files } = readPanelCss()
    expect(files.slice(1).map(file => basename(file))).toEqual(MODULES)
    for (const file of files.slice(1)) {
      const lines = readFileSync(file, 'utf8').split('\n').length
      expect(lines, `${basename(file)} grew back into a monolith`).toBeLessThanOrEqual(550)
    }
  })

  it('inlines modules before hashing one shared class map', () => {
    const { source } = readPanelCss()
    expect(source).not.toMatch(/@import\s/)
    const result = transform({
      filename: PANEL_CSS_ENTRY,
      code: Buffer.from(source),
      cssModules: { pattern: '[hash]_[local]' },
      minify: true,
    })
    const classes = new Set(Object.keys(result.exports ?? {}))
    for (const name of ['card', 'overlay', 'cal', 'commitLine', 'sidePane', 'commitBox', 'btn', 'fbMain', 'imgPane']) {
      expect(classes.has(name), `missing class from a source module: ${name}`).toBe(true)
    }
    expect(result.code.toString()).not.toMatch(/@import\s/)
  })
})
