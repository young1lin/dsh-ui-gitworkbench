/**
 * Pure diff-model: unified-diff rows and word-level ranges. Kept free of
 * React/CSS so `tests/diff-regression.test.ts` can load it without pulling the
 * panel (CSS modules + the client shim) into vitest.
 *
 * Colour is not this module's job — `highlight.ts` runs Shiki against a real
 * TextMate theme. What stays here is the part Shiki does not do: reading the
 * diff itself, and working out which words on a line actually changed.
 */

export interface Row {
  readonly kind: 'add' | 'del' | 'context' | 'hunk'
  readonly text: string
  readonly oldL: number
  readonly newL: number
}

export interface RowWithRanges extends Row {
  ranges?: Array<readonly [number, number]>
}

/**
 * Parse a unified diff segment into typed rows, tracking line numbers.
 * @param segment - one file's `diff --git` text (headers are skipped).
 */
export function parseRows(segment: string): Row[] {
  const rows: Row[] = []
  const lines = segment.split('\n')
  let oldL = 0
  let newL = 0
  for (const line of lines) {
    if (line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('old mode')
      || line.startsWith('new mode') || line.startsWith('--- ') || line.startsWith('+++ ')
      || line.startsWith('new file') || line.startsWith('deleted file') || line.startsWith('similarity')
      || line.startsWith('rename from') || line.startsWith('rename to') || line.startsWith('\\ No newline')) continue
    if (line.startsWith('@@')) {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
      if (m) { oldL = Number.parseInt(m[1]!, 10); newL = Number.parseInt(m[2]!, 10) }
      rows.push({ kind: 'hunk', text: line, oldL: 0, newL: 0 })
      continue
    }
    if (line.startsWith('+')) {
      rows.push({ kind: 'add', text: line.slice(1), oldL: 0, newL })
      newL += 1
    } else if (line.startsWith('-')) {
      rows.push({ kind: 'del', text: line.slice(1), oldL, newL: 0 })
      oldL += 1
    } else {
      rows.push({ kind: 'context', text: line.slice(1), oldL, newL })
      oldL += 1; newL += 1
    }
  }
  return rows
}

/**
 * Which line-number columns a unified diff actually uses.
 * A new file is only `+` rows (`@@ -0,0 +1,n`), a deletion is only `-`;
 * those should not keep an empty second gutter. Context or a mix needs both.
 * @param rows - parsed unified-diff rows.
 */
export function gutterSides(rows: readonly Row[]): { old: boolean; new: boolean } {
  let old = false
  let neu = false
  for (const row of rows) {
    if (row.kind === 'del') old = true
    else if (row.kind === 'add') neu = true
    else if (row.kind === 'context') { old = true; neu = true }
    if (old && neu) return { old: true, new: true }
  }
  return { old, new: neu }
}

/**
 * Pair adjacent +/- runs index-wise and compute word-level changed ranges per line.
 * @param rows - parsed unified-diff rows.
 */
export function attachWordRanges(rows: Row[]): RowWithRanges[] {
  const out: RowWithRanges[] = rows.map(row => ({ ...row }))
  let i = 0
  while (i < out.length) {
    if (out[i]!.kind !== 'del' && out[i]!.kind !== 'add') { i += 1; continue }
    let delEnd = i
    while (delEnd < out.length && out[delEnd]!.kind === 'del') delEnd += 1
    let addEnd = delEnd
    while (addEnd < out.length && out[addEnd]!.kind === 'add') addEnd += 1
    const pairs = Math.min(delEnd - i, addEnd - delEnd)
    for (let p = 0; p < pairs; p++) {
      const delRow = out[i + p]!
      const addRow = out[delEnd + p]!
      const { oldRanges, newRanges } = changedRanges(delRow.text, addRow.text)
      delRow.ranges = oldRanges
      addRow.ranges = newRanges
    }
    i = addEnd
  }
  return out
}

