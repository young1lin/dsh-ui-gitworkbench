/**
 * The find panel has to look like the pane it opens over.
 *
 * `@codemirror/search` dresses its own panel, and every value it uses is a
 * literal: `#f5f5f5` for the strip, a grey `linear-gradient` for the buttons,
 * `1px solid silver` for the fields, `#ffff0054` for a match. None of that
 * follows a palette, so on eleven of the drawer's fourteen themes the panel
 * arrives as a light-grey slab of native form controls.
 *
 * What keeps it dressed is not "there is a theme" — it is that the theme
 * OVERRIDES each of those literals and spends only `--gs-*` tokens doing it.
 * A rule that is missing, or one that reintroduces a colour of its own, is
 * invisible in review and silent at runtime on the palette the reviewer
 * happens to be using. So the spec is read back here.
 *
 * It is a plain object with no imports, which is why it lives outside
 * `CodeEditor.tsx`: that file pulls React and a CSS Module and cannot load in
 * this environment.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SEARCH_PANEL_THEME } from '../src/client/cm-search-theme.ts'

const PANEL = '.cm-panel.cm-search'
const selectors = Object.keys(SEARCH_PANEL_THEME)

/** The declaration block for an exact selector key. */
function rule(selector: string): Readonly<Record<string, string>> {
  const found = SEARCH_PANEL_THEME[selector]
  expect(found, `no rule for ${selector}`).toBeDefined()
  return found!
}

/** Properties that put ink on the screen. `borderWidth` and `borderRadius`
 *  carry no colour, so they are deliberately not here. */
const PAINTS = new Set([
  'color', 'background', 'backgroundColor', 'backgroundImage', 'boxShadow',
  'outline', 'border', 'borderTop', 'borderRight', 'borderBottom', 'borderLeft',
])
const paints = (prop: string): boolean => PAINTS.has(prop) || prop.endsWith('Color')

/** A colour written out rather than named through the palette. `color-mix` is
 *  not one of those: it takes its ingredients from tokens, and this regexp
 *  still catches a literal handed INTO one. */
