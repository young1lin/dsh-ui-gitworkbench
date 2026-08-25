/**
 * The Ctrl/Cmd+F panel, restated in the drawer's own controls.
 *
 * `@codemirror/search` ships the panel with the library's stock chrome, and
 * none of it follows a palette: the strip is `#f5f5f5` with black text (or
 * `#333338` with white), the buttons carry a grey `linear-gradient` and a 1px
 * radius, the fields are `1px solid silver`, the ticks are whatever the
 * platform draws, and a match is `#ffff0054`. Worse, form controls do not
 * inherit a font, and the library asks for `font-size: 70%` without naming a
 * family — so the panel renders in the browser's default face at a size no
 * other control in the drawer uses. Over a Nord or a cyberpunk drawer the
 * strip stays light grey with black text on it.
 *
 * So the panel is dressed here, and ONLY through `--gs-*` tokens: every
 * palette then clothes it for free, exactly as it clothes the pane around it.
 * None of the shapes are invented for this panel — each is the one already on
 * screen beside it:
 *
 * - the strip follows `.blockBar`, the drawer's other float over code, where
 *   `--gs-surface-2` plus a soft shadow are what keep it readable.
 * - the buttons follow the shared compact control (`.treeIcon`,
 *   `.funnelPreset`, `.layoutButton`): `--gs-h-compact`, `--gs-pad-compact`,
 *   `--gs-r-control`, `--gs-t-dense`, and the same hover.
 * - the fields follow the tree's own filter box, `.fbSearch`.
 * - the ticks follow `.funnelRow input[type=checkbox]`: `appearance: none`
 *   and a rotated border for the mark, so nothing ships as an asset and every
 *   state recolors with the theme.
 *
 * Layout is the other half, and it stays in INLINE FLOW on purpose. The
 * obvious answer — make the panel a wrapping flex row with one gap — costs
 * the find/replace break: the library separates the two halves with a `<br>`,
 * and Blink gives a `<br>` no box of its own inside a flex container. Neither
 * `flex-basis: 100%`, `width: 100%` nor `min-width: 100%` on it makes the
 * replace field start a line (measured on the running app; all four left it
 * beside `by word`). So the controls stay inline-level atoms instead, and
 * carry the rhythm the library asked for with `.2em .6em .2em 0` in a single
 * margin. Wrapping still works when the pane is narrow: an atomic inline is a
 * line-break opportunity, which is what lets the strip reflow in the 190px
 * the Changes column drags down to.
 *
 * Kept out of `CodeEditor.tsx` so a test can read it: that file pulls React
 * and a CSS Module, and neither loads under vitest.
 *
 * @module @young1lin/dsh-ui-gitworkbench/client/cm-search-theme
 */

/** A CodeMirror theme spec, narrowed to what this module writes: one flat
 *  declaration block per selector, no nesting and no at-rules. */
export type ThemeSpec = Readonly<Record<string, Readonly<Record<string, string>>>>

/** Selector prefix for everything inside the panel. Spelled out per rule
 *  rather than nested, because CodeMirror's style builder only nests under a
 *  `&`, and a flat key is what a test can read back. */
const PANEL = '.cm-panel.cm-search'

/** Between two controls on a row, and between the find row and the replace
 *  row. The row gap is carried as a bottom margin per control, because inline
 *  flow has no `gap`; the panel's bottom padding is short by exactly this. */
const GAP = '6px'
const ROW_GAP = '6px'

