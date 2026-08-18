/**
 * The drawer's stylesheet has two properties that are invisible in review and
 * silent at runtime when they break, so they are asserted here instead.
 *
 * 1. The GitHub palettes reproduce Primer's own diffBlob values. A diff whose
 *    deletion tint is twice GitHub's strength still renders; it just stops
 *    looking like GitHub, and nothing fails.
 * 2. No control re-declares the geometry it already gets from the shared button
 *    vocabulary. That is exactly how the drawer drifted to eight button classes
 *    at four heights and three radii in the first place: each new control was
 *    added by copying a neighbouring rule and adjusting it.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/GitWorkbenchPanel.module.css', import.meta.url)), 'utf8')
/** The panel as TEXT — the modifier check reads which classes are combined in
 *  the markup. Importing it would pull a CSS module and React into node. */
const tsx = readFileSync(fileURLToPath(new URL('../src/client/GitWorkbenchPanel.tsx', import.meta.url)), 'utf8')

/** The declaration block of the first rule whose selector list matches. */
function block(selector: string): string {
  const at = css.indexOf(selector)
  expect(at, `selector not found: ${selector}`).toBeGreaterThan(-1)
  const open = css.indexOf('{', at)
  const close = css.indexOf('}', open)
  return css.slice(open + 1, close)
}

/**
 * Primer 11.10 `diffBlob` tokens. The dark ones are Primer's alpha hexes
 * flattened over `--bgColor-default` (#0d1117), because the drawer paints the
 * number cells on top of the row tint and two alphas would composite to about
 * twice GitHub's strength.
 */
const GITHUB_DIFF = {
  'github-dark': {
    '--gs-add-line': '#12261e',  // #2ea04326
    '--gs-add-num': '#1c4428',   // #3fb9504d
    '--gs-add-word': '#1a4a29',  // #2ea04366
    '--gs-del-line': '#25181c',  // #f851491a
    '--gs-del-num': '#542426',   // #f851494d
    '--gs-del-word': '#6b2b2b',  // #f8514966
    '--gs-hunk': '#111d2e',      // #388bfd1a
    '--gs-hunk-num': '#0c2d6b',
  },
  'github-light': {
    '--gs-add-line': '#dafbe1',
    '--gs-add-num': '#aceebb',
    '--gs-add-word': '#aceebb',
    '--gs-del-line': '#ffebe9',
    '--gs-del-num': '#ffcecb',
    '--gs-del-word': '#ffcecb',
    '--gs-hunk': '#ddf4ff',
    '--gs-hunk-num': '#b6e3ff',
  },
} as const

describe('github palettes reproduce Primer', () => {
  for (const [palette, tokens] of Object.entries(GITHUB_DIFF)) {
    it(`${palette} carries GitHub's own diffBlob values`, () => {
      const declarations = block(`.overlay[data-gs-theme='${palette}']`)
      for (const [token, value] of Object.entries(tokens)) {
        const match = new RegExp(`${token}:\\s*([^;]+);`).exec(declarations)
        expect(match?.[1]?.trim(), token).toBe(value)
      }
    })
  }
})

describe('diff chrome follows GitHub, not a terminal', () => {
  it('draws no rule between the sign column and the code', () => {
    // A rule here cuts every tinted row in half, so a whole-file addition reads
    // as two stacked green bands rather than one block of new code.
    expect(block('.gutter {')).not.toMatch(/border-right/)
  })

  it('keeps the hunk header quieter than the code it introduces', () => {
    // GitHub uses muted grey here. The accent colour made every hunk boundary
    // the loudest thing on screen.
    expect(block('.lineHunk .code')).toContain('--gs-fg-dim')
    expect(block('.lineHunk .code')).not.toContain('--gs-accent')
  })
})

