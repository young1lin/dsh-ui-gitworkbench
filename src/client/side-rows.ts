/**
 * The side-by-side diff's row model: a parsed full-context diff turned into
 * rows that pair the two columns.
 *
 * A unified diff already IS an alignment — `context` lines hit both columns, a
 * `del` the left one, an `add` the right one — so no diff algorithm is needed
 * here or bundled: `git diff -U1000000` emits one hunk covering the whole file
 * and this module only has to read that alignment into rows.
 *
 * The pairing rule is positional, the way IDEA renders it: inside a run of
 * consecutive changed lines the 1st deletion pairs with the 1st addition, the
 * 2nd with the 2nd, … into `change` rows, and whatever has no partner becomes a
 * one-sided `del` or `add` row. A one-line edit is then ONE row with both
 * sides, not a delete row above an add row.
 *
 * A block — a maximal run of changed rows uninterrupted by a `same` row — is
 * the unit the stage/discard/unstage buttons of the editable view act on.
 * `blockLines` names a block back in the hunk's own coordinates: the line
 * indices it returns are exactly the selection `patch-model`'s `emitPatch`
 * needs to reproduce that block alone, which is the contract that keeps those
 * buttons correct.
 *
 * `\ No newline at end of file` markers belong to the line before them and
 * never form a row of their own. They are carried, not dropped: a row's
 * `leftIndex`/`rightIndex` stay true indices into `hunk.lines`, so the marker
 * describing a row's line is reachable as `index + 1` when a later task wants
 * to render it.
 *
 * Pure: no React, no CSS, no git. `tests/side-rows.test.ts` loads it directly.
 */

import type { FilePatch } from '../patch-model.ts'

/** One column's half of a row: that side's real line number and text. */
export interface SideCell {
  readonly line: number
  readonly text: string
}

export interface SideRow {
  /** `same` both columns equal; `change` a paired del/add; `del`/`add` one-sided. */
  readonly kind: 'same' | 'change' | 'del' | 'add'
  readonly left: SideCell | null
  readonly right: SideCell | null
  /** Index into the hunk's `lines` for the LEFT cell, -1 when absent. */
  readonly leftIndex: number
  /** Index into the hunk's `lines` for the RIGHT cell, -1 when absent. */
  readonly rightIndex: number
  /** Which change block this row belongs to; -1 for unchanged rows. */
  readonly block: number
}

/** One collected side of a run of changed lines, with its hunk-line index. */
interface RunSide {
  readonly index: number
  readonly text: string
}

/**
 * Align a full-context diff's single hunk into two-column rows.
 *
 * @param file - a parsed diff. Full context means one hunk; anything else is
 *               the caller's bug, and mis-aligning it silently would be worse
 *               than refusing.
 * @returns the rows, in file order: `same` rows carry both line numbers,
 *          changed rows carry their block id.
 * @throws when the patch does not have exactly one hunk.
 */
export function alignRows(file: FilePatch): readonly SideRow[] {
  if (file.hunks.length !== 1) {
    throw new Error(`alignRows expects the one hunk of a full-context diff, got ${file.hunks.length}`)
  }
  const hunk = file.hunks[0]!
  const rows: SideRow[] = []
  let oldL = hunk.oldStart
  let newL = hunk.newStart
  let block = -1

  let i = 0
  while (i < hunk.lines.length) {
    const line = hunk.lines[i]!
    if (line.kind === 'nonewline') {
      // Describes the line before it, which a row already carries; never a row.
      i += 1
      continue
    }
    if (line.kind === 'context') {
      rows.push({
        kind: 'same',
        left: { line: oldL, text: line.text },
        right: { line: newL, text: line.text },
        leftIndex: i,
        rightIndex: i,
        block: -1,
      })
      oldL += 1
      newL += 1
      i += 1
      continue
    }

    // A run of del/add lines — one block. `\ No newline` markers inside the
    // run are transparent: git can put one between the deletions and the
    // additions, and that is still ONE change, not two blocks with no context
    // line between them.
    const dels: RunSide[] = []
    const adds: RunSide[] = []
    let j = i
    while (j < hunk.lines.length) {
      const run = hunk.lines[j]!
      if (run.kind === 'del') dels.push({ index: j, text: run.text })
      else if (run.kind === 'add') adds.push({ index: j, text: run.text })
      else if (run.kind !== 'nonewline') break
      j += 1
    }
    block += 1

    const pairs = Math.min(dels.length, adds.length)
    for (let p = 0; p < pairs; p += 1) {
      rows.push({
        kind: 'change',
        left: { line: oldL, text: dels[p]!.text },
        right: { line: newL, text: adds[p]!.text },
        leftIndex: dels[p]!.index,
        rightIndex: adds[p]!.index,
        block,
      })
      oldL += 1
      newL += 1
    }
    for (let p = pairs; p < dels.length; p += 1) {
      rows.push({
        kind: 'del',
        left: { line: oldL, text: dels[p]!.text },
        right: null,
        leftIndex: dels[p]!.index,
        rightIndex: -1,
        block,
      })
      oldL += 1
    }
    for (let p = pairs; p < adds.length; p += 1) {
      rows.push({
        kind: 'add',
        left: null,
        right: { line: newL, text: adds[p]!.text },
        leftIndex: -1,
        rightIndex: adds[p]!.index,
        block,
      })
      newL += 1
    }
    i = j
  }
  return rows
}

/**
 * Every hunk line index a block covers: each of its rows' `leftIndex` and
 * `rightIndex` where present, ascending, without duplicates.
 *
 * @param rows - rows from {@link alignRows}.
 * @param block - a block id the rows carry.
 * @returns the indices, exactly the selection `emitPatch` takes to reproduce
 *          this block alone (its own changes plus the file's context).
 */
export function blockLines(rows: readonly SideRow[], block: number): readonly number[] {
  const indices = new Set<number>()
  for (const row of rows) {
    if (row.block !== block) continue
    if (row.leftIndex !== -1) indices.add(row.leftIndex)
    if (row.rightIndex !== -1) indices.add(row.rightIndex)
  }
  return [...indices].sort((a, b) => a - b)
}

/**
 * How many change blocks the rows hold.
 *
 * @param rows - rows from {@link alignRows}.
 * @returns the block count, 0 for an unchanged file.
 */
export function blockCount(rows: readonly SideRow[]): number {
  let max = -1
  for (const row of rows) if (row.block > max) max = row.block
  return max + 1
}
