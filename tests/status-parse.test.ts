/**
 * Read-side porcelain parsing, moved out of index.ts into git-ops.ts so
 * vitest can load it (index.ts imports its dsh peers as VALUES, which only
 * resolve inside a web profile). The payloads below are the fixture
 * catalog's shapes (TESTS.md A/G/H, WORKTREES.md) — synthetic strings, not a
 * live repository, because parsing is decidable from text alone.
 */
import { describe, expect, it } from 'vitest'
import {
  capBranches, clipDiff, countBufferLines, isBinaryPrefix, isNoMergeBaseError,
  parseNumstat, parseStatus,
} from '../src/git-ops.ts'

/** numstat an untracked-only payload would arrive with: nothing to count. */
const noCounts = new Map<string, { added: number; deleted: number; binary: boolean }>()

describe('parseStatus', () => {
  it('maps the XY alphabet onto the five statuses', () => {
    // One line per shape the fixture rows plant (TESTS.md A1): index column,
    // worktree column, untracked, and the rename arrow.
    const files = parseStatus([
      '## main...origin/main',
      'M  staged-only.ts',
      ' M unstaged-only.ts',
      'A  added.ts',
      'D  deleted.ts',
      'R  old-name.ts -> new-name.ts',
      '?? untracked.txt',
    ].join('\n'), noCounts)
    expect(files.map(file => file.status)).toEqual([
      'modified', 'modified', 'added', 'deleted', 'renamed', 'untracked',
    ])
  })

  it('splits staged from unstaged, and both at once for MM', () => {
    // A tick is a git call: which side a file's change is on decides whether
    // the tick is on, off, or half (TESTS.md A2).
    const files = parseStatus([
      'M  staged-only.ts',
      ' M unstaged-only.ts',
      'MM staged-then-edited.ts',
      '?? never-added.txt',
    ].join('\n'), noCounts)
    expect(files.map(file => [file.staged, file.unstaged])).toEqual([
      [true, false],
      [false, true],
      [true, true],
      [false, true],
    ])
  })

  it('reads every conflict pair as unstaged work, never as staged', () => {
    // All seven XY states the conflict worktrees plant (AA/DU/UD in
    // fixture-conflict-2; AU/UA/DD plus AA in fixture-conflict-3). Every one
    // of them HAS an index entry, so reading the X column would offer to
    // commit conflict markers (TESTS.md A3).
    for (const xy of ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']) {
      const [file] = parseStatus([`${xy} conflicted.txt`].join('\n'), noCounts)
      expect(file, xy).toMatchObject({ path: 'conflicted.txt', staged: false, unstaged: true })
    }
  })

  it('keeps a typechange row as a modified file', () => {
    // File became a symlink (index mode 120000): porcelain prints T. The tree
    // must not choke on the letter (TESTS.md A4).
    const [file] = parseStatus(['TM docs/ops-runbook.md'].join('\n'), noCounts)
    expect(file).toMatchObject({ path: 'docs/ops-runbook.md', status: 'modified', staged: true, unstaged: true })
  })

  it('carries the previous path of a rename with edits', () => {
    // `RM` + the arrow: staged rename, then edited again. numstat reports
    // renames under the NEW path (its own arrow form) — the keys must agree
    // or the counts silently vanish (TESTS.md A10).
    const numstat = parseNumstat(['3\t1\tsrc/scheduler.ts -> src/scheduler-v2.ts'].join('\n'))
    const [file] = parseStatus(['RM src/scheduler.ts -> src/scheduler-v2.ts'].join('\n'), numstat)
    expect(file).toMatchObject({
      path: 'src/scheduler-v2.ts', previousPath: 'src/scheduler.ts', status: 'renamed',
      addedLines: 3, deletedLines: 1,
    })
  })

  it('keeps a zero-similarity replacement as separate delete and add', () => {
    // Below the rename threshold git reports D + A, not R — the drawer shows
    // exactly what git says (TESTS.md A10).
    const files = parseStatus([
      'D  docs/migration-guide.md',
      'A  docs/replacement-notes.md',
    ].join('\n'), noCounts)
    expect(files).toEqual([
      expect.objectContaining({ path: 'docs/migration-guide.md', status: 'deleted' }),
      expect.objectContaining({ path: 'docs/replacement-notes.md', status: 'added' }),
    ])
    expect(files.every(file => file.previousPath === undefined)).toBe(true)
  })

  it('reads a raw CJK path through, as quotepath=false delivers it', () => {
    // The host sets core.quotepath=false on every git call; what arrives is
    // raw UTF-8, and what the drawer shows must be the same characters the
    // filesystem has (TESTS.md A12 / G1).
    const files = parseStatus([
      ' M src/调度器.ts',
      '?? 文档/说明.md',
    ].join('\n'), noCounts)
    expect(files.map(file => file.path)).toEqual(['src/调度器.ts', '文档/说明.md'])
  })

  it('unquotes and unescapes a path git still wraps in quotes', () => {
    // Control characters and quotes stay quoted even with quotepath off, and
    // git's escapes there are JSON's — so the decoder is JSON.parse.
    const [file] = parseStatus(['?? "weird \\"name\\".txt"'].join('\n'), noCounts)
    expect(file?.path).toBe('weird "name".txt')
  })

  it('leaves untracked counts at zero until the synthesis pass fills them', () => {
    // numstat never mentions untracked files; their numbers come from a
    // direct file read later, not from this parse.
    const [file] = parseStatus(['?? late-counted.log'].join('\n'), noCounts)
    expect(file).toMatchObject({ path: 'late-counted.log', addedLines: 0, deletedLines: 0, binary: false })
  })
})