interface Tok { readonly text: string; readonly start: number; readonly isWs: boolean }

function tokensWithOffsets(text: string): Tok[] {
  const out: Tok[] = []
  const re = /\s+|\S+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) out.push({ text: m[0], start: m.index, isWs: m[0].trim().length === 0 })
  return out
}

/** Word-level diff of two text lines via LCS over whitespace-preserved tokens.
 *  Falls back to whole-line emphasis when the pair is too large. */
function changedRanges(oldText: string, newText: string): { oldRanges: Array<readonly [number, number]>; newRanges: Array<readonly [number, number]> } {
  if (oldText === newText) return { oldRanges: [], newRanges: [] }
  const a = tokensWithOffsets(oldText)
  const b = tokensWithOffsets(newText)
  if (a.length * b.length > 200_000 || a.length + b.length < 2) {
    return { oldRanges: a.length > 0 ? [[0, oldText.length]] : [], newRanges: b.length > 0 ? [[0, newText.length]] : [] }
  }
  const n = a.length
  const m = b.length
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      const same = (a[i]!.isWs && b[j]!.isWs) || a[i]!.text === b[j]!.text
      dp[i]![j] = same ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
    }
  }
  const oldRanges: Array<readonly [number, number]> = []
  const newRanges: Array<readonly [number, number]> = []
  const push = (into: Array<readonly [number, number]>, start: number, end: number): void => {
    const last = into[into.length - 1]
    if (last !== undefined && last[1] === start) into[into.length - 1] = [last[0], end]
    else into.push([start, end])
  }
  let i = 0
  let j = 0
  while (i < n && j < m) {
    const same = (a[i]!.isWs && b[j]!.isWs) || a[i]!.text === b[j]!.text
    if (same) { i += 1; j += 1; continue }
    if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      push(oldRanges, a[i]!.start, a[i]!.start + a[i]!.text.length)
      i += 1
    } else {
      push(newRanges, b[j]!.start, b[j]!.start + b[j]!.text.length)
      j += 1
    }
  }
  while (i < n) { push(oldRanges, a[i]!.start, a[i]!.start + a[i]!.text.length); i += 1 }
  while (j < m) { push(newRanges, b[j]!.start, b[j]!.start + b[j]!.text.length); j += 1 }
  return { oldRanges, newRanges }
}

export interface PaintedTok {
  readonly text: string
  readonly color?: string
  readonly italic?: boolean
  readonly mark: boolean
}

/**
 * Overlay word-level change ranges onto already-lexed tokens, instead of
 * re-lexing slices (a slice of a comment looks like code).
 * @param tokens - one line's tokens (`text` plus optional `color` from Shiki).
 * @param ranges - changed character ranges on that line.
 */
export function overlayRanges(
  tokens: ReadonlyArray<{ readonly text: string; readonly color?: string; readonly italic?: boolean }>,
  ranges: ReadonlyArray<readonly [number, number]>,
): PaintedTok[] {
  if (tokens.length === 0) return []
  if (ranges.length === 0) return tokens.map(tok => ({ text: tok.text, color: tok.color, italic: tok.italic, mark: false }))
  const out: PaintedTok[] = []
  let offset = 0
  let ri = 0
  for (const tok of tokens) {
    let local = 0
    while (local < tok.text.length) {
      const abs = offset + local
      while (ri < ranges.length && ranges[ri]![1] <= abs) ri += 1
      const range = ranges[ri]
      const marked = range !== undefined && abs >= range[0] && abs < range[1]
      const cut = marked
        ? Math.min(tok.text.length, range[1] - offset)
        : range !== undefined && range[0] > abs
          ? Math.min(tok.text.length, range[0] - offset)
          : tok.text.length
      if (cut > local) out.push({ text: tok.text.slice(local, cut), color: tok.color, italic: tok.italic, mark: marked })
      local = cut > local ? cut : local + 1
    }
    offset += tok.text.length
  }
  return out
}
