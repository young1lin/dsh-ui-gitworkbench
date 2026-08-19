/**
 * `git blame --line-porcelain`, parsed into one record per line.
 *
 * Porcelain is the only blame format worth parsing: the human format packs
 * author, date and code into fixed-width columns that shift with the longest
 * name in the file, and reading it back means guessing where the columns are.
 * The porcelain repeats a full header for every line — verbose on the wire,
 * unambiguous to read.
 *
 * A line nobody has committed yet gets the all-zero sha and git's own English
 * "Not Committed Yet" as its author. That flag is reported separately so the
 * drawer can say it in the reader's language rather than passing git's string
 * through untranslated.
 *
 * Pure: no node, no git, no React. `tests/blame.test.ts` loads it directly.
 *
 * @module @young1lin/dsh-ui-gitworkbench/blame
 */

/** One line's provenance. Every field is JSON-safe and always present. */
export interface BlameLine {
  /** Full commit sha; all zeros for a line not committed yet. */
  readonly hash: string
  readonly author: string
  /** Author time, unix seconds. 0 when git did not say. */
  readonly time: number
  /** The commit's subject line; '' when git did not say. */
  readonly summary: string
  /** Whether this line has no commit behind it yet. */
  readonly uncommitted: boolean
}

/** A header line: sha, line in the original, line in the final file, [count]. */
const ENTRY = /^([0-9a-f]{40}) (\d+) (\d+)(?: (\d+))?$/

const ZERO_SHA = '0'.repeat(40)

/**
 * Parse blame porcelain into per-line records, indexed by final line number.
 *
 * @param text - stdout of `git blame --line-porcelain -- <path>`.
 * @returns one entry per line of the file, in file order. Gaps cannot happen
 *          in well-formed output, but a truncated stream yields a shorter
 *          array rather than a hole — the caller renders what it has.
 */
export function parseBlame(text: string): BlameLine[] {
  if (text.length === 0) return []
  const byLine = new Map<number, BlameLine>()
  let line = 0
  let hash = ''
  let author = ''
  let time = 0
  let summary = ''

  for (const raw of text.split('\n')) {
    const head = ENTRY.exec(raw)
    if (head !== null) {
      hash = head[1]!
      line = Number.parseInt(head[3]!, 10)
      // Each entry restates its own fields; carrying the previous line's over
      // would attribute a line to whatever came before it in the stream.
      author = ''
      time = 0
      summary = ''
      continue
    }
    if (raw.startsWith('author ')) { author = raw.slice(7); continue }
    if (raw.startsWith('author-time ')) {
      const parsed = Number.parseInt(raw.slice(12), 10)
      time = Number.isFinite(parsed) ? parsed : 0
      continue
    }
    if (raw.startsWith('summary ')) { summary = raw.slice(8); continue }
    // The content line, which closes the entry. Its text is the file's own and
    // the drawer already has it, so only the provenance is kept.
    if (raw.startsWith('\t') && line > 0) {
      byLine.set(line, {
        hash,
        author,
        time,
        summary,
        uncommitted: hash === ZERO_SHA,
      })
      line = 0
    }
  }

  const highest = byLine.size === 0 ? 0 : Math.max(...byLine.keys())
  const out: BlameLine[] = []
  for (let at = 1; at <= highest; at += 1) {
    out.push(byLine.get(at) ?? { hash: '', author: '', time: 0, summary: '', uncommitted: false })
  }
  return out
}
