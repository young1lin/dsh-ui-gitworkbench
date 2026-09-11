/**
 * Diff highlighter: Shiki core on the Oniguruma engine (the WASM build, inlined
 * in the bundle) and a real TextMate theme per drawer palette. The
 * css-variables theme only has ~8 token slots, so identifiers, types and
 * punctuation all collapsed to the body colour — which is why a homemade
 * four-kind pass looked the same as "only keywords are coloured". Bundled
 * themes emit a hex per scope.
 *
 * Oniguruma rather than Shiki's JavaScript regex engine because the engine IS
 * the per-line cost, and the JavaScript one emulates Oniguruma's syntax on top
 * of native RegExp — a translation the heavy grammars pay for on every line.
 * Cold, in Node, same grammars, real files: the first 37 lines of C++ cost
 * 900ms there and 172ms here; an 80-line window of this plugin's TSX, 175ms
 * and 30ms; re-lexing those 80 lines one at a time, 75ms and 12ms. The drawer
 * feels that first number as the freeze after a click, and the others as
 * every scroll and every window that follows.
 *
 * The price is that the engine loads asynchronously (the wasm instantiates
 * off-thread), so the highlighter does not exist for the first few tens of
 * milliseconds after it is asked for. Every tokenizer here answers "no
 * grammar" until then — plain text, the same answer a lazy grammar gives
 * before it lands — and the panes repaint on the same subscription when it
 * arrives. The drawer warms it as it opens ({@link warmHighlighter}), which
 * is well ahead of the first click on a file.
 *
 * Boot grammars: TypeScript, shell, JSON. Everything else the drawer opens
 * loads lazily.
 */
import { createHighlighterCoreSync } from 'shiki/core'
import { createOnigurumaEngine } from 'shiki/engine/oniguruma'
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
import { ChunkedTokens, LineTokens, docKey, type ChunkTokenizer } from './token-cache.ts'
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

let singleton: HighlighterCore | undefined
let starting: Promise<void> | undefined

/**
 * Start the engine, once, and resolve when the highlighter exists.
 *
 * Idempotent and cheap to call again, so the drawer calls it as it opens and
 * every tokenizer calls it when it finds no highlighter — whichever comes
 * first starts the load, and the rest join it. Failure leaves the drawer in
 * plain text rather than broken: the promise settles either way, and the
 * tokenizers keep answering "no grammar".
 */
export function warmHighlighter(): Promise<void> {
  starting ??= createOnigurumaEngine(import('shiki/wasm'))
    .then(engine => {
      singleton = createHighlighterCoreSync({ themes: THEMES, langs: LANGS, engine })
      loadCount += 1
      for (const listener of listeners) listener()
    })
    .catch((error: unknown) => {
      console.warn('[gitworkbench] syntax highlighting is off: the regex engine did not load', error)
    })
  return starting
}

/** The highlighter, or undefined while its engine is still loading. */
function highlighter(): HighlighterCore | undefined {
  if (singleton === undefined) void warmHighlighter()
  return singleton
}

/**
 * Everything this module has already tokenized.
 *
 * Both are bounded (see `token-cache.ts`): the drawer can be left open on a
 * repository all day, and what these hold is capped in lines, not in files
 * visited. Keys carry the language and the theme, so a palette change does not
 * serve the last theme's colours - it just misses.
 */
const chunks = new ChunkedTokens()
const solo = new LineTokens()

/** Drop every cached token. Nothing in the drawer needs this today - the keys
 *  already separate languages and themes - but a cache with no way to empty it
 *  is a cache you cannot reason about. */
export function forgetTokens(): void {
  chunks.clear()
  solo.clear()
}

const requested = new Set<string>()
const listeners = new Set<() => void>()
let loadCount = 0

/** Subscribe to lazy-grammar loads — and the engine's own arrival — so a
 *  first render can re-highlight. */
