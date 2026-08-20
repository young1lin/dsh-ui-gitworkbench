/**
 * The commit row's height, and the two places it must arrive intact.
 *
 * The lane graph draws each row as an SVG exactly as tall as the row, with
 * lines running from its top edge to its bottom edge; the row itself is sized
 * by `.commitLine` in the stylesheet. When the two disagree the graph does not
 * fail — every lane simply stops short of, or overshoots, the seam between
 * rows, and the braid a reader is following comes apart. That is invisible in
 * review and silent at runtime, which is what puts it here.
 *
 * It used to be one number written twice, and this file compared them. Now the
 * History tab has two arrangements wanting two differently shaped rows, so the
 * number lives once in `COMMIT_ROW_H` and travels: the panel publishes the
 * active entry as a custom property the stylesheet reads, and hands the same
 * entry to the graph as a prop. What is guarded is therefore the ROUTE rather
 * than a value — including that the property is actually defined, since a
 * custom property that is never set makes the whole declaration invalid at
 * computed-value time and the row silently loses its height.
 *
 * The sources are read as TEXT rather than imported: the panel pulls a CSS
 * module and React, neither of which loads in a node test environment.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { COMMIT_ROW_H } from '../src/client/history-layout.ts'

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

/** The name the height travels under, from the panel to the stylesheet. */
const PROPERTY = '--gs-commit-row'

describe('the commit subject', () => {
  it('does not grow past its own text', () => {
    // Growing was harmless while the list was a 26% column and the subject
    // filled the row anyway. Full-width it is a defect: a subject taking ALL
    // the free space pushes the has-a-body marker to the far right of the
    // drawer, where it reads as an unexplained ellipsis beside the author.
    const rule = /\.commitSubject\s*\{([^}]*)\}/.exec(code(css))
    expect(rule, '.commitSubject rule not found').not.toBeNull()
    const flex = /flex:\s*([^;]+);/.exec(rule![1]!)
    expect(flex, '.commitSubject declares no flex').not.toBeNull()
    const grow = flex![1]!.trim().split(/\s+/)[0]
    expect(grow, 'the subject must not take the free space in its row').toBe('0')
    // It must still be allowed to shrink, or a long subject overflows the row
    // instead of ellipsising.
    expect(rule![1]!, 'the subject must still ellipsise').toMatch(/text-overflow:\s*ellipsis/)
  })
})

describe('the commit row height', () => {
  it('is taken from the property rather than written into the stylesheet', () => {
    const rule = /\.commitLine\s*\{([^}]*)\}/.exec(code(css))
    expect(rule, '.commitLine rule not found').not.toBeNull()
    const height = /height:\s*([^;]+);/.exec(rule![1]!)
    expect(height, '.commitLine declares no height').not.toBeNull()
    // A pixel count here would pin one arrangement's row onto both.
    expect(height![1]!.trim(), 'the row height must come from the panel')
      .toBe(`var(${PROPERTY})`)
  })

  it('is published by the panel from the layout in force', () => {
    const panel = code(tsx)
    // An undefined property invalidates the declaration above and the row
    // loses its height with nothing said anywhere.
    expect(panel, `${PROPERTY} is read by the stylesheet but never defined`)
      .toContain(`'${PROPERTY}':`)
    // From the ACTIVE layout, and from `COMMIT_ROW_H` rather than a literal:
    // published off a fixed key, the switch would change the rows' shape
    // without changing their height.
    expect(panel, 'the published height must follow the chosen layout')
      .toContain(`'${PROPERTY}': \`\${COMMIT_ROW_H[historyLayout]}px\``)
  })

  it('reaches the lane graph as the same entry', () => {
    const panel = code(tsx)
    expect(panel, 'GraphCell should be handed the row height, not read a constant')
      .toMatch(/rowH=\{COMMIT_ROW_H\[layout\]\}/)
    expect(panel, "the graph's SVG must be exactly as tall as the row")
      .toMatch(/height=\{rowH\}/)
    // The graph's own geometry — the dot's centre, where an edge leaves the
    // bottom — has to come from the prop too.
    const cell = /function GraphCell\([\s\S]*?\n\}/.exec(panel)
    expect(cell, 'GraphCell not found').not.toBeNull()
    expect(cell![0], 'GraphCell still has a hard-coded row height')
      .not.toMatch(/\b(?:28|48)\b/)
  })

  it('fits one line stacked and two beside the diff', () => {
    // Bounds rather than exact numbers: the point is the SHAPE each row has to
    // hold, which is what stops a future tweak turning one into the other.
    expect(COMMIT_ROW_H.stacked).toBeGreaterThanOrEqual(20)
    expect(COMMIT_ROW_H.stacked).toBeLessThanOrEqual(34)
    expect(COMMIT_ROW_H.columns).toBeGreaterThanOrEqual(40)
    expect(COMMIT_ROW_H.columns).toBeLessThanOrEqual(60)
  })
})
