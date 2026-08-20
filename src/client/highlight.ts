/**
 * Diff highlighter: Shiki core with the JavaScript regex engine (no Oniguruma
 * WASM) and a real TextMate theme per drawer palette. The css-variables theme
 * only has ~8 token slots, so identifiers, types and punctuation all collapsed
 * to the body colour — which is why a homemade four-kind pass looked the same
 * as "only keywords are coloured". Bundled themes emit a hex per scope.
 *
 * Boot grammars: TypeScript, shell, JSON. Everything else the drawer opens
 * loads lazily.
 */
import { createHighlighterCoreSync } from 'shiki/core'
import { createJavaScriptRegexEngine, defaultJavaScriptRegexConstructor } from 'shiki/engine/javascript'
import langTs from '@shikijs/langs/typescript'
import langBash from '@shikijs/langs/shellscript'
import langJson from '@shikijs/langs/json'
import githubDark from 'shiki/themes/github-dark-default.mjs'
import githubLight from 'shiki/themes/github-light-default.mjs'
import darkPlus from 'shiki/themes/dark-plus.mjs'
import lightPlus from 'shiki/themes/light-plus.mjs'
import oneDarkPro from 'shiki/themes/one-dark-pro.mjs'
import oneLight from 'shiki/themes/one-light.mjs'
import solarizedDark from 'shiki/themes/solarized-dark.mjs'
import solarizedLight from 'shiki/themes/solarized-light.mjs'
import nord from 'shiki/themes/nord.mjs'
import synthwave84 from 'shiki/themes/synthwave-84.mjs'
import type { HighlighterCore } from 'shiki/core'
import type { Row } from './diff-model.ts'

type LangModule = { default: typeof langTs }

const LANGS = [langTs, langBash, langJson]

const THEMES = [
  githubDark, githubLight, darkPlus, lightPlus,
  oneDarkPro, oneLight, solarizedDark, solarizedLight,
  nord, synthwave84,
]

const LAZY_GRAMMARS = new Map<string, () => Promise<LangModule>>([
  ['python', () => import('@shikijs/langs/python')],
  ['css', () => import('@shikijs/langs/css')],
  ['markdown', () => import('@shikijs/langs/markdown')],
  ['html', () => import('@shikijs/langs/html')],
  ['yaml', () => import('@shikijs/langs/yaml')],
  ['toml', () => import('@shikijs/langs/toml')],
  ['rust', () => import('@shikijs/langs/rust')],
  ['go', () => import('@shikijs/langs/go')],
  ['java', () => import('@shikijs/langs/java')],
  ['c', () => import('@shikijs/langs/c')],
  ['cpp', () => import('@shikijs/langs/cpp')],
  // sql/xml were the loud gap: schema dumps and pom/config diffs rendered as
  // plain text. ini and diff ride along — small grammars, common in repos.
  // Every entry lands in client.js (inlineDynamicImports), so additions stay
  // deliberate, not encyclopedic.
  ['sql', () => import('@shikijs/langs/sql')],
  ['xml', () => import('@shikijs/langs/xml')],
  ['ini', () => import('@shikijs/langs/ini')],
  ['diff', () => import('@shikijs/langs/diff')],
])

const LANG_ALIASES = new Map<string, string>([
  ['typescript', 'typescript'], ['ts', 'typescript'], ['tsx', 'typescript'],
  ['javascript', 'typescript'], ['js', 'typescript'], ['jsx', 'typescript'],
  ['mjs', 'typescript'], ['cjs', 'typescript'],
  ['shellscript', 'shellscript'], ['bash', 'shellscript'], ['sh', 'shellscript'],
  ['shell', 'shellscript'], ['zsh', 'shellscript'], ['ps1', 'shellscript'],
  ['json', 'json'], ['jsonc', 'json'],
  ['py', 'python'], ['python', 'python'],
  ['css', 'css'], ['scss', 'css'], ['less', 'css'],
  ['md', 'markdown'], ['markdown', 'markdown'],
  ['html', 'html'], ['htm', 'html'],
  ['yaml', 'yaml'], ['yml', 'yaml'],
  ['toml', 'toml'],
  ['rs', 'rust'], ['rust', 'rust'],
  ['go', 'go'],
  ['java', 'java'],
  ['c', 'c'],
  ['cpp', 'cpp'], ['h', 'c'], ['hpp', 'cpp'],
  ['sql', 'sql'],
  ['xml', 'xml'], ['xsl', 'xml'], ['xsd', 'xml'], ['svg', 'xml'],
  ['ini', 'ini'], ['properties', 'ini'], ['conf', 'ini'], ['cfg', 'ini'],
  ['diff', 'diff'], ['patch', 'diff'],
])

