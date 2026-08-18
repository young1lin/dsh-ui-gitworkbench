import { describe, expect, it } from 'vitest'

import { emitPatch, parsePatch, selectAll, selectNone, type FilePatch } from '../src/patch-model.ts'

/** Join with LF and keep the trailing newline git's own output carries. */
function diff(...lines: string[]): string {
  return lines.join('\n') + '\n'
}

const TWO_HUNKS = diff(
  'diff --git a/src/queue.ts b/src/queue.ts',
  'index 1111111..2222222 100644',
  '--- a/src/queue.ts',
  '+++ b/src/queue.ts',
  '@@ -1,3 +1,4 @@ export class Queue',
  ' const a = 1',
  '-const b = 2',
  '+const b = 20',
  '+const c = 3',
  ' const d = 4',
  '@@ -10,2 +11,2 @@',
  ' tail one',
  '-tail two',
  '+tail TWO',
)

describe('parsePatch', () => {
  it('splits the header from the hunks', () => {
    const file = parsePatch(TWO_HUNKS)!
    expect(file.header).toEqual([
      'diff --git a/src/queue.ts b/src/queue.ts',
      'index 1111111..2222222 100644',
      '--- a/src/queue.ts',
      '+++ b/src/queue.ts',
    ])
    expect(file.hunks).toHaveLength(2)
  })

  it('reads the hunk header, heading text included', () => {
    const [first] = parsePatch(TWO_HUNKS)!.hunks
    expect(first).toMatchObject({ oldStart: 1, oldCount: 3, newStart: 1, newCount: 4, heading: ' export class Queue' })
  })

  it('types every line and strips the marker', () => {
    const [first] = parsePatch(TWO_HUNKS)!.hunks
    expect(first!.lines.map(l => [l.kind, l.text])).toEqual([
      ['context', 'const a = 1'],
      ['del', 'const b = 2'],
      ['add', 'const b = 20'],
      ['add', 'const c = 3'],
      ['context', 'const d = 4'],
    ])
  })

  it('returns null for text that is not a patch', () => {
    expect(parsePatch('')).toBeNull()
    expect(parsePatch('Binary files a/x and b/x differ\n')).toBeNull()
  })

  it('defaults an omitted count to 1, as the unified format allows', () => {
    const file = parsePatch(diff('--- a/x', '+++ b/x', '@@ -3 +3 @@', '-one', '+two'))!
    expect(file.hunks[0]).toMatchObject({ oldStart: 3, oldCount: 1, newStart: 3, newCount: 1 })
  })
})

describe('emitPatch round trip', () => {
  it('selecting everything reproduces the input byte for byte', () => {
    const file = parsePatch(TWO_HUNKS)!
    expect(emitPatch(file, selectAll)).toBe(TWO_HUNKS)
  })

  it('selecting nothing emits nothing at all', () => {
    // Not an empty header, not a patch with zero hunks: `git apply` rejects
    // both. The caller checks for '' and skips the call.
    expect(emitPatch(parsePatch(TWO_HUNKS)!, selectNone)).toBe('')
  })

  it('reproduces a patch whose text does not end in a newline', () => {
    const raw = 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-one\n+two'
    expect(emitPatch(parsePatch(raw)!, selectAll)).toBe(raw)
  })

  it('keeps CRLF line content intact', () => {
    // `fileDiff` really does return `\r`-terminated content for a CRLF file;
    // a patch that drops it rewrites every line it touches.
    const raw = diff('--- a/x', '+++ b/x', '@@ -1,2 +1,2 @@', ' keep\r', '-one\r', '+two\r')
    const file = parsePatch(raw)!
    expect(file.hunks[0]!.lines[1]!.text).toBe('one\r')
    expect(emitPatch(file, selectAll)).toBe(raw)
  })
})

describe('emitPatch, one hunk at a time', () => {
  it('emits only the chosen hunk, with the header it needs', () => {
    const file = parsePatch(TWO_HUNKS)!
    const out = emitPatch(file, (hunk) => hunk === 1)
    expect(out).toBe(diff(
      'diff --git a/src/queue.ts b/src/queue.ts',
      'index 1111111..2222222 100644',
      '--- a/src/queue.ts',
      '+++ b/src/queue.ts',
      '@@ -10,2 +11,2 @@',
      ' tail one',
      '-tail two',
      '+tail TWO',
    ))
  })

  it('drops a hunk whose changes were all deselected', () => {
    const file = parsePatch(TWO_HUNKS)!
    expect(emitPatch(file, hunk => hunk === 0)).not.toContain('@@ -10')
  })
})

describe('emitPatch, line by line — the `git add -p` rules', () => {
  const file = (): FilePatch => parsePatch(TWO_HUNKS)!

  it('an unselected + line is dropped entirely', () => {
    // Keep the deletion and the first addition, drop `const c = 3`.
    const out = emitPatch(file(), (h, l) => h === 0 && l !== 3)
    expect(out).toContain('+const b = 20')
    expect(out).not.toContain('const c = 3')
  })

  it('an unselected - line becomes context, because that line still exists', () => {
    // Take only the additions: the removal of `const b = 2` is NOT part of
    // this patch, so the line must be presented as still being there.
    const out = emitPatch(file(), (h, l) => h === 0 && (l === 2 || l === 3))
    expect(out).toContain(' const b = 2')
    expect(out).not.toContain('-const b = 2')
  })

  it('recomputes both counts for the lines it actually emitted', () => {
    // additions only: old side = 3 context lines, new side = those plus 2 adds.
    const out = emitPatch(file(), (h, l) => h === 0 && (l === 2 || l === 3))
    expect(out).toContain('@@ -1,3 +1,5 @@ export class Queue')
  })

  it('recounts a deletion-only selection', () => {
    // Take only the removal: old side keeps its 4 lines, new side loses one.
    const out = emitPatch(file(), (h, l) => h === 0 && l === 1)
    expect(out).toContain('@@ -1,3 +1,2 @@ export class Queue')
  })
})