export const SEARCH_PANEL_THEME: ThemeSpec = {
  /* The strip. `.cm-panels` is the element the library paints, so the
     override belongs there rather than on the panel inside it. The shadow is
     `.blockBar`'s: this is a sticky bar with code scrolling under it, and a
     border alone leaves the two planes touching. */
  '.cm-panels': {
    backgroundColor: 'var(--gs-surface-2)',
    color: 'var(--gs-fg)',
    boxShadow: '0 4px 14px var(--gs-shadow)',
  },
  '.cm-panels-top': { borderBottom: '1px solid var(--gs-border)' },
  '.cm-panels-bottom': { borderTop: '1px solid var(--gs-border)' },

  [PANEL]: {
    position: 'relative',
    /* The right gutter is the close button's: it is positioned over it, so
       nothing may wrap underneath. The bottom is short by ROW_GAP, which every
       control carries below itself; the two add back up to the top. */
    padding: '8px 32px 2px 10px',
    lineHeight: '1',
  },
  /* One rhythm for the whole strip, replacing the library's `.2em .6em .2em 0`.
     `vertical-align: top` with one height is what makes a row of controls a
     row rather than four boxes on a shared baseline. */
  [`${PANEL} input, ${PANEL} button, ${PANEL} label`]: {
    boxSizing: 'border-box',
    verticalAlign: 'top',
    margin: `0 ${GAP} ${ROW_GAP} 0`,
  },

  [`${PANEL} .cm-textfield`]: {
    /* A column rather than a share of the row: find and replace are read as a
       pair, and a pair that does not start and end at the same x is noise. */
    width: '220px',
    maxWidth: '100%',
    boxSizing: 'border-box',
    height: 'var(--gs-h-compact)',
    padding: '0 8px',
    font: 'inherit',
    fontSize: 'var(--gs-t-dense)',
    color: 'var(--gs-fg)',
    backgroundColor: 'var(--gs-surface)',
    border: '1px solid var(--gs-border)',
    borderRadius: 'var(--gs-r-control)',
  },
  [`${PANEL} .cm-textfield::placeholder`]: { color: 'var(--gs-fg-faint)' },
  [`${PANEL} .cm-textfield:focus`]: { outline: 'none', borderColor: 'var(--gs-accent)' },

  [`${PANEL} .cm-button`]: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxSizing: 'border-box',
    height: 'var(--gs-h-compact)',
    padding: 'var(--gs-pad-compact)',
    font: 'inherit',
    fontSize: 'var(--gs-t-dense)',
    lineHeight: '1',
    whiteSpace: 'nowrap',
    color: 'var(--gs-fg-dim)',
    /* The gradient is the library's, and it is on `background-image`: a
       background COLOUR alone would leave it painted on top. */
    backgroundColor: 'transparent',
    backgroundImage: 'none',
    border: '1px solid var(--gs-border)',
    borderRadius: 'var(--gs-r-control)',
    cursor: 'pointer',
    transition: 'background 120ms ease, color 120ms ease, border-color 120ms ease',
  },
  [`${PANEL} .cm-button:hover`]: {
    color: 'var(--gs-fg)',
    backgroundColor: 'var(--gs-raise)',
    backgroundImage: 'none',
    borderColor: 'var(--gs-fg-fainter)',
  },
  /* The library keeps a second gradient for the pressed state. */
  [`${PANEL} .cm-button:active`]: {
    backgroundColor: 'var(--gs-raise)',
    backgroundImage: 'none',
  },
  [`${PANEL} .cm-button:focus-visible`]: { outline: '2px solid var(--gs-accent)', outlineOffset: '1px' },

  [`${PANEL} label`]: {
    display: 'inline-flex',
    alignItems: 'center',
    boxSizing: 'border-box',
    height: 'var(--gs-h-compact)',
    gap: '5px',
    font: 'inherit',
    fontSize: 'var(--gs-t-meta)',
    lineHeight: '1',
    whiteSpace: 'nowrap',
    color: 'var(--gs-fg-dim)',
    cursor: 'pointer',
    WebkitUserSelect: 'none',
    userSelect: 'none',
  },

  [`${PANEL} input[type=checkbox]`]: {
    WebkitAppearance: 'none',
    appearance: 'none',
    position: 'relative',
    boxSizing: 'border-box',
    width: '14px',
    height: '14px',
    margin: '0',
    backgroundColor: 'transparent',
    border: '1px solid var(--gs-fg-fainter)',
    borderRadius: '3px',
    cursor: 'pointer',
    transition: 'background 120ms ease, border-color 120ms ease',
  },
  [`${PANEL} input[type=checkbox]:hover`]: { borderColor: 'var(--gs-fg-dim)' },
  [`${PANEL} input[type=checkbox]:checked`]: {
    backgroundColor: 'var(--gs-accent)',
    borderColor: 'var(--gs-accent)',
  },
  [`${PANEL} input[type=checkbox]:focus-visible`]: { outline: '2px solid var(--gs-accent)', outlineOffset: '1px' },
  [`${PANEL} input[type=checkbox]:checked::after`]: {
    content: '""',
    position: 'absolute',
    left: '4px',
    top: '1px',
    width: '3px',
    height: '7px',
    border: 'solid var(--gs-on-accent)',
    borderWidth: '0 1.5px 1.5px 0',
    transform: 'rotate(42deg)',
  },

  /* Close. Square and quiet — it dismisses a panel, so it is not the drawer's
     red header close. `background-color` is restated because the library sets
     it to `inherit`, which would take the strip's fill. */
  [`${PANEL} [name=close]`]: {
    position: 'absolute',
    top: '8px',
    right: '8px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '20px',
    height: '20px',
    padding: '0',
    margin: '0',
    font: 'inherit',
    fontSize: 'var(--gs-t-ui)',
    lineHeight: '1',
    color: 'var(--gs-fg-faint)',
    backgroundColor: 'transparent',
    border: '1px solid transparent',
    borderRadius: 'var(--gs-r-control)',
    cursor: 'pointer',
  },
  [`${PANEL} [name=close]:hover`]: { color: 'var(--gs-fg)', backgroundColor: 'var(--gs-raise)' },
  [`${PANEL} [name=close]:focus-visible`]: { outline: '2px solid var(--gs-accent)', outlineOffset: '1px' },

  /* A hit, and the hit the caret is on. Amber is what an editor uses to say
     "found", and `--gs-warn` is the only warm token every palette defines;
     the current one takes the drawer's single selected idiom —
     `--gs-accent-bg` inside `--gs-accent-border` — rather than a second
     highlighter colour. Declared after the plain match: both classes sit on
     the same span at the same specificity, so source order decides. */
  '.cm-searchMatch': {
    backgroundColor: 'color-mix(in srgb, var(--gs-warn) 30%, transparent)',
    borderRadius: '2px',
  },
  '.cm-searchMatch-selected': {
    backgroundColor: 'color-mix(in srgb, var(--gs-accent) 34%, transparent)',
    boxShadow: 'inset 0 0 0 1px var(--gs-accent)',
  },
}