describe('a fast operation does not blink the sync row', () => {
  /** SyncBar's source, where every control is disabled by the shared `running`.
   *  Both anchors are asserted: a renamed function turns indexOf's -1 into a
   *  slice from the TOP of the file, and every assertion below then scans the
   *  wrong region — silently, because a miss reads as a pass. */
  const syncBarStart = tsx.indexOf('function SyncBar(')
  const syncBarEnd = tsx.indexOf('function CommitBox(')
  expect(syncBarStart, 'SyncBar was renamed?').toBeGreaterThan(-1)
  expect(syncBarEnd, 'CommitBox was renamed?').toBeGreaterThan(syncBarStart)
  const syncBar = tsx.slice(syncBarStart, syncBarEnd)

  it('pairs every running-disable with the quiet marker', () => {
    // Ticking a file IS a git call, so `running` goes true on every click and
    // the whole row used to fade to `opacity: .45` and back inside ~150ms.
    // The disable itself is right — it stops a second call — but announcing it
    // that briefly is a blink, not feedback. Anything newly disabled by
    // `running` therefore has to say whether it may dim yet.
    const controls = [...syncBar.matchAll(/<(button|SyncModePicker)\b[^>]*>/gs)]
      .map(match => match[0])
      .filter(tag => /disabled=\{running/.test(tag))
    expect(controls.length, 'no control is disabled by `running`').toBeGreaterThan(0)
    for (const tag of controls) {
      const name = /<(\w+)/.exec(tag)?.[1] ?? '?'
      expect(tag, `${name} disables on \`running\` without a quiet marker`)
        .toMatch(/data-quiet=|quiet=\{/)
    }
  })

  it('suppresses the dim through the stylesheet, not by dropping the disable', () => {
    // The guard has to stay immediate: a control that merely LOOKS enabled but
    // still refuses the click is correct, while one that accepts a second click
    // fires two git calls.
    expect(css).toMatch(/\[data-quiet\]:disabled\s*\{[^}]*opacity:\s*1/)
    expect(syncBar).not.toMatch(/disabled=\{running && /)
  })

  it('keeps a control dimmed when it is disabled for a reason of its own', () => {
    // Pull with no upstream is unavailable whether or not anything runs. Were
    // it marked quiet, an unavailable action would look available — and would
    // then dim as the operation aged, which is a new flicker.
    expect(syncBar).toMatch(/quietlyDisabled\(running, sustained, noUpstream\)/)
  })
})

describe('one button vocabulary', () => {
  /** Controls that take their geometry from the shared rule. */
  const CONTROLS = ['.btn', '.miniBtn', '.treeIcon', '.commitCopy', '.scopeBtn', '.refButton']

  const SHARED_SELECTOR = '.btn, .miniBtn, .treeIcon, .commitCopy, .scopeBtn, .refButton'

  it('gives every control the same height, type size and hover', () => {
    const shared = block(SHARED_SELECTOR)
    for (const property of ['height', 'padding', 'font-size', 'border-radius', 'border', 'cursor']) {
      expect(shared, property).toMatch(new RegExp(`${property}:`))
    }
  })

  it('leaves no control out of the shared rule', () => {
    // Read the selector list back out of the stylesheet rather than trusting the
    // copy above: a control dropped from the rule is the regression to catch,
    // and comparing two constants in this file would never see it.
    // `.commitCopy` also has a one-line rule of its own for `margin-left`, so
    // take the widest selector list mentioning it — the grouped one.
    const candidates = [...css.matchAll(/\n([^\n{}]*\.commitCopy[^\n{}]*)\{/g)]
      .map(match => match[1]!.split(',').map(part => part.trim()))
    expect(candidates.length, 'no rule mentions .commitCopy').toBeGreaterThan(0)
    const selectors = candidates.reduce((widest, next) => next.length > widest.length ? next : widest)
    for (const control of CONTROLS) {
      expect(selectors, control).toContain(control)
    }
  })

  it('lets no control re-declare its own size', () => {
    // Standalone rules are still allowed — `.commitCopy` needs `margin-left`, the
    // pane tools legitimately opt down to the compact height — but a control
    // that spells out a raw pixel size has stepped outside the scale.
    for (const control of CONTROLS) {
      for (const match of css.matchAll(new RegExp(`^\\${control}\\s*\\{([^}]*)\\}`, 'gm'))) {
        expect(match[1], `${control} declares a literal size`).not.toMatch(/(height|font-size|border-radius):\s*\d/)
      }
    }
  })

  it('scales type through the three tokens rather than literals', () => {
    const scale = block('.overlay {')
    for (const token of ['--gs-t-meta', '--gs-t-dense', '--gs-t-ui', '--gs-r-pill', '--gs-r-control', '--gs-r-surface']) {
      expect(scale, token).toContain(token)
    }
  })

  // The sync buttons differ by STATE, not by build. A Push with commits to send
  // must be the same object as an idle one wearing a colour — the moment a
  // variant sets its own height or padding, the bar has four button shapes
  // again and the tint stops reading as a signal.
  it('tints the sync variants without rebuilding them', () => {
    for (const name of ['btnAhead', 'btnBehind', 'btnPrimary', 'headerPicker']) {
      // Match the class wherever it ends a selector, qualified or not:
      // `.headerPicker` had to become `.refButton.headerPicker` to beat source
      // order, and an anchored `^\.headerPicker` quietly stopped matching it —
      // the loop ran zero times and the assertion passed by finding nothing.
      const rules = [...css.matchAll(new RegExp(`^[^\\n{}]*\\.${name}\\s*\\{([^}]*)\\}`, 'gm'))]
      expect(rules.length, `no rule found for .${name}`).toBeGreaterThan(0)
      for (const match of rules) {
        expect(match[1], `.${name} declares geometry`)
          .not.toMatch(/(^|[\s;])(height|padding|font-size|border-radius|line-height):/)
      }
    }
  })

  // Fetch is read-only, so it has no state to announce. Leaving one of the
  // three permanently quiet is what makes the other two register as signal.
  it('gives fetch no state variant to wear', () => {
    expect(css).not.toMatch(/\.btnFetch\b/)
  })

  // A modifier applied as `${css.base} ${css.mod}` has the SAME specificity as
  // its base, so which one wins is decided by source order in this file. That
  // is silent when it goes wrong: the rule is there, the value is right, and
  // the control just renders as though the modifier were never written. The
  // worktree chip shipped grey that way — `.headerPicker` sits in the header
  // section, 800 lines above the button vocabulary that also sets `color`.
  //
  // Read the pairs out of the panel rather than listing them here, so a
  // modifier added later is covered without anyone remembering to add it.
  it('lets every modifier out-rank the base it is applied over', () => {
    const pairs = [...tsx.matchAll(/`((?:\$\{css\.\w+\}\s*){2,})`/g)].map(match =>
      [...match[1]!.matchAll(/css\.(\w+)/g)].map(m => m[1]!))
    expect(pairs.length, 'no class combinations found in the panel').toBeGreaterThan(4)

    /**
     * Where the LAST rule sits that lists this class as a selector ALL BY
     * ITSELF — those are the only ones at the same specificity, and so the only
     * ones order decides. `.btn:disabled` and `.pullGroup > .btn` out-specify a
     * bare modifier and are meant to; counting them would demand an ordering
     * that changes nothing.
     */
    // Comments first: this stylesheet documents nearly every rule, and a
    // comment sits between the previous `}` and the selector it explains, so
    // scanning the raw text hands you the prose as part of the selector list.
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, '')
    const lastRuleOf = (name: string): number => {
      let at = -1
      for (const m of bare.matchAll(/(^|\})\s*([^{}@]+)\{/g)) {
        if (m[2]!.split(',').some(part => part.trim() === `.${name}`)) at = m.index!
      }
      return at
    }

    for (const classes of pairs) {
      const [base, ...mods] = classes
      const baseAt = lastRuleOf(base!)
      if (baseAt < 0) continue
      for (const mod of mods) {
        // -1 means the modifier has no BARE rule at all — it is written
        // qualified (`.refButton.headerPicker`), which out-specifies the base
        // and so wins wherever it sits. Nothing to order.
        const modAt = lastRuleOf(mod)
        if (modAt < 0) continue
        expect(
          modAt,
          `.${mod} is applied over .${base} but is declared above it — qualify it as .${base}.${mod}, or move it below`,
        ).toBeGreaterThan(baseAt)
      }
    }
  })
})

describe('the roll-back confirmation covers the drawer', () => {
  // `.drawer > *:not(.resizer) { position: relative }` out-specifies a bare
  // `.confirmScrim`, so an `position: absolute` written on the class alone is
  // present, correct and ignored — the scrim laid itself out as the last flex
  // item and the dialog appeared in a 170px strip at the bottom of the drawer.
  // Nothing errors; it just stops being a modal.
  it('declares the scrim as a drawer child so it out-ranks the stacking rule', () => {
    const scoped = /\.drawer\s*>\s*\.confirmScrim\s*\{([^}]*)\}/.exec(css)
    expect(scoped?.[1], 'no `.drawer > .confirmScrim` rule').toMatch(/position:\s*absolute/)
    expect(scoped![1], 'the scrim must fill the drawer').toMatch(/inset:\s*0/)
  })

  it('leaves no losing copy of the same declaration on the bare class', () => {
    // A second `position` on `.confirmScrim` would read as the authority while
    // never applying, which is how the first version was reviewed as correct.
    const bare = /(^|\})\s*\.confirmScrim\s*\{([^}]*)\}/m.exec(css)
    expect(bare?.[2], 'no bare .confirmScrim rule').toBeDefined()
    expect(bare![2], '.confirmScrim re-declares a position it cannot win').not.toMatch(/position:/)
  })

  it('puts the scrim above every bar it has to cover', () => {
    const rank = (selector: string): number =>
      Number(/z-index:\s*(\d+)/.exec(block(selector))?.[1] ?? '0')
    const scrim = rank('.drawer > .confirmScrim')
    expect(scrim, 'the scrim has no rank').toBeGreaterThan(0)
    for (const bar of ['.drawer > .header', '.drawer > .tabs', '.drawer > .compareBar', '.drawer > .syncBar']) {
      expect(scrim, `the scrim sits under ${bar}`).toBeGreaterThan(rank(bar))
    }
  })
})

