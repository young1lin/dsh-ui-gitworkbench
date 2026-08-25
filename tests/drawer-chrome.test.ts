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
import { globSync, readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { panelCssSource } from './helpers/panel-css.ts'

const css = panelCssSource()
/** The drawer component family as TEXT — modifier checks read which classes are
 *  combined in markup. Importing it would pull CSS Modules and React into node. */
const tsx = [
  '../src/client/GitWorkbenchPanel.tsx',
  '../src/client/WorkbenchControls.tsx',
  '../src/client/PaneDivider.tsx',
  '../src/client/CommitHistory.tsx',
  '../src/client/ChangesFileTree.tsx',
  '../src/client/DiffViews.tsx',
].map(path => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')).join('\n')

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

/**
 * A token that is spent but never minted.
 *
 * `var(--gs-nope)` is not an error anywhere: the declaration is dropped at
 * computed-value time and the property falls back to its initial value, so a
 * hover renders with no hover, an active row with no fill, and nothing in the
 * build, the type-check or the browser console says a word. The drawer shipped
 * exactly that for `--gs-hover` and `--gs-selected` — named in three rules,
 * defined in none.
 *
 * So both ends are read: everything the drawer MINTS (per-palette declarations
 * in the stylesheet, plus the handful the panel sets inline as a style object)
 * against everything it SPENDS (the stylesheet, and the CodeMirror themes,
 * which are TypeScript because `.cm-*` are global class names a CSS Module
 * would hash away).
 */
describe('every --gs token that is spent is minted somewhere', () => {
  const clientSources = globSync('../src/client/**/*.{ts,tsx}', { cwd: fileURLToPath(new URL('.', import.meta.url)) })
    .map(rel => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'))

  /** Declared in the stylesheet, or handed to an element as an inline custom
   *  property. The panel names those through a constant (`const RAIL_VAR =
   *  '--gs-rail'`), so any bare `'--gs-…'` string literal in client code is a
   *  mint; a `var(--gs-…)` inside a longer string is not, and does not match. */
  function minted(): Set<string> {
    const names = new Set<string>()
    for (const m of css.matchAll(/(--gs-[a-z0-9-]+)\s*:/g)) names.add(m[1]!)
    for (const source of clientSources) {
      for (const m of source.matchAll(/['"`](--gs-[a-z0-9-]+)['"`]/g)) names.add(m[1]!)
    }
    return names
  }

  /** Every `var(--gs-…)`, including the first argument of a fallback pair —
   *  `var(--gs-a, var(--gs-b))` still resolves `--gs-a` first. A name built at
   *  runtime (`var(--gs-graph-${lane % 6})`) names no single token and is
   *  skipped; the family it indexes is covered by the rules that read it. */
  function varsIn(text: string): string[] {
    return [...text.matchAll(/var\(\s*(--gs-[a-z0-9-]+)(.?)/g)]
      .filter(m => m[2] !== '$')
      .map(m => m[1]!)
  }

  /** Every use, kept as a pair so the sanity check below can see that each
   *  half was really read — a total over the union cannot. */
  function spent(): Array<readonly [string, string]> {
    const uses: Array<readonly [string, string]> = []
    const scan = (text: string, where: string): void => {
      for (const name of varsIn(text)) uses.push([name, where] as const)
    }
    scan(css, 'the stylesheet')
    clientSources.forEach((source, i) => scan(source, `client source ${i}`))
    return uses
  }

  it('leaves no rule painting with a token nothing defines', () => {
    const have = minted()
    const first = new Map<string, string>()
    for (const [name, where] of spent()) if (!first.has(name)) first.set(name, where)
    const orphans = [...first].filter(([name]) => !have.has(name))
    expect(orphans.map(([name, where]) => `${name} (${where})`), 'undefined tokens').toEqual([])
  })

  it('reads both halves for that to mean anything', () => {
    // Per HALF, not over the union: an empty result is how a source scan fails,
    // and a guard blinded on one half still sees plenty through the other —
    // it would then report no orphans, forever, for the wrong reason.
    const uses = spent()
    const fromSheet = uses.filter(([, where]) => where === 'the stylesheet')
    const fromThemes = uses.filter(([, where]) => where.startsWith('client source'))
    expect(new Set(fromSheet.map(([name]) => name)).size, 'tokens spent by the stylesheet').toBeGreaterThan(20)
    expect(fromThemes.length, 'tokens spent by the CodeMirror themes').toBeGreaterThan(5)
    expect([...css.matchAll(/(--gs-[a-z0-9-]+)\s*:/g)].length,
      'tokens minted by the stylesheet').toBeGreaterThan(20)
    expect(clientSources.length, 'client sources read').toBeGreaterThan(10)
  })
})

/**
 * ONE VOCABULARY, AND THE DRIFT AROUND IT.
 *
 * The button rules above watch the controls that already joined the shared
 * rule. What they cannot see is what grows beside it: a list row spelling its
 * own 3px radius, a popover control at 22px where the drawer has exactly two
 * heights, a hover written `--gs-panel` where every other hover is
 * `--gs-raise`, a selected state hand-copied instead of joined. None of that
 * shows in review — the rule is there, the value is plausible, and only two
 * panes open side by side say that they disagree. The drawer reached seven
 * list-row types with four radii, three hover colours and three selected
 * idioms exactly this way.
 *
 * So the whole stylesheet is read declaration by declaration, and every
 * exception is written down WITH ITS REASON and asserted to still match
 * something — an exception that stops matching is drift that got fixed and
 * documentation that stayed.
 *
 * `environment.css` is deliberately not read: the session-header card lives in
 * dsh chrome and keeps dsh's own `--dsw-*` tokens (see that file's header).
 */
describe('the drawer keeps one vocabulary', () => {
  const STYLE_DIR = fileURLToPath(new URL('../src/client/styles/', import.meta.url))
  const SHEETS = readdirSync(STYLE_DIR)
    .filter(name => name.endsWith('.css') && name !== 'environment.css')

  interface Decl {
    /** `file.css:line`, so a failure names the source rather than an offset. */
    readonly at: string
    readonly selector: string
    readonly prop: string
    readonly value: string
    /** The whole rule, for the checks that need a sibling declaration. */
    readonly body: string
  }

  /** Comments blanked rather than removed, so `file:line` still points at the
   *  source. A scan in this repo has twice been satisfied by the prose that
   *  explains the thing it was looking for. */
  function blankComments(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\//g, comment => comment.replace(/[^\n]/g, ' '))
  }

  const ALL: readonly Decl[] = SHEETS.flatMap((file) => {
    const source = blankComments(readFileSync(STYLE_DIR + file, 'utf8'))
    const out: Decl[] = []
    let cursor = 0
    let start = 0
    while (cursor < source.length) {
      const char = source[cursor]
      if (char === '{') {
        const selector = source.slice(start, cursor).replace(/\s+/g, ' ').trim()
        let depth = 1
        let end = cursor + 1
        while (end < source.length && depth > 0) {
          if (source[end] === '{') depth++
          else if (source[end] === '}') depth--
          end++
        }
        // `@keyframes` nests blocks of its own and names no drawer control.
        if (!selector.startsWith('@')) {
          const bodyAt = cursor + 1
          const body = source.slice(bodyAt, end - 1)
          for (const match of body.matchAll(/(-{0,2}[a-zA-Z][-a-zA-Z]*)\s*:\s*([^;]+)/g)) {
            const prop = match[1]!
            if (prop.startsWith('--')) continue
            const line = source.slice(0, bodyAt + match.index).split('\n').length
            out.push({ at: `${file}:${line}`, selector, prop, value: match[2]!.trim(), body })
          }
        }
        cursor = end
        start = end
      } else if (char === '}' || char === ';') {
        cursor++
        start = cursor
      } else cursor++
    }
    return out
  })

  /** An exception is a selector plus the reason it is one. Every entry is
   *  asserted to still match a rule, so a stale one fails instead of rotting. */
  interface Exception { readonly selector: string, readonly why: string }

  function allow<T extends { readonly selector: string }>(
    items: readonly T[], exceptions: readonly Exception[], label: string,
  ): readonly T[] {
    const wanted = new Set(exceptions.map(entry => entry.selector))
    const seen = new Set<string>()
    const left: T[] = []
    for (const item of items) {
      if (wanted.has(item.selector)) seen.add(item.selector)
      else left.push(item)
    }
    expect([...wanted].filter(selector => !seen.has(selector)),
      `${label}: exceptions that no longer match anything`).toEqual([])
    return left
  }

  /** One class, hovering: `.fbRow:hover`. Not `.a .b:hover`, not a compound,
   *  not `:hover:not(:disabled)` — each of those is a row seen through
   *  something else, and takes its shape from that something else. */
  const ROW_HOVER = /^\.\w+:hover$/
  const px = (value: string): number => Number.parseFloat(value)
  const sizeIn = (body: string, prop: 'width' | 'height'): number | undefined => {
    const match = new RegExp(`(?:^|[\\s;])${prop}\\s*:\\s*(-?[\\d.]+)px`).exec(body)
    return match ? Number.parseFloat(match[1]!) : undefined
  }

  it('reads the whole drawer, or the checks below mean nothing', () => {
    expect(SHEETS.length, 'stylesheets read').toBeGreaterThan(6)
    expect(SHEETS, 'dsh chrome is not the drawer').not.toContain('environment.css')
    expect(ALL.length, 'declarations parsed').toBeGreaterThan(500)
    expect(new Set(ALL.map(decl => decl.selector)).size, 'rules parsed').toBeGreaterThan(150)
    // The parser must not swallow a nested block whole, and must not hand a
    // keyframe step back as a rule of its own.
    expect(ALL.some(decl => decl.selector.startsWith('@'))).toBe(false)
    expect(ALL.some(decl => decl.selector === 'from')).toBe(false)
  })

  it('rounds every corner from the radius scale', () => {
    // A literal radius means the box is smaller than the smallest control the
    // scale has a number for, and at that size the radius is part of a glyph
    // rather than a shape the eye compares across panes. Anything with a
    // control's dimensions takes a token — a badge included, which is what
    // `--gs-r-control` already names.
    const literals = ALL.filter(decl =>
      decl.prop === 'border-radius' && !decl.value.includes('var(--gs-r-') && px(decl.value) !== 0)
    const glyphs = new Set(literals.filter(decl =>
      (sizeIn(decl.body, 'width') ?? 99) <= 14 || (sizeIn(decl.body, 'height') ?? 99) <= 14))
    const rest = allow(literals.filter(decl => !glyphs.has(decl)), [
      { selector: '.wordAdd', why: 'a tint behind a run of text, sized by the text' },
      { selector: '.wordDel', why: 'a tint behind a run of text, sized by the text' },
    ], 'radius')
    expect(rest.map(decl => `${decl.at} ${decl.selector} { border-radius: ${decl.value} }`)).toEqual([])
  })

  it('gives every row that fills on hover a corner to fill to', () => {
    // The literal scan above only sees a corner that was WRITTEN DOWN. The
    // Changes tree had none at all: its rows took a full-width square fill on
    // hover and when selected, one pane away from a Files tree whose rows were
    // rounded — two lists of the same thing, disagreeing.
    //
    // Asked of the row family only: a bare class, hovering. A button VARIANT
    // (`.btnPrimary:hover:not(:disabled)`) gets its radius from the base class
    // sitting beside it in the markup, which this stylesheet cannot show.
    const rounded = new Set<string>()
    for (const decl of ALL) {
      if (decl.prop !== 'border-radius') continue
      for (const part of decl.selector.split(',')) rounded.add(part.trim())
    }
    const rows = ALL.filter(decl =>
      (decl.prop === 'background' || decl.prop === 'background-color')
      && !/^(?:transparent|none)$/.test(decl.value)
      && decl.selector.split(',').every(part => ROW_HOVER.test(part.trim())))
    const square = rows.filter(decl => decl.selector.split(',')
      .some(part => !rounded.has(part.trim().replace(':hover', ''))))
    expect([...new Set(square.map(decl => `${decl.at} ${decl.selector}`))],
      'rows that fill on hover but declare no radius').toEqual([])
    expect(rows.length, 'row hovers found').toBeGreaterThan(5)
  })

  it('sizes every piece of type from the type scale', () => {
    // The scale starts at `--gs-t-meta`, 11px. Below that a number is a glyph —
    // a caret, a tick, the 8px worktree dot — and not type anybody reads.
    const literals = ALL.filter(decl =>
      decl.prop === 'font-size' && !decl.value.includes('var(--gs-t-'))
    const typeSized = literals.filter(decl => !(px(decl.value) < 11))
    expect(typeSized.map(decl => `${decl.at} ${decl.selector} { font-size: ${decl.value} }`)).toEqual([])
  })

  it('stands every control at one of the two heights', () => {
    // 28px for drawer chrome, 24px inside a panel or pane. A literal in that
    // band is a control that was sized by eye: the funnel popover reached
    // 20 / 22 / 26px that way, inside one 320px box, beside controls at 24.
    const band = ALL.filter(decl =>
      decl.prop === 'height' && /^\d+(?:\.\d+)?px$/.test(decl.value)
      && px(decl.value) >= 18 && px(decl.value) <= 30)
    const notControls = new Set(band.filter((decl) => {
      const width = sizeIn(decl.body, 'width')
      // A square is a badge or a swatch; a 3px sliver is a bar or a grab handle.
      return width !== undefined && (width === px(decl.value) || width <= 4)
    }))
    const rest = allow(band.filter(decl => !notControls.has(decl)), [
      { selector: '.segmentChip', why: 'a colour swatch naming a mode, stretched by the segment it fills' },
    ], 'control height')
    expect(rest.map(decl => `${decl.at} ${decl.selector} { height: ${decl.value} }`)).toEqual([])
  })

  it('keeps the editable rail above the gutter it overlays', () => {
    // CodeMirror stacks `.cm-gutters` at z-index 200 and the rail overlays its
    // first two pixels. At the default z-index the rail is behind it, which is
    // invisible while the gutter is transparent and total once it is not.
    const rail = ALL.filter(decl =>
      decl.selector.includes('.cmHost') && decl.selector.includes('::before')
      && decl.prop === 'z-index')
    expect(rail.length, 'the rail should declare a z-index').toBeGreaterThan(0)
    for (const decl of rail) {
      expect(Number.parseInt(decl.value, 10), `${decl.at} ${decl.selector}`).toBeGreaterThan(200)
    }
  })

  it('gives every neutral hover the same one colour', () => {
    // `--gs-raise` is the drawer's "the pointer is here" lift. A hover that
    // paints a STATE — a warn tint on Pull, an accent on a picker — is saying
    // something else and keeps its own colour; a hover that only lifts the row
    // has to be the same lift everywhere, or two panes disagree about what a
    // pointer looks like.
    const SEMANTIC = /var\(--gs-(?:accent|add|del|warn|info|neutral|fg-)/
    const hovers = ALL.filter(decl =>
      /:hover(?![-\w])/.test(decl.selector)
      && (decl.prop === 'background' || decl.prop === 'background-color')
      && !/^(?:transparent|none)$/.test(decl.value)
      && !SEMANTIC.test(decl.value))
    const wrong = hovers.filter(decl => decl.value !== 'var(--gs-raise)')
    expect(wrong.map(decl => `${decl.at} ${decl.selector} { ${decl.prop}: ${decl.value} }`)).toEqual([])
    expect(hovers.length, 'neutral hovers found').toBeGreaterThan(5)
  })

  it('says "this one is selected" exactly one way', () => {
    // Accent text, inside an accent tint, inside an accent border. It was three
    // idioms — chip, filled panel, left accent bar — for one meaning, and the
    // drawer showed two of them at once whenever the Changes tree sat beside
    // the history.
    const IDIOM = ['var(--gs-accent-bg)', 'var(--gs-accent-border)', 'var(--gs-accent)']
    const bodies = new Map<string, string>()
    for (const decl of ALL) bodies.set(decl.selector, decl.body)
    const spellsIt = [...bodies].map(([selector, body]) => ({ selector, body }))
      .filter(rule => IDIOM.every(token => rule.body.includes(token)))

    // The rule that IS the selected state is the one whose every selector is a
    // modifier. Read that way rather than by name, so a member added later is
    // covered without anyone remembering to update this file.
    const isModifier = (selector: string): boolean => selector.split(',')
      .every(part => /(?:Active|Primary)$/.test(part.trim().split('.').pop() ?? ''))
    const selected = spellsIt.filter(rule => isModifier(rule.selector))
    expect(selected.map(rule => rule.selector), 'the selected state should live in one rule')
      .toHaveLength(1)
    const shared = new Set(selected[0]!.selector.split(',').map(part => part.trim()))

    // The same chip also says WHERE YOU ARE, which is a different sentence and
    // a legitimate second reader of the idiom — but only for a ref, and only
    // where the ref is the subject rather than one of several choices.
    allow(spellsIt.filter(rule => !isModifier(rule.selector)), [
      { selector: '.headerBranch', why: 'names the branch the drawer is open on' },
      { selector: '.commitRef', why: 'names a ref that points at this commit' },
      { selector: '.refButton.headerPicker', why: 'the trigger that opens the worktree the header names' },
    ], 'the accent chip')

    // Every selected-state modifier joins that rule, or names the different
    // idiom it wears and why that idiom is not a selection.
    const OTHER_IDIOMS: readonly Exception[] = [
      { selector: '.tabActive', why: 'a tab: accent label over an accent underline, not a chip' },
      { selector: '.tabActive::after', why: 'the underline itself' },
      { selector: '.sideTabActive', why: 'the same tab idiom in the side pane' },
      { selector: '.sideTabActive::after', why: 'the underline itself' },
      { selector: '.funnelButton.funnelButtonActive', why: 'a trigger reporting that its panel holds criteria' },
      { selector: '.treeDirActive', why: 'an ancestor hint — the folder CONTAINING the open file, not a selection' },
      { selector: '.resizerActive::after', why: 'active means being dragged' },
      { selector: '.paneDividerActive::after', why: 'active means being dragged' },
      { selector: '.paneDividerY.paneDividerActive::after', why: 'active means being dragged' },
    ]
    const modifiers = ALL.filter(decl =>
      /\.\w+Active(?![\w-])/.test(decl.selector)
      && decl.selector !== selected[0]!.selector && !shared.has(decl.selector))
    const rest = allow(modifiers, OTHER_IDIOMS, 'selected state')
    expect([...new Set(rest.map(decl => `${decl.at} ${decl.selector}`))],
      'hand-spelled selected states').toEqual([])
  })
})
