/**
 * The History tab's split must be re-clamped by the LAYOUT, not only by the drag.
 *
 * The commit list's height is stored in pixels, and the drag that produced it
 * clamped against the body as it stood at that moment. Make the window shorter
 * afterwards and that height is suddenly taller than everything: the lower half
 * collapses to zero and the drag handle is pushed past the bottom edge, so
 * there is nothing left on screen to pull it back with. Found live, not here —
 * measured at body=402, list=620, lower=0, handle unreachable.
 *
 * The fix is a `max-height` in percentages, which re-resolves on every layout
 * the way a stored pixel value cannot. Both numbers come from the panel's
 * constants through custom properties, so the drag clamp and the stylesheet
 * still have one home; that indirection is exactly what this file guards,
 * because a custom property that is never defined makes the whole declaration
 * invalid at computed-value time and the cap silently disappears.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/GitWorkbenchPanel.module.css', import.meta.url)), 'utf8')
const tsx = readFileSync(fileURLToPath(new URL('../src/client/GitWorkbenchPanel.tsx', import.meta.url)), 'utf8')

/** Comments stripped: prose in this repo has satisfied a source guard twice. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/** The `.body[data-stacked] .commitsPane` rule body. */
function stackedRule(sheet: string): string {
  const rule = /\.body\[data-stacked\]\s+\.commitsPane\s*\{([^}]*)\}/.exec(sheet)
  expect(rule, 'the stacked commit list has no rule of its own').not.toBeNull()
  return rule![1]!
}

describe('the stacked split', () => {
  it('caps the stored height against the body that exists now', () => {
    const rule = stackedRule(code(css))
    expect(rule, 'no max-height: a shorter window collapses the lower half')
      .toMatch(/max-height:/)
    // A pixel cap would be the same bug in a different place. The cap has to
    // be relative to the body, which is what re-resolves on resize.
    expect(rule, 'the cap must be relative to the body, not a fixed pixel count')
      .toMatch(/max-height:[^;]*100%/)
    expect(rule, 'no floor: the list can still be dragged to nothing')
      .toMatch(/min-height:/)
  })

  it('reads both floors from properties the panel actually defines', () => {
    const rule = stackedRule(code(css))
    const used = [...rule.matchAll(/var\((--[\w-]+)\)/g)].map(match => match[1]!)
    expect(used.length, 'the rule names no custom property').toBeGreaterThan(0)
    const panel = code(tsx)
    for (const name of used) {
      // An undefined property makes the declaration invalid and the cap
      // vanishes — silently, which is why this is worth a test.
      expect(panel, `${name} is used by the stacked rule but never defined`)
        .toMatch(new RegExp(`'${name}':`))
    }
  })

  it('defines those properties from the same constants the drag clamps with', () => {
    const panel = code(tsx)
    expect(panel).toMatch(/'--gs-min-commits-tall': `\$\{MIN_COMMITS_HEIGHT\}px`/)
    expect(panel).toMatch(/'--gs-min-stacked-lower': `\$\{MIN_STACKED_LOWER\}px`/)
    expect(panel, 'the drag clamp should use the same two constants')
      .toMatch(/Math\.max\(MIN_COMMITS_HEIGHT, bodyHeight - MIN_STACKED_LOWER\)/)
  })
})