describe('names stay readable when the row runs out of width', () => {
  // `direction: rtl` truncates from the left in one declaration, and reorders
  // the backslashes of a Windows path while it does it. The two-span split is
  // the version that survives a backslashed Windows worktree path.
  it('never truncates a name by reversing it', () => {
    for (const selector of ['.elide', '.elideHead', '.elideTail']) {
      expect(css, selector).toMatch(new RegExp(`\\${selector}\\b`))
    }
    expect(block('.elide {'), '.elide').not.toMatch(/direction:\s*rtl/)
  })

  it('spends the head before the tail, but lets the tail give way at the end', () => {
    // Both ends must be able to ellipsise: a name with no head at all — a bare
    // `some-very-long-branch-name` — would otherwise refuse to shrink and
    // overflow its row. What makes the head go FIRST is the shrink weight, not
    // pinning the tail, so read the two factors back out and compare them.
    for (const part of ['.elideHead', '.elideTail']) {
      expect(block(part), part).toMatch(/text-overflow:\s*ellipsis/)
      expect(block(part), part).toMatch(/min-width:\s*0/)
    }
    const shrinkOf = (part: string): number =>
      Number(/flex:\s*\d+\s+(\d+)/.exec(block(part))?.[1] ?? '1')
    expect(
      shrinkOf('.elideHead'),
      'the head must out-shrink the tail, or the leaf is what disappears',
    ).toBeGreaterThan(shrinkOf('.elideTail'))
  })

  // Width is the stylesheet's question. Cutting the string in JS applied the
  // same 21-character limit at 400px and maximised, and cut the end that says
  // which branch it is.
  it('leaves branch truncation to css rather than slicing the string', () => {
    expect(tsx, 'branchLabel must not slice').not.toMatch(/branch\.slice\(/)
    expect(tsx, 'no hand-appended ellipsis on a branch').not.toMatch(/\$\{branch\.slice[^}]*\}…/)
  })
})

describe('a refresh does not blank what it is about to replace', () => {
  // `treeLoading` is true for two different things: a worktree switch, which
  // empties the list first and so has nothing to state, and an ordinary
  // refresh, which every tick performs over data still on screen. Rendering a
  // placeholder on the raw flag conflates them — measured as 400ms of the
  // header totals being swapped for a `—` and back on every single tick.
  it('renders no placeholder straight off the in-flight flag', () => {
    expect(tsx, 'header totals must gate on showsPending, not treeLoading')
      .not.toMatch(/\{\s*treeLoading\s*\?/)
  })

  // Three copies of `loading && files.length === 0` existed, and the header was
  // written as a fourth that forgot the second half. The rule now has one home.
  it('derives the placeholder rule exactly once', () => {
    // Comments first — the rule is DESCRIBED in prose next to `showsPending`
    // and beside the prop it resolves, and a scan of the raw text counts those
    // as occurrences.
    const code = tsx.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    const inline = [...code.matchAll(/loading[^\n]*&&[^\n]*files\.length === 0/g)]
    expect(inline.map(m => m[0]), 'the rule belongs in showsPending alone').toEqual([])
    expect(code, 'and the panel must actually call it').toMatch(/showsPending\(/)
  })
})
