import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { describe, expect, it } from 'vitest'
import { transform } from 'lightningcss'

import { PANEL_CSS_ENTRY, readPanelCss } from './helpers/panel-css.ts'

const MODULES = [
  'environment.css', 'themes.css', 'shell.css', 'history-filters.css', 'history.css',
  'changes.css', 'rails.css', 'operations.css', 'controls.css', 'files.css', 'image.css',
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
  it('sits each rail under the column it scrolls', () => {
    // `.sideRailGap` stands in for the divider between the two columns. If the
    // two widths drift, every rail is offset from its column by the
    // difference, so the right one hangs off the edge of the pane. The value
    // lives in two files (shell.css draws the divider, changes.css the rails),
    // which is exactly the kind of pair that drifts unwatched.
    const { source } = readPanelCss()
    const widthOf = (selector: string): string => {
      const at = source.indexOf(`${selector} {`)
      expect(at, `${selector} not found`).toBeGreaterThanOrEqual(0)
      const block = source.slice(at, source.indexOf('}', at))
      const found = /(?:^|[;{\s])width:\s*([^;]+);/.exec(block)
      expect(found, `${selector} declares no width`).not.toBeNull()
      return found![1]!.trim()
    }
    expect(widthOf('.sideRailGap')).toBe(widthOf('.paneDivider'))
  })
})