export function subscribeGrammarLoaded(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Snapshot for `useSyncExternalStore`. */
export function grammarLoadCount(): number {
  return loadCount
}

/** The highlighter with this grammar loaded, or undefined while either is
 *  still on its way — in which case the load has been started. */
function ready(resolved: string): HighlighterCore | undefined {
  const hl = highlighter()
  if (hl === undefined) return undefined
  const load = LAZY_GRAMMARS.get(resolved)
  if (load === undefined) return hl
  if (hl.getLoadedLanguages().includes(resolved)) return hl
  if (!requested.has(resolved)) {
    requested.add(resolved)
    void load().then(mod => {
      hl.loadLanguageSync(mod.default)
      loadCount += 1
      for (const listener of listeners) listener()
    })
  }
  return undefined
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
 * Tokenize a whole file into per-line runs, the way a DIFF needs it.
 *
 * A diff reconstruction is not a real file: a hunk often starts inside
 * `export default {` or an unclosed block comment, and Shiki then paints the
 * following added statements as object keys or comment text - keywords go
 * missing. Comment lines keep the file-level pass (JSDoc continuation lines);
 * every other line is re-lexed on its own so `async` / `function` / `const`
 * colour as they would at the top level.
 *
 * Asks {@link highlightWindow} for the whole range, so the two-pass rule and
 * the caching have exactly one implementation.
 * @param lines - source lines, no leading +/-.
 * @param lang - from {@link shikiLangOf}.
 * @param theme - from {@link shikiThemeOf}.
 */
export function highlightFile(
  lines: readonly string[],
  lang: string | undefined,
  theme = 'github-dark-default',
): HighlightRun[][] | undefined {
  const windowed = highlightWindow(lines, lang, theme, 0, lines.length)
  if (windowed === undefined) return undefined
  return lines.map((line, i) => windowed[i] ?? [{ text: line, color: undefined }])
}

/**
 * File-quality runs for a range of a file that really IS one.
 *
 * The editor's buffer and the file browser's text are whole files, so the
 * per-line re-lex {@link highlightFile} performs is both wrong for them and
 * expensive; the file pass is the whole answer, and it is the only pass that
 * knows about multi-line strings, block comments and template literals.
 *
 * Only the range is tokenized, and only once: this is what a viewport asks for
 * as the reader scrolls. Measured on 1,837 lines of real TypeScript, the whole
 * file in one pass cost 1,637ms - the freeze the Files tab took on every click,
 * and the reason files past 2,000 lines were left uncoloured altogether rather
 * than made to wait for it.
 *
 * @param key - identity of the document. Must change when the text does; a
 *   path is usually right, because the chunk stamps catch edits within it.
 * @param lines - the file's lines, complete and in order.
 * @param lang - from {@link shikiLangOf}.
 * @param theme - from {@link shikiThemeOf}.
 * @param from - first line wanted.
 * @param to - one past the last line wanted.
 * @returns an array indexed by line, filled only inside the range, or
 *   undefined when no grammar applies.
 */
export function highlightRange(
  key: string,
  lines: readonly string[],
  lang: string | undefined,
  theme: string,
  from: number,
  to: number,
): (HighlightRun[] | undefined)[] | undefined {
  return chunks.runs(key + '|' + (lang ?? '') + '|' + theme, lines, from, to, chunkTokenizer(lang, theme))
}

/**
 * Runs for the rows in a window, and nothing outside it.
 *
 * This is the pane's whole highlighting cost, and it is proportional to the
 * viewport rather than to the file - and then only the FIRST time those lines
 * are read. Both passes go through `token-cache.ts`: the file pass by chunk,
 * continuing from the grammar state of the chunk before it, and the per-line
 * re-lex by the line's own text. Scrolling back over a file costs nothing;
 * measured cold, ten screenfuls of real TypeScript cost 3,021ms before this and
 * are one tokenizing pass per new line after it.
 *
 * Both passes are still here, because a diff reconstruction needs both: the
 * file pass, which knows about multi-line constructs, and the per-line re-lex
 * that makes a hunk colour as top-level code.
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
  // Keyed on the ARRAY, which the panes memoise per file - see `docKey`. A
  // caller that rebuilds an equal array every render gets no caching from it.
  const fileTok = highlightRange(docKey(lines), lines, lang, theme, first, last)
  if (fileTok === undefined) return undefined
  const out: (HighlightRun[] | undefined)[] = new Array<HighlightRun[] | undefined>(lines.length)
  for (let i = first; i < last; i += 1) {
    const line = lines[i]!
    const together = fileTok[i] ?? [{ text: line, color: undefined }]
    if (looksLikeCommentLine(line)) { out[i] = together; continue }
    const alone = soloRuns(line, lang, theme)
    out[i] = alone !== undefined && alone.length > 0 ? alone : together
  }
  return out
}

/** One line lexed on its own, from the cache when it has been seen before -
 *  which, scrolling back over a file, it usually has. */
function soloRuns(line: string, lang: string | undefined, theme: string): HighlightRun[] | undefined {
  if (lang === undefined) return undefined
  return solo.get(lang + '|' + theme + '|' + line, () => tokenizeLines([line], lang, theme)?.[0])
}

/** Bind the engine for {@link ChunkedTokens}: tokenize a chunk continuing from
 *  the grammar state the chunk before it ended in, which Shiki hands back with
 *  the tokens and which makes the continuation exact rather than guessed. */
function chunkTokenizer(lang: string | undefined, theme: string): ChunkTokenizer {
  return (text, state) => {
    if (lang === undefined) return undefined
    const hl = ready(lang)
    if (hl === undefined) return undefined
    const got = hl.codeToTokens(text, { lang, theme, grammarState: state as never })
    return { runs: runsOf(got.tokens, text.split('\n')), state: got.grammarState }
  }
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
  const hl = ready(lang)
  if (hl === undefined) return undefined
  const { tokens } = hl.codeToTokens(lines.join('\n'), { lang, theme })
  return runsOf(tokens, lines)
}

/** Shiki's tokens as runs, one entry per line of the text that produced them. */
function runsOf(
  tokens: ReadonlyArray<ReadonlyArray<{ content: string; color?: string; fontStyle?: number }>>,
  lines: readonly string[],
): HighlightRun[][] {
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
  // One implementation, asked for the whole range. The panes all window now;
  // this shape is what a caller wants when it really does need every row.
  return highlightForRowsWindow(rows, lang, theme, 0, rows.length)
    .map((runs, i) => runs ?? [{ text: rows[i]!.text, color: undefined }])
}

/**
 * {@link highlightForRows} for the rows in a window, and nothing outside it.
 *
 * Same reason as {@link highlightWindow}, in the view History and Compare use:
 * a unified diff of a long file re-lexed every one of its rows, so opening one
 * froze the pane exactly as the side-by-side view did.
 *
 * The mapping from rows to the two sides' line arrays is built over ALL rows —
 * it is array bookkeeping with no Shiki in it, and a row's position on its side
 * depends on every row before it. Only the tokenizing is windowed, and because
 * a window of rows is contiguous, so is the span of lines it needs from each
 * side.
 *
 * @param rows - parsed unified-diff rows.
 * @param lang - from {@link shikiLangOf}.
 * @param theme - from {@link shikiThemeOf}.
 * @param from - first row in the window.
 * @param to - one past the last row in the window.
 * @returns an array indexed by ROW, filled only inside the window.
 */
export function highlightForRowsWindow(
  rows: readonly Row[],
  lang: string | undefined,
  theme: string,
  from: number,
  to: number,
): (HighlightRun[] | undefined)[] {
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
  const first = Math.max(0, Math.trunc(from))
  const last = Math.min(rows.length, Math.trunc(to))
  const span = (at: readonly number[]): { from: number; to: number } => {
    let lo = -1
    let hi = -1
    for (let i = first; i < last; i += 1) {
      const j = at[i]!
      if (j < 0) continue
      if (lo < 0) lo = j
      hi = j
    }
    return lo < 0 ? { from: 0, to: 0 } : { from: lo, to: hi + 1 }
  }
  const oldSpan = span(oldAt)
  const newSpan = span(newAt)
  const oldTok = highlightWindow(oldLines, lang, theme, oldSpan.from, oldSpan.to)
  const newTok = highlightWindow(newLines, lang, theme, newSpan.from, newSpan.to)
  const out: (HighlightRun[] | undefined)[] = new Array<HighlightRun[] | undefined>(rows.length)
  for (let i = first; i < last; i += 1) {
    const row = rows[i]!
    if (row.kind === 'del') out[i] = oldTok?.[oldAt[i]!] ?? [{ text: row.text, color: undefined }]
    else if (row.kind === 'add' || row.kind === 'context') out[i] = newTok?.[newAt[i]!] ?? [{ text: row.text, color: undefined }]
    else out[i] = [{ text: row.text, color: undefined }]
  }
  return out
}