describe('emitPatch, whole-file edges', () => {
  it('keeps a new file addressable: the old side stays at 0', () => {
    const raw = diff(
      'diff --git a/new.txt b/new.txt',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/new.txt',
      '@@ -0,0 +1,2 @@',
      '+one',
      '+two',
    )
    const file = parsePatch(raw)!
    expect(file.hunks[0]).toMatchObject({ oldStart: 0, oldCount: 0, newStart: 1, newCount: 2 })
    expect(emitPatch(file, selectAll)).toBe(raw)
    // Half of a new file is still a valid patch: one line, old side still 0.
    expect(emitPatch(file, (_h, l) => l === 0)).toContain('@@ -0,0 +1,1 @@')
  })

  it('keeps a deletion addressable: the new side goes to 0', () => {
    const raw = diff(
      'diff --git a/gone.txt b/gone.txt',
      'deleted file mode 100644',
      '--- a/gone.txt',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-one',
      '-two',
    )
    const file = parsePatch(raw)!
    expect(emitPatch(file, selectAll)).toBe(raw)
  })

  it('carries the no-newline marker with the line it belongs to', () => {
    const raw = diff(
      '--- a/x',
      '+++ b/x',
      '@@ -1,1 +1,1 @@',
      '-one',
      '\\ No newline at end of file',
      '+two',
    )
    const file = parsePatch(raw)!
    expect(file.hunks[0]!.lines.map(l => l.kind)).toEqual(['del', 'nonewline', 'add'])
    expect(emitPatch(file, selectAll)).toBe(raw)
  })

  it('drops the no-newline marker when its line was dropped', () => {
    // The marker describes a line. Emitting it after a line that is no longer
    // in the patch makes git read it as describing a DIFFERENT line.
    const raw = diff('--- a/x', '+++ b/x', '@@ -1,2 +1,2 @@', ' keep', '+added', '\\ No newline at end of file')
    const out = emitPatch(parsePatch(raw)!, selectNone)
    expect(out).toBe('')
    const kept = emitPatch(parsePatch(raw)!, selectAll)
    expect(kept).toContain('\\ No newline at end of file')
  })
})

describe('emitPatch, hunk offsets', () => {
  it('shifts a later hunk by what the earlier one actually changed', () => {
    // Hunk 0 adds two lines but only one is taken, so hunk 1 starts one line
    // earlier on the new side than the original header claimed.
    const out = emitPatch(parsePatch(TWO_HUNKS)!, (h, l) => (h === 0 && l !== 3) || h === 1)
    expect(out).toContain('@@ -10,2 +10,2 @@')
  })

  it('leaves the offset alone when the earlier hunk is taken whole', () => {
    expect(emitPatch(parsePatch(TWO_HUNKS)!, selectAll)).toContain('@@ -10,2 +11,2 @@')
  })
})

describe('emitPatch for reverse apply — the mirrored unselected rules', () => {
  // A `git apply --reverse` target holds the POST-image: the working tree for a
  // discard, the index for an unstage. So an unselected addition is context
  // there (the target has it) and an unselected deletion is dropped (the
  // target never had it) — each the mirror of the forward rule above.
  const file = (): FilePatch => parsePatch(TWO_HUNKS)!

  it('an unselected + line becomes context, because the target has it', () => {
    // Roll back only `const b = 2`→`const b = 20`: `const c = 3` stays in the
    // working tree, so the patch has to show it as present.
    const out = emitPatch(file(), (h, l) => h === 0 && (l === 1 || l === 2), true)
    expect(out).toContain(' const c = 3')
    expect(out).not.toContain('+const c = 3')
  })

  it('an unselected - line is dropped, because the target never had it', () => {
    // The c insertion only, mirrored: `const b = 2` exists in neither the
    // working tree nor the index this patch reverse-applies to, so claiming
    // it as context would break the match. (The assertions end in a newline
    // because `const b = 2` is a prefix of the context line `const b = 20`.)
    const out = emitPatch(file(), (h, l) => h === 0 && l === 3, true)
    expect(out).toContain('+const c = 3')
    expect(out).toContain(' const b = 20\n')
    expect(out).not.toContain('const b = 2\n')
  })

  it('keeps the sign of a selected line, either way', () => {
    const out = emitPatch(file(), (h, l) => h === 0 && (l === 1 || l === 2), true)
    expect(out).toContain('-const b = 2')
    expect(out).toContain('+const b = 20')
  })

  it('recomputes the counts for the mirrored emission', () => {
    // Only the b edit, mirrored: context a + c + d (3) plus one del = old 4,
    // context plus one add = new 4.
    const out = emitPatch(file(), (h, l) => h === 0 && (l === 1 || l === 2), true)
    expect(out).toContain('@@ -1,4 +1,4 @@ export class Queue')
  })

  it('selecting everything still reproduces the input byte for byte', () => {
    expect(emitPatch(file(), selectAll, true)).toBe(TWO_HUNKS)
  })
})
