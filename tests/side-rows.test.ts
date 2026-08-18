import { describe, expect, it } from 'vitest'

import { emitPatch, parsePatch } from '../src/patch-model.ts'
import { alignRows, blockCount, blockLines } from '../src/client/side-rows.ts'

/** Join with LF and keep the trailing newline git's own output carries. */
function diff(...lines: string[]): string {
  return lines.join('\n') + '\n'
}

/** A pure-context diff: a whole unchanged file, one hunk, no changed lines. */
const PURE_CONTEXT = diff(
  'diff --git a/plain.txt b/plain.txt',
  '--- a/plain.txt',
  '+++ b/plain.txt',
  '@@ -1,3 +1,3 @@',
  ' one',
  ' two',
  ' three',
)

/** One run of two equal-length del/add pairs, wrapped in context. */
const EQUAL_RUN = diff(
  'diff --git a/even.txt b/even.txt',
  '--- a/even.txt',
  '+++ b/even.txt',
  '@@ -1,4 +1,4 @@',
  ' keep',
  '-old two',
  '+new two',
  '-old three',
  '+new three',
  ' keep too',
)

/** Three deletions against one addition: 1 change + 2 one-sided dels. */
const THREE_DEL_ONE_ADD = diff(
  'diff --git a/shrink.txt b/shrink.txt',
  '--- a/shrink.txt',
  '+++ b/shrink.txt',
  '@@ -1,5 +1,3 @@',
  ' top',
  '-gone one',
  '-gone two',
  '-gone three',
  '+kept one',
  ' bottom',
)

/** One deletion against three additions: 1 change + 2 one-sided adds. */
const ONE_DEL_THREE_ADD = diff(
  'diff --git a/grow.txt b/grow.txt',
  '--- a/grow.txt',
  '+++ b/grow.txt',
  '@@ -1,3 +1,5 @@',
  ' top',
  '-gone one',
  '+kept one',
  '+kept two',
  '+kept three',
  ' bottom',
)

/** Two change runs separated by exactly one context line. */
const TWO_RUNS = diff(
  'diff --git a/twin.txt b/twin.txt',
  '--- a/twin.txt',
  '+++ b/twin.txt',
  '@@ -1,5 +1,5 @@',
  ' one',
  '-two',
  '+TWO',
  ' three',
  '-four',
  '+FOUR',
  ' five',
)

/** A new file: empty old side, every line an addition. */
const NEW_FILE = diff(
  'diff --git a/fresh.txt b/fresh.txt',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/fresh.txt',
  '@@ -0,0 +1,2 @@',
  '+hello',
  '+world',
)