const LITERAL = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(|\b(?:silver|white|black|gray|grey|red|blue|green|yellow|orange|pink|purple)\b/i

/** Values that paint nothing, and so need no token. */
const BLANK = /^(?:none|inherit|unset|initial|currentColor)$/

function* declarations(): Generator<readonly [string, string, string]> {
  for (const [selector, block] of Object.entries(SEARCH_PANEL_THEME)) {
    for (const [prop, value] of Object.entries(block)) yield [selector, prop, value] as const
  }
}

describe('the find panel spends the palette, not literals', () => {
  it('writes no colour of its own anywhere in the spec', () => {
    for (const [selector, prop, value] of declarations()) {
      expect(value, `${selector} { ${prop} }`).not.toMatch(LITERAL)
    }
  })

  it('names a --gs-* token for every property that paints', () => {
    for (const [selector, prop, value] of declarations()) {
      if (!paints(prop)) continue
      // `transparent` is a real answer for a border kept only for its box.
      if (BLANK.test(value) || /\btransparent\b/.test(value)) continue
      expect(value, `${selector} { ${prop} } should paint through a token`).toContain('var(--gs-')
    }
  })

  it("sizes type through the drawer's three tokens", () => {
    for (const [selector, prop, value] of declarations()) {
      if (prop !== 'fontSize') continue
      expect(value, `${selector} { font-size }`).toMatch(/^var\(--gs-t-(?:meta|dense|ui)\)$/)
    }
  })

  it('takes control height and radius from the drawer, not from the library', () => {
    for (const selector of [`${PANEL} .cm-textfield`, `${PANEL} .cm-button`]) {
      expect(rule(selector).height, selector).toBe('var(--gs-h-compact)')
      expect(rule(selector).borderRadius, selector).toBe('var(--gs-r-control)')
    }
  })
})

describe('it overrides every default that would otherwise show', () => {
  it('repaints the strip the library fills with #f5f5f5 or #333338', () => {
    expect(rule('.cm-panels').backgroundColor).toBe('var(--gs-surface-2)')
    expect(rule('.cm-panels').color).toBe('var(--gs-fg)')
    expect(rule('.cm-panels-top').borderBottom).toContain('var(--gs-border)')
  })

  it('clears the button gradient, which rides on background-image', () => {
    // A background COLOUR alone leaves `linear-gradient(#eff1f5, #d9d9df)`
    // painted over it, so the panel keeps the bevel it came with.
    expect(rule(`${PANEL} .cm-button`).backgroundImage).toBe('none')
    expect(rule(`${PANEL} .cm-button:hover`).backgroundImage).toBe('none')
    // The library keeps a second gradient for the pressed state.
    expect(rule(`${PANEL} .cm-button:active`).backgroundImage).toBe('none')
  })

  it('replaces the silver field and the inherited close fill', () => {
    expect(rule(`${PANEL} .cm-textfield`).border).toContain('var(--gs-border)')
    expect(rule(`${PANEL} .cm-textfield`).backgroundColor).toBe('var(--gs-surface)')
    // The library sets `background-color: inherit` on close, which would take
    // the strip's fill and leave a hard-edged square on it.
    expect(rule(`${PANEL} [name=close]`).backgroundColor).toBe('transparent')
  })

  it("hands the platform checkbox back and draws the drawer's tick", () => {
    const box = rule(`${PANEL} input[type=checkbox]`)
    expect(box.appearance).toBe('none')
    expect(box.WebkitAppearance).toBe('none')
    expect(rule(`${PANEL} input[type=checkbox]:checked`).backgroundColor).toBe('var(--gs-accent)')
    // The mark is a rotated border, like `.funnelRow`'s — no asset ships.
    expect(rule(`${PANEL} input[type=checkbox]:checked::after`).transform).toMatch(/rotate/)
  })

  it('drops the 80% label and the em-sized margins', () => {
    expect(rule(`${PANEL} label`).fontSize).toBe('var(--gs-t-meta)')
    // `.2em .6em .2em 0` on every input, button and label: a margin in ems of
    // a 70% font, which is neither the drawer's rhythm nor a constant one.
    const shared = rule(`${PANEL} input, ${PANEL} button, ${PANEL} label`).margin
    expect(shared, 'the strip should restate the margin in px').toMatch(/^[\dpx ]+$/)
    expect(shared).not.toMatch(/em/)
    // The tick is inside a label, not an atom on the row, so it takes none.
    expect(rule(`${PANEL} input[type=checkbox]`).margin).toBe('0')
  })

  it('gives the two match states the palette, in the order that decides', () => {
    expect(rule('.cm-searchMatch').backgroundColor).toContain('var(--gs-')
    expect(rule('.cm-searchMatch-selected').backgroundColor).toContain('var(--gs-')
    // Both classes sit on the same span at the same specificity, so the one
    // meaning "the match you are on" only wins by being declared second.
    expect(selectors.indexOf('.cm-searchMatch-selected'))
      .toBeGreaterThan(selectors.indexOf('.cm-searchMatch'))
  })
})

describe('the controls read as one row', () => {
  it('gives every control the pane font, which form controls do not inherit', () => {
    // This is the whole reason the panel rendered in the browser's default
    // face: the library asks for `font-size: 70%` and names no family, and an
    // input, button or select takes neither from its parent on its own.
    for (const selector of [
      `${PANEL} .cm-textfield`, `${PANEL} .cm-button`, `${PANEL} label`, `${PANEL} [name=close]`,
    ]) {
      expect(rule(selector).font, selector).toBe('inherit')
    }
  })

  it('leaves the panel in inline flow, where the find/replace break works', () => {
    // Measured on the running app: Blink gives a `<br>` no box inside a flex
    // container, so `display: flex` here silently lands the replace field on
    // the find row. `flex-basis`, `width` and `min-width` on the `<br>` do not
    // rescue it. The controls are inline-level atoms instead.
    for (const bad of ['flex', 'inline-flex', 'grid', 'inline-grid']) {
      expect(rule(PANEL).display, `the panel must not become a ${bad} container`).not.toBe(bad)
    }
    for (const selector of [`${PANEL} .cm-button`, `${PANEL} label`]) {
      expect(rule(selector).display, selector).toBe('inline-flex')
    }
  })

  it('gives every control on the strip one box and one rhythm', () => {
    // `vertical-align: top` over a shared height is what makes a row of
    // controls a row, rather than four boxes hung off a shared baseline.
    const shared = rule(`${PANEL} input, ${PANEL} button, ${PANEL} label`)
    expect(shared.verticalAlign).toBe('top')
    expect(shared.boxSizing).toBe('border-box')
    for (const selector of [`${PANEL} .cm-textfield`, `${PANEL} .cm-button`, `${PANEL} label`]) {
      expect(rule(selector).height, selector).toBe('var(--gs-h-compact)')
    }
    // Both fields are one column wide, so the two rows start and end together.
    expect(rule(`${PANEL} .cm-textfield`).width).toMatch(/^\d+px$/)
  })

  it("pays for the row gap out of the panel's bottom padding", () => {
    // Inline flow has no `gap`, so the space between the find row and the
    // replace row is a bottom margin every control carries. Left in place it
    // also pads the strip's foot — so the padding is short by exactly that,
    // and the strip stays as deep below the last row as above the first.
    const px = (value: string): number => Number.parseFloat(value)
    const [top, , bottom] = rule(PANEL).padding!.split(/\s+/) as [string, string, string]
    const rowGap = rule(`${PANEL} input, ${PANEL} button, ${PANEL} label`).margin!.split(/\s+/)[2]!
    expect(px(bottom) + px(rowGap), 'foot should match the head').toBe(px(top))
  })

  it('reserves enough of the panel for the close button laid over it', () => {
    const close = rule(`${PANEL} [name=close]`)
    const px = (value: string | undefined): number => Number.parseFloat(value ?? 'NaN')
    const needed = px(close.right) + px(close.width)
    const gutter = px(rule(PANEL).padding?.split(/\s+/)[1])
    expect(needed).toBeGreaterThan(0)
    expect(gutter, 'the panel must not wrap a control under close').toBeGreaterThanOrEqual(needed)
  })
})

describe('the editor actually wears it', () => {
  /** Comments stripped before anything is matched: a source scan in this repo
   *  has twice been satisfied by the prose explaining the thing it looked for. */
  function code(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  }

  it('spreads the spec into the pane theme', () => {
    const source = code(readFileSync(fileURLToPath(new URL('../src/client/CodeEditor.tsx', import.meta.url)), 'utf8'))
    expect(source, 'CodeEditor should import the spec').toMatch(/import \{ SEARCH_PANEL_THEME \} from '\.\/cm-search-theme\.ts'/)
    // Inside the theme call, not beside it: a spec that is imported and never
    // spread leaves the panel exactly as the library shipped it.
    const theme = /const paneTheme = EditorView\.theme\(\{([\s\S]*?)\n\}\)/.exec(source)
    expect(theme?.[1], 'paneTheme should spread the search panel spec').toContain('...SEARCH_PANEL_THEME')
  })
})