describe('parseNumstat', () => {
  it('marks a dashed count as binary — real binaries and -diff attributes alike', () => {
    // `logo.png` is binary by content; `demo.binlike` is text that an
    // attribute declares -diff. numstat prints `-` for both, and both must
    // render as binary in the tree (TESTS.md A9 / G5).
    const counts = parseNumstat([
      '-\t-\tassets/banner.png',
      '-\t-\tdemo.binlike',
    ].join('\n'))
    expect(counts.get('assets/banner.png')).toEqual({ added: 0, deleted: 0, binary: true })
    expect(counts.get('demo.binlike')).toEqual({ added: 0, deleted: 0, binary: true })
  })

  it('keeps a tab inside a path whole', () => {
    // Paths may legally contain tabs (not on Windows, but the parse must not
    // eat them); only the first two tabs are columns.
    const counts = parseNumstat(['1\t2\tbefore\tafter.txt'].join('\n'))
    expect(counts.get('before\tafter.txt')).toEqual({ added: 1, deleted: 2, binary: false })
  })
})

describe('isBinaryPrefix', () => {
  it('calls UTF-16 text binary — every ASCII byte rides with a NUL', () => {
    // data-utf16.txt is the trap: it IS text, but the sniff is right to
    // refuse it — diffing it as text shows mojibake (TESTS.md A9). The NULs
    // come from the ASCII half of UTF-16 (and from every 0A 00 newline).
    expect(isBinaryPrefix(Buffer.from('metrics report\nv2\n', 'utf16le'), 8_000)).toBe(true)
  })
  it('decides only inside the window', () => {
    // A NUL at byte 8000 with an 8000-byte window is past it; a text file
    // may legitimately contain one deep in its body.
    expect(isBinaryPrefix(Buffer.concat([Buffer.alloc(8_000, 0x61), Buffer.from([0])]), 8_000)).toBe(false)
    expect(isBinaryPrefix(Buffer.concat([Buffer.alloc(7_999, 0x61), Buffer.from([0])]), 8_000)).toBe(true)
  })
  it('calls an empty or plain-text buffer not binary', () => {
    expect(isBinaryPrefix(Buffer.alloc(0), 8_000)).toBe(false)
    expect(isBinaryPrefix(Buffer.from('plain text\nwith lines\n'), 8_000)).toBe(false)
  })
})

describe('countBufferLines', () => {
  it('counts a final unterminated line, and not a trailing newline', () => {
    expect(countBufferLines(Buffer.from(''))).toBe(0)
    expect(countBufferLines(Buffer.from('a\n'))).toBe(1)
    expect(countBufferLines(Buffer.from('a\nb'))).toBe(2)
    expect(countBufferLines(Buffer.from('a\nb\n'))).toBe(2)
  })
})

describe('clipDiff', () => {
  it('clips past the cap and says so; at or under the cap it does nothing', () => {
    // A silently shortened diff reads as a complete one — the marker is the
    // whole point (TESTS.md H1: a 600KB ten-k.txt against a 400k cap).
    const marker = '…[diff truncated]'
    expect(clipDiff('x'.repeat(100), 100, marker)).toBe('x'.repeat(100))
    expect(clipDiff('x'.repeat(101), 100, marker)).toBe(`${'x'.repeat(100)}\n${marker}`)
  })
})

describe('capBranches', () => {
  it('reports the cut instead of quietly showing a short list', () => {
    // 510 branches against BRANCH_LIST_CAP=500 must surface
    // branchesTruncated, or the picker looks like the repository ran out of
    // branches (TESTS.md F5).
    const four = ['a', 'b', 'c', 'd']
    expect(capBranches(four.slice(0, 3), 3)).toEqual({ branches: ['a', 'b', 'c'], branchesTruncated: false })
    expect(capBranches(four, 3)).toEqual({ branches: ['a', 'b', 'c'], branchesTruncated: true })
    expect(capBranches(four, 3).branches).toHaveLength(3)
  })
})

describe('isNoMergeBaseError', () => {
  it('matches git\'s refusal for unrelated histories and nothing else', () => {
    // The real text, captured from the fixture's unrelated row; it is the
    // cue to retry a compare as a plain two-tip diff (TESTS.md C3).
    expect(isNoMergeBaseError('fatal: main...unrelated/base: no merge base')).toBe(true)
    expect(isNoMergeBaseError('fatal: bad revision \'nope\'')).toBe(false)
  })
})