describe('alignRows', () => {
  it('a pure-context diff yields all same rows and no blocks', () => {
    const rows = alignRows(parsePatch(PURE_CONTEXT)!)
    expect(rows.map(row => row.kind)).toEqual(['same', 'same', 'same'])
    expect(blockCount(rows)).toBe(0)
    for (const row of rows) expect(row.block).toBe(-1)
  })

  it('an equal-length del/add run pairs into change rows', () => {
    const rows = alignRows(parsePatch(EQUAL_RUN)!)
    expect(rows.map(row => row.kind)).toEqual(['same', 'change', 'change', 'same'])
    // 1st del with 1st add, 2nd with 2nd — positional pairing, so a one-line
    // edit renders as one row with both sides instead of a delete above an add.
    expect(rows[1]).toMatchObject({
      kind: 'change',
      left: { line: 2, text: 'old two' },
      right: { line: 2, text: 'new two' },
      leftIndex: 1,
      rightIndex: 2,
      block: 0,
    })
    expect(rows[2]).toMatchObject({
      left: { line: 3, text: 'old three' },
      right: { line: 3, text: 'new three' },
      leftIndex: 3,
      rightIndex: 4,
      block: 0,
    })
  })

  it('3 dels and 1 add yield 1 change plus 2 del rows', () => {
    const rows = alignRows(parsePatch(THREE_DEL_ONE_ADD)!)
    expect(rows.map(row => row.kind)).toEqual(['same', 'change', 'del', 'del', 'same'])
    const [change, delA, delB] = [rows[1]!, rows[2]!, rows[3]!]
    expect(change.left).toMatchObject({ text: 'gone one' })
    expect(change.right).toMatchObject({ text: 'kept one' })
    expect(delA).toMatchObject({ kind: 'del', left: { text: 'gone two' }, right: null, rightIndex: -1 })
    expect(delB).toMatchObject({ kind: 'del', left: { text: 'gone three' }, right: null, rightIndex: -1 })
    // All four changed rows are ONE block: no same row interrupts the run.
    expect([change, delA, delB].map(row => row.block)).toEqual([0, 0, 0])
  })

  it('1 del and 3 adds yield 1 change plus 2 add rows', () => {
    const rows = alignRows(parsePatch(ONE_DEL_THREE_ADD)!)
    expect(rows.map(row => row.kind)).toEqual(['same', 'change', 'add', 'add', 'same'])
    expect(rows[1]).toMatchObject({
      left: { text: 'gone one' },
      right: { text: 'kept one' },
    })
    expect(rows[2]).toMatchObject({ kind: 'add', left: null, leftIndex: -1, right: { text: 'kept two' } })
    expect(rows[3]).toMatchObject({ kind: 'add', left: null, leftIndex: -1, right: { text: 'kept three' } })
  })

  it('two runs separated by one context line are two blocks', () => {
    const rows = alignRows(parsePatch(TWO_RUNS)!)
    expect(rows.map(row => row.kind)).toEqual(['same', 'change', 'same', 'change', 'same'])
    expect(rows[1]!.block).toBe(0)
    expect(rows[3]!.block).toBe(1)
    expect(blockCount(rows)).toBe(2)
  })

  it('line numbers stay continuous and correct across a block', () => {
    const rows = alignRows(parsePatch(THREE_DEL_ONE_ADD)!)
    // The old side walks every line it has (1..5), the new side only its own
    // (top=1, kept one=2, bottom=3) — each column counts its own file.
    expect(rows.filter(row => row.left !== null).map(row => row.left!.line)).toEqual([1, 2, 3, 4, 5])
    expect(rows.filter(row => row.right !== null).map(row => row.right!.line)).toEqual([1, 2, 3])
    const last = rows[rows.length - 1]!
    expect(last).toMatchObject({ kind: 'same', left: { line: 5, text: 'bottom' }, right: { line: 3 } })
  })

  it('a new-file diff has an empty left column throughout', () => {
    const rows = alignRows(parsePatch(NEW_FILE)!)
    expect(rows.map(row => row.kind)).toEqual(['add', 'add'])
    for (const row of rows) {
      expect(row.left).toBeNull()
      expect(row.leftIndex).toBe(-1)
    }
    expect(rows.map(row => row.right!.text)).toEqual(['hello', 'world'])
    expect(rows.map(row => row.right!.line)).toEqual([1, 2])
    expect(blockCount(rows)).toBe(1)
  })

  it('rejects a diff with more than one hunk instead of mis-aligning', () => {
    const twoHunks = diff(
      'diff --git a/x b/x',
      '--- a/x',
      '+++ b/x',
      '@@ -1,2 +1,2 @@',
      ' a',
      '-b',
      '+B',
      '@@ -10,2 +10,2 @@',
      ' y',
      '-z',
      '+Z',
    )
    expect(() => alignRows(parsePatch(twoHunks)!)).toThrow(/one hunk/)
  })

  it('a no-newline marker inside a run is not a row and not a block boundary', () => {
    // Real git shape, confirmed against git itself: when the OLD side loses
    // its trailing newline, the marker sits BETWEEN the dels and the adds.
    // Breaking the run there would render one edit as two blocks with no
    // context line between them.
    const marked = diff(
      'diff --git a/g.txt b/g.txt',
      '--- a/g.txt',
      '+++ b/g.txt',
      '@@ -1,2 +1,3 @@',
      ' a',
      '-b',
      '\\ No newline at end of file',
      '+b',
      '+c',
    )
    const rows = alignRows(parsePatch(marked)!)
    expect(rows.map(row => row.kind)).toEqual(['same', 'change', 'add'])
    expect(rows.map(row => row.block)).toEqual([-1, 0, 0])
    expect(blockCount(rows)).toBe(1)
  })
})

describe('blockLines', () => {
  it('feeds emitPatch the exact indices that reproduce one block alone', () => {
    const file = parsePatch(TWO_RUNS)!
    const rows = alignRows(file)
    expect(blockLines(rows, 0)).toEqual([1, 2])
    expect(blockLines(rows, 1)).toEqual([4, 5])

    // The contract the stage/discard buttons rest on: the indices blockLines
    // returns, handed to patch-model's selector, emit a patch carrying that
    // block's change and NOTHING of the other's — the other del becomes
    // context and the other add is dropped, per git's add -p rules.
    const block0 = new Set(blockLines(rows, 0))
    expect(emitPatch(file, (_hunk, line) => block0.has(line))).toBe(diff(
      'diff --git a/twin.txt b/twin.txt',
      '--- a/twin.txt',
      '+++ b/twin.txt',
      '@@ -1,5 +1,5 @@',
      ' one',
      '-two',
      '+TWO',
      ' three',
      ' four',
      ' five',
    ))

    const block1 = new Set(blockLines(rows, 1))
    expect(emitPatch(file, (_hunk, line) => block1.has(line))).toBe(diff(
      'diff --git a/twin.txt b/twin.txt',
      '--- a/twin.txt',
      '+++ b/twin.txt',
      '@@ -1,5 +1,5 @@',
      ' one',
      ' two',
      ' three',
      '-four',
      '+FOUR',
      ' five',
    ))
  })
})
