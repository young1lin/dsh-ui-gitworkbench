/**
 * The commit row's height is one fact with two homes.
 *
 * The lane graph is drawn per row as an SVG exactly `GRAPH_ROW_H` tall, with
 * lines running from its top edge to its bottom edge; the row itself is sized
 * by `.commitLine`'s `height` in the stylesheet. When the two disagree the
 * graph does not fail — every lane simply stops short of, or overshoots, the
 * seam between rows, and the braid a reader is following comes apart. That is
 * invisible in review and silent at runtime, which is what puts it here.
 *
 * The source is read as TEXT rather than imported: the panel pulls a CSS
 * module and React, neither of which loads in a node test environment.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/GitWorkbenchPanel.module.css', import.meta.url)), 'utf8')
const tsx = readFileSync(fileURLToPath(new URL('../src/client/GitWorkbenchPanel.tsx', import.meta.url)), 'utf8')

/**
 * Comments stripped before anything is matched.
 *
 * Twice now a source-scanning guard in this repo has been satisfied by prose:
 * the number it was looking for was sitting in the comment that explained the
 * number, and the code could be changed without the test noticing.
 */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('the commit row height', () => {
  it('is the same number in the graph and in the stylesheet', () => {
    const constant = /const GRAPH_ROW_H = (\d+)/.exec(code(tsx))
    expect(constant, 'GRAPH_ROW_H not found in GitWorkbenchPanel.tsx').not.toBeNull()

    const rule = /\.commitLine\s*\{([^}]*)\}/.exec(code(css))
    expect(rule, '.commitLine rule not found').not.toBeNull()
    const height = /height:\s*(\d+)px/.exec(rule![1]!)
    expect(height, '.commitLine declares no pixel height').not.toBeNull()

    expect(Number(height![1]), 'the row and the lane segment drawn for it must be equally tall')
      .toBe(Number(constant![1]))
  })

  it('fits one line of text, which is what the stacked History tab assumes', () => {
    // A guard against the number drifting back up rather than merely apart:
    // the list spans the drawer now and a commit is one line, so a row twice
    // this tall would spend the stacked layout's scarcest axis on padding.
    const constant = Number(/const GRAPH_ROW_H = (\d+)/.exec(code(tsx))![1])
    expect(constant).toBeGreaterThanOrEqual(20)
    expect(constant).toBeLessThanOrEqual(34)
  })
})
