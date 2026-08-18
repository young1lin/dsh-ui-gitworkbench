/**
 * The query-box grammar for the history filter, and its chip model.
 *
 * The box and the funnel popup are two views of ONE LogFilter: typing
 * `user:lia after:2 weeks ago` and ticking authors in the popup produce the
 * same object, rendered back into the box by {@link serializeLogQuery} and
 * into removable chips by {@link chipsFromFilter}. Everything is pure so the
 * grammar round-trips under test: parse(serialize(f)) === f.
 *
 * Grammar (prefixes case-insensitive, IDEA-style):
 *   bare words      → the text criterion (commit-message match)
 *   user:<name>     → author; repeatable, multiple OR
 *   path:<spec>     → pathspec; repeatable, union
 *   after:<date>    → approxidate lower bound, single (last wins)
 *   before:<date>   → approxidate upper bound, single
 *   "..."           → quoted span: exact value after a prefix, or exact text
 *   unknown:prefix  → an ordinary word (lenient, like IDEA)
 *
 * Only DATE values auto-extend over following words ("after:2 weeks ago") —
 * approxidate is naturally multi-word. user/path take their inline value;
 * names with spaces come from the popup or quotes.
 *
 * @module @young1lin/dsh-ui-gitworkbench/log-filter-query
 */

import type { LogFilter } from '../log-filter.ts'

/** The filter that filters nothing. */
export function emptyQueryFilter(): LogFilter {
  return { users: [], text: '', textRegex: false, paths: [], after: '', before: '' }
}

/** Criterion kinds a chip can represent. */
export type ChipKind = 'user' | 'path' | 'after' | 'before' | 'text'

/** One removable criterion, as shown under the filter box. */
export interface FilterChip {
  readonly kind: ChipKind
  readonly value: string
}

const PREFIXES: readonly ChipKind[] = ['user', 'path', 'after', 'before']
const PREFIX_RE = /^(user|path|after|before):(.*)$/i

interface Token {
  readonly value: string
  readonly quoted: boolean
  readonly kind?: ChipKind
}

function tokenize(query: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < query.length) {
    while (i < query.length && /\s/.test(query[i]!)) i += 1
    if (i >= query.length) break
    if (query[i] === '"') {
      const end = query.indexOf('"', i + 1)
      const value = end === -1 ? query.slice(i + 1) : query.slice(i + 1, end)
      tokens.push({ value, quoted: true })
      i = end === -1 ? query.length : end + 1
      continue
    }
    // `prefix:"value with spaces"` — the quote opens INSIDE the word, right
    // after the colon, so the word scanner below must not eat it as text.
    const prefixQuote = /^(user|path|after|before):"/i.exec(query.slice(i))
    if (prefixQuote !== null) {
      const kind = prefixQuote[1]!.toLowerCase() as ChipKind
      const open = i + prefixQuote[0].length
      const end = query.indexOf('"', open)
      const value = end === -1 ? query.slice(open) : query.slice(open, end)
      tokens.push({ value, quoted: true, kind })
      i = end === -1 ? query.length : end + 1
      continue
    }
    const start = i
    while (i < query.length && !/\s/.test(query[i]!)) i += 1
    const word = query.slice(start, i)
    const match = PREFIX_RE.exec(word)
    tokens.push(match === null
      ? { value: word, quoted: false }
      : { value: match[2]!, quoted: false, kind: match[1]!.toLowerCase() as ChipKind })
  }
  return tokens
}

/**
 * Parse the box's text into a filter.
 * @param query - raw box contents.
 */
export function parseLogQuery(query: string): LogFilter {
  const tokens = tokenize(query)
  const users: string[] = []
  const paths: string[] = []
  let text = ''
  let after = ''
  let before = ''

  const textWords: string[] = []
  let i = 0
  while (i < tokens.length) {
    const token = tokens[i]!
    if (token.kind === undefined) {
      textWords.push(token.value)
      i += 1
      continue
    }
    if (token.kind === 'user' || token.kind === 'path') {
      const list = token.kind === 'user' ? users : paths
      if (token.value.length > 0 && !list.includes(token.value)) list.push(token.value)
      i += 1
      continue
    }
    // Date bounds: approxidate is naturally multi-word, so an unquoted value
    // swallows the bare words that follow, stopping at the next prefix token
    // or a quoted span. A QUOTED base value is exact — no extension.
    const parts: string[] = [token.value]
    let j = token.quoted ? i : i + 1
    while (j < tokens.length && tokens[j]!.kind === undefined && !tokens[j]!.quoted && tokens[j]!.value.length > 0) {
      parts.push(tokens[j]!.value)
      j += 1
    }
    const value = parts.join(' ').trim()
    if (token.kind === 'after') after = value
    else before = value
    i = token.quoted ? i + 1 : j
  }
  text = textWords.join(' ').trim()
  return { users, text, textRegex: false, paths, after, before }
}

/** Quote a serialized value iff it would not reparse as itself. */
function quote(value: string): string {
  return /\s/.test(value) ? `"${value}"` : value
}

/**
 * Render a filter back into the box's grammar. The text criterion goes last
 * and is quoted when any of its words would parse as a prefix token.
 * @param filter - the filter to render.
 */
export function serializeLogQuery(filter: LogFilter): string {
  const parts: string[] = []
  for (const user of filter.users) parts.push(`user:${quote(user)}`)
  for (const path of filter.paths) parts.push(`path:${quote(path)}`)
  if (filter.after.length > 0) parts.push(`after:${quote(filter.after)}`)
  if (filter.before.length > 0) parts.push(`before:${quote(filter.before)}`)
  if (filter.text.length > 0) {
    const looksPrefixed = filter.text.split(/\s+/).some(word => PREFIX_RE.test(word))
    parts.push(looksPrefixed ? `"${filter.text}"` : filter.text)
  }
  return parts.join(' ')
}

/**
 * One chip per criterion, in grammar order: users, paths, bounds, text.
 * @param filter - the filter to decompose.
 */
export function chipsFromFilter(filter: LogFilter): readonly FilterChip[] {
  const chips: FilterChip[] = []
  for (const user of filter.users) chips.push({ kind: 'user', value: user })
  for (const path of filter.paths) chips.push({ kind: 'path', value: path })
  if (filter.after.length > 0) chips.push({ kind: 'after', value: filter.after })
  if (filter.before.length > 0) chips.push({ kind: 'before', value: filter.before })
  if (filter.text.length > 0) chips.push({ kind: 'text', value: filter.text })
  return chips
}

/**
 * The filter minus one chip. Immutable; dropping the last criterion yields
 * the empty filter.
 * @param filter - current filter.
 * @param kind - the chip's criterion kind.
 * @param value - the chip's value (which user, which path).
 */
export function removeChip(filter: LogFilter, kind: ChipKind, value: string): LogFilter {
  switch (kind) {
    case 'user':
      return { ...filter, users: filter.users.filter(user => user !== value) }
    case 'path':
      return { ...filter, paths: filter.paths.filter(path => path !== value) }
    case 'after':
      return { ...filter, after: '' }
    case 'before':
      return { ...filter, before: '' }
    case 'text':
      return { ...filter, text: '', textRegex: false }
  }
}
