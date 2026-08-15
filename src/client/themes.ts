/**
 * The drawer's theme model: which palettes exist, which one a given appearance
 * setting resolves to, and how the two styling scopes combine.
 *
 * Kept apart from the panel so it carries no CSS-module or React import, which
 * is what lets `tests/theme-palettes.test.ts` hold the families here and the
 * palettes in `GitWorkbenchPanel.module.css` to each other. Every family named here
 * MUST have both an `-dark` and an `-light` palette in that stylesheet: a
 * missing one leaves the drawer with no `--gs-*` token defined at all, which
 * renders as unstyled black-on-white rather than as a visible error.
 */

/**
 * Colour mode. `system` follows the host app (dsh writes `body[data-ds-dark-theme]`
 * when its resolved palette is dark); `light` / `dark` pin the drawer even if
 * dsh itself is the other scheme.
 */
export type ColorMode = 'system' | 'light' | 'dark'

/** Theme family. Each supplies a light and a dark palette. */
export type ThemeFamily = 'github' | 'idea' | 'vscode' | 'one' | 'solarized' | 'nord' | 'cyberpunk'

export const COLOR_MODES: readonly ColorMode[] = ['system', 'light', 'dark']

/** One family's menu entry. */
export interface ThemeFamilyOption {
  readonly id: ThemeFamily
  readonly label: string
  /** Ground, accent, and add colour — the three the swatch previews. */
  readonly swatch: readonly [string, string, string]
}

/** Families in menu order, each with the colours that preview it. */
export const THEME_FAMILIES: readonly ThemeFamilyOption[] = [
  { id: 'github', label: 'GitHub', swatch: ['#0d1117', '#58a6ff', '#3fb950'] },
  { id: 'idea', label: 'IntelliJ IDEA', swatch: ['#1e1f22', '#3574f0', '#5fad65'] },
  { id: 'vscode', label: 'VS Code', swatch: ['#1e1e1e', '#0098ff', '#89d185'] },
  { id: 'one', label: 'One', swatch: ['#282c34', '#61afef', '#98c379'] },
  { id: 'solarized', label: 'Solarized', swatch: ['#002b36', '#268bd2', '#859900'] },
  { id: 'nord', label: 'Nord', swatch: ['#2e3440', '#88c0d0', '#a3be8c'] },
  { id: 'cyberpunk', label: 'Cyberpunk', swatch: ['#0b0417', '#00f0ff', '#ff2e88'] },
]

/** Persisted appearance choice. */
export interface Appearance {
  readonly mode: ColorMode
  readonly family: ThemeFamily
}

/** Follow the host app, in the default palette. */
export const DEFAULT_APPEARANCE: Appearance = { mode: 'system', family: 'github' }

/**
 * Narrow a stored value to an appearance choice.
 * @param value - value read back from storage, written by any earlier build.
 * @returns whether it names a mode and family this build still has.
 */
export function isAppearance(value: unknown): value is Appearance {
  if (typeof value !== 'object' || value === null) return false
  const { mode, family } = value as Partial<Appearance>
  return COLOR_MODES.some(known => known === mode)
    && THEME_FAMILIES.some(known => known.id === family)
}

/**
 * Body attribute dsh's ThemePresenter toggles for the active palette.
 * This plugin reads it rather than `prefers-color-scheme`: a plugin follows
 * the host, not the computer.
 */
export const DSH_DARK_ATTR = 'data-ds-dark-theme'

/**
 * Whether dsh's resolved palette is currently dark.
 * @param body - `document.body`, or a stand-in in tests.
 */
export function hostSchemeDark(body: { hasAttribute(name: string): boolean }): boolean {
  return body.hasAttribute(DSH_DARK_ATTR)
}

/**
 * Resolve the palette to paint with.
 * @param appearance - the user's stored choice.
 * @param hostDark - whether dsh's resolved palette is currently dark.
 * @returns the `data-gs-theme` value naming one palette.
 */
export function resolveTheme(appearance: Appearance, hostDark: boolean): string {
  const dark = appearance.mode === 'system' ? hostDark : appearance.mode === 'dark'
  return `${appearance.family}-${dark ? 'dark' : 'light'}`
}

/* ---------------------------- custom styling ---------------------------- */

/**
 * One scope's styling, mirroring the host's `StyleEntry`.
 *
 * The client never has to validate these: the host sanitizes on both read and
 * write, so a value that reaches here is already in range and the image is
 * already known to be a base64 `data:` URL safe to interpolate into `url()`.
 */
export interface StyleEntry {
  readonly css: string
  readonly image: string
  readonly blur: number
  readonly veil: number
}

/** Which scope an edit applies to. */
export type StyleScope = 'project' | 'global'

export const STYLE_SCOPES: readonly StyleScope[] = ['project', 'global']

/** What the host reports for a directory: each scope, unresolved. */
export interface StyleSettings {
  readonly project: StyleEntry | null
  readonly global: StyleEntry | null
  /** Repository root the project scope is keyed by; null outside a repository. */
  readonly repoRoot: string | null
}

/** An entry with nothing set — what an unconfigured scope opens on. */
export const DEFAULT_STYLE: StyleEntry = { css: '', image: '', blur: 18, veil: 78 }

/** Top of the blur slider. Must match the host's own cap, which clamps to it. */
export const STYLE_BLUR_MAX = 60

/** Nothing configured in either scope. */
export const EMPTY_SETTINGS: StyleSettings = { project: null, global: null, repoRoot: null }

/**
 * The background image actually shown.
 *
 * An image is not composable, so the project's replaces the global one outright
 * rather than merging field by field — the blur and veil that were tuned for one
 * photograph say nothing about another.
 * @param settings - both scopes.
 * @returns the winning entry's background, or null when neither sets an image.
 */
export function effectiveBackground(settings: StyleSettings): StyleEntry | null {
  for (const entry of [settings.project, settings.global]) {
    if (entry !== null && entry.image.length > 0) return entry
  }
  return null
}

/**
 * The custom CSS actually applied.
 *
 * Both scopes apply, global first, so the project's rules win ties by cascade
 * order while a global rule the project does not mention still holds. That is
 * what CSS already does with two stylesheets, and it is more useful than an
 * override: a global rule can set the type scale for every project while one
 * project recolours its accent.
 * @param settings - both scopes.
 * @returns the concatenated stylesheet, empty when neither scope sets any.
 */
export function effectiveCss(settings: StyleSettings): string {
  const parts: string[] = []
  for (const entry of [settings.global, settings.project]) {
    if (entry !== null && entry.css.trim().length > 0) parts.push(entry.css)
  }
  return parts.join('\n')
}

/**
 * @param settings - both scopes.
 * @param scope - the scope being edited.
 * @returns that scope's entry, or the defaults when it has none yet.
 */
export function entryFor(settings: StyleSettings, scope: StyleScope): StyleEntry {
  return (scope === 'project' ? settings.project : settings.global) ?? DEFAULT_STYLE
}

/**
 * @param settings - both scopes.
 * @param scope - the scope that changed.
 * @param entry - its new value.
 * @returns settings with that scope replaced.
 */
export function withScope(settings: StyleSettings, scope: StyleScope, entry: StyleEntry): StyleSettings {
  return scope === 'project' ? { ...settings, project: entry } : { ...settings, global: entry }
}