/** Drawer `data-gs-theme` → a loaded Shiki theme name. */
const PALETTE_THEMES: Record<string, string> = {
  'github-dark': 'github-dark-default',
  'github-light': 'github-light-default',
  'vscode-dark': 'dark-plus',
  'vscode-light': 'light-plus',
  'one-dark': 'one-dark-pro',
  'one-light': 'one-light',
  'solarized-dark': 'solarized-dark',
  'solarized-light': 'solarized-light',
  'nord-dark': 'nord',
  'nord-light': 'github-light-default',
  'cyberpunk-dark': 'synthwave-84',
  'cyberpunk-light': 'synthwave-84',
}

const regexEngine = createJavaScriptRegexEngine({
  forgiving: true,
  regexConstructor: pattern => defaultJavaScriptRegexConstructor(pattern, {
    lazyCompileLength: Number.POSITIVE_INFINITY,
  }),
})

let singleton: HighlighterCore | undefined

function highlighter(): HighlighterCore {
  singleton ??= createHighlighterCoreSync({
    themes: THEMES,
    langs: LANGS,
    engine: regexEngine,
  })
  return singleton
}

const requested = new Set<string>()
const listeners = new Set<() => void>()
let loadCount = 0

/** Subscribe to lazy-grammar loads so a first render can re-highlight. */
export function subscribeGrammarLoaded(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Snapshot for `useSyncExternalStore`. */
export function grammarLoadCount(): number {
  return loadCount
}

function ensureGrammar(resolved: string): boolean {
  const load = LAZY_GRAMMARS.get(resolved)
  if (load === undefined) return true
  if (highlighter().getLoadedLanguages().includes(resolved)) return true
  if (!requested.has(resolved)) {
    requested.add(resolved)
    void load().then(mod => {
      highlighter().loadLanguageSync(mod.default)
      loadCount += 1
      for (const listener of listeners) listener()
    })
  }
  return false
}

export interface HighlightRun {
  readonly text: string
  readonly color: string | undefined
  readonly italic?: boolean
}

/**
 * Language id Shiki accepts for this path, or undefined for plain text.
 * @param path - file path from the unified diff.
 */
export function shikiLangOf(path: string): string | undefined {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  return LANG_ALIASES.get(ext)
}

/**
 * Shiki theme loaded for this drawer palette.
 * @param palette - `data-gs-theme` value (`github-dark`, …).
 */
export function shikiThemeOf(palette: string): string {
  return PALETTE_THEMES[palette] ?? (palette.endsWith('light') ? 'github-light-default' : 'github-dark-default')
}

/**
 * Tokenize a whole file into per-line runs. Undefined until a lazy grammar
 * finishes loading (caller re-renders via {@link subscribeGrammarLoaded}).
 *
 * Diff reconstructions are not real files: a hunk often starts inside
 * `export default {` or an unclosed `/*`, and Shiki then paints the following
 * added statements as object keys or comments — keywords go missing. Comment
 * lines keep the file-level pass (JSDoc ` * `); every other line is re-lexed
 * on its own so `async` / `function` / `const` colour as they would at the
 * top level.
 * @param lines - source lines, no leading +/-.
 * @param lang - from {@link shikiLangOf}.
 * @param theme - from {@link shikiThemeOf}.
 */
export function highlightFile(
  lines: readonly string[],
  lang: string | undefined,
  theme = 'github-dark-default',
): HighlightRun[][] | undefined {
  const fileTok = tokenizeLines(lines, lang, theme)
  if (fileTok === undefined) return undefined
  return lines.map((line, i) => {
    const together = fileTok[i] ?? [{ text: line, color: undefined }]
    if (looksLikeCommentLine(line)) return together
    const solo = tokenizeLines([line], lang, theme)?.[0]
    return solo !== undefined && solo.length > 0 ? solo : together
  })
}

/**
 * Tokenize a file that really is one — the whole of it, in one pass.
 *
 * {@link highlightFile} re-lexes every non-comment line ON ITS OWN because a
 * diff reconstruction is not a real file. That costs one Shiki call per line:
 * measured on 1000 lines, the whole-file pass is 42ms and the thousand solo
 * passes on top of it are another 644ms. It also throws away the only pass
 * that knows about multi-line strings, block comments and template literals.
 *
 * When the lines ARE a complete file — the file browser's buffer, the diff
 * pane's editor buffer — none of that applies: the file pass is both cheaper
 * and more accurate, so it is the whole answer.
 *
 * @param lines - the file's lines, complete and in order.
 * @param lang - from {@link shikiLangOf}.
 * @param theme - from {@link shikiThemeOf}.
 */
export function highlightWholeFile(
  lines: readonly string[],
  lang: string | undefined,
  theme = 'github-dark-default',
): HighlightRun[][] | undefined {
  return tokenizeLines(lines, lang, theme)
}

/**
 * How many lines above the window are tokenized for context.
 *
 * Shiki lexes a string from its start, so a slice beginning inside a block
 * comment or a template literal would colour as if it were code. Reading a
 * lead-in restores that state for everything but a construct longer than this,
 * at a fraction of the cost of the file: at 4,000 lines the whole-file pass was
 * the entire remaining freeze once the DOM was bounded.
 */
export const HIGHLIGHT_LEAD_IN = 240

/**
 * Runs for the rows in a window, and nothing outside it.
 *
 * This is the pane's whole highlighting cost now, and it is proportional to the
 * viewport rather than to the file. Measured on a 4,000-line file with a
 * one-line change: whole-file passes plus per-line re-lexing froze the pane for
 * 1.4 seconds; the same file behind an extension no grammar claims cost 22ms of
 * script, which is what proved the entire remainder was Shiki.
 *
 * Both passes happen inside the window: the slice pass, which knows about
 * multi-line constructs within its reach, and the per-line re-lex that makes a
 * diff reconstruction colour as top-level code.
 *
 * @param lines - source lines, no leading +/-.
 * @param lang - from {@link shikiLangOf}.
 * @param theme - from {@link shikiThemeOf}.
 * @param from - first row in the window.
 * @param to - one past the last row in the window.
 * @returns an array indexed by ROW, filled only inside the window; undefined
 *   when no grammar applies, which the caller already renders as plain text.
 */
export function highlightWindow(
  lines: readonly string[],
  lang: string | undefined,
  theme: string,
  from: number,
  to: number,
): (HighlightRun[] | undefined)[] | undefined {
  const first = Math.max(0, Math.trunc(from))
  const last = Math.min(lines.length, Math.trunc(to))
  if (last <= first) return undefined
  const lead = Math.max(0, first - HIGHLIGHT_LEAD_IN)
  const sliceTok = tokenizeLines(lines.slice(lead, last), lang, theme)
  if (sliceTok === undefined) return undefined
  const out: (HighlightRun[] | undefined)[] = new Array<HighlightRun[] | undefined>(lines.length)
  for (let i = first; i < last; i += 1) {
    const line = lines[i]!
    const together = sliceTok[i - lead] ?? [{ text: line, color: undefined }]
    if (looksLikeCommentLine(line)) { out[i] = together; continue }
    const solo = tokenizeLines([line], lang, theme)?.[0]
    out[i] = solo !== undefined && solo.length > 0 ? solo : together
  }
  return out
}

function looksLikeCommentLine(text: string): boolean {
  const t = text.trimStart()
  return t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || t.startsWith('#')
}

function tokenizeLines(
  lines: readonly string[],
  lang: string | undefined,
  theme: string,
): HighlightRun[][] | undefined {
  if (lang === undefined || lines.length === 0) return undefined
  if (!ensureGrammar(lang)) return undefined
  const { tokens } = highlighter().codeToTokens(lines.join('\n'), { lang, theme })
  const last = tokens[tokens.length - 1]
  const rows = tokens.length > 1 && last !== undefined && last.length === 0
    ? tokens.slice(0, -1)
    : tokens
  const out: HighlightRun[][] = rows.map(line => line.map(token => ({
    text: token.content,
    color: token.color,
    italic: token.fontStyle !== undefined && (token.fontStyle & 1) !== 0 ? true : undefined,
  })))
  while (out.length < lines.length) out.push([{ text: lines[out.length]!, color: undefined }])
  return out.slice(0, lines.length)
}

/**
 * Per-row Shiki runs for a unified diff: deletions from the old side,
 * additions and context from the new side, each side highlighted as one file.
 * @param rows - parsed unified-diff rows.
 * @param lang - from {@link shikiLangOf}.
 * @param theme - from {@link shikiThemeOf}.
 */
export function highlightForRows(
  rows: readonly Row[],
  lang: string | undefined,
  theme = 'github-dark-default',
): HighlightRun[][] {
  const oldLines: string[] = []
  const newLines: string[] = []
  const oldAt: number[] = []
  const newAt: number[] = []
  for (const row of rows) {
    if (row.kind === 'del') {
      oldAt.push(oldLines.length)
      newAt.push(-1)
      oldLines.push(row.text)
    } else if (row.kind === 'add') {
      oldAt.push(-1)
      newAt.push(newLines.length)
      newLines.push(row.text)
    } else if (row.kind === 'context') {
      oldAt.push(oldLines.length)
      newAt.push(newLines.length)
      oldLines.push(row.text)
      newLines.push(row.text)
    } else {
      oldAt.push(-1)
      newAt.push(-1)
    }
  }
  const oldTok = highlightFile(oldLines, lang, theme)
  const newTok = highlightFile(newLines, lang, theme)
  return rows.map((row, i) => {
    if (row.kind === 'del') return oldTok?.[oldAt[i]!] ?? [{ text: row.text, color: undefined }]
    if (row.kind === 'add' || row.kind === 'context') return newTok?.[newAt[i]!] ?? [{ text: row.text, color: undefined }]
    return [{ text: row.text, color: undefined }]
  })
}
