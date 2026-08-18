/**
 * A unified diff, parsed so that a SUBSET of it can be emitted back as a patch
 * `git apply` will accept.
 *
 * `diff-model.ts` already parses diffs, but for rendering: `parseRows` throws
 * the file headers away and keeps only line numbers from the hunk header, which
 * is everything a reader needs and nothing a patch needs. Re-emitting is the
 * whole point here, so this model keeps what that one drops.
 *
 * The rules for a partial selection are git's own, from `add -p`, and each one
 * is a statement about the file the patch will be applied to:
 *
 *   - a selected `+` line is emitted as `+` — it is being added;
 *   - an UNSELECTED `+` line is dropped entirely — it is not part of this
 *     patch, and the target does not have it;
 *   - a selected `-` line is emitted as `-` — it is being removed;
 *   - an UNSELECTED `-` line becomes CONTEXT — the target still has that line,
 *     and claiming otherwise makes the patch fail to apply.
 *
 * Those are the rules for a FORWARD apply, where the target holds the patch's
 * pre-image. A patch meant for `git apply --REVERSE` meets the target holding
 * the POST-image, so the unselected treatments mirror: an unselected `+` line
 * becomes context (the target has it) and an unselected `-` line is dropped
 * (the target does not). Confirmed against git itself: reverse-applying a
 * forward-style subset to a working tree that also holds another block's
 * unselected addition fails as "patch does not apply", because the dropped
 * line is missing from the post-image git is trying to match.
 *
 * Both counts are then recomputed from what was actually emitted. That
 * arithmetic is the reason this module exists as a tested unit: a wrong count
 * makes `git apply` fail as "corrupt patch", which tells the reader their diff
 * is broken, when the truth would have been "the file changed under you" —
 * the message the context check is there to produce.
 *
 * Pure: no React, no CSS, no git. `tests/patch-model.test.ts` loads it directly.
 *
 * @module @young1lin/dsh-ui-gitworkbench/patch-model
 */

/** One line of a hunk, with its marker stripped. */
export interface PatchLine {
  readonly kind: 'add' | 'del' | 'context' | 'nonewline'
  /** Line content without the leading marker. `nonewline` carries ''. */
  readonly text: string
}

/** One hunk, with the header numbers as the source stated them. */
export interface Hunk {
  readonly oldStart: number
  readonly oldCount: number
  readonly newStart: number
  readonly newCount: number
  /** Whatever followed the closing `@@`, kept verbatim (git puts the enclosing
   *  function there). Empty when the source had none. */
  readonly heading: string
  /** Whether the source wrote `@@ -1 @@` rather than `@@ -1,1 @@`. The unified
   *  format allows a count of 1 to be omitted and git's own output does omit
   *  it, so re-emitting the other spelling would make a full selection differ
   *  from its input for no reason. Only consulted when the emitted count is
   *  itself 1 — a count of 3 is never ambiguous. */
  readonly oldCountOmitted: boolean
  readonly newCountOmitted: boolean
  readonly lines: readonly PatchLine[]
}

/** One file's patch: the headers `git apply` needs, plus its hunks. */
export interface FilePatch {
  /** `diff --git` through `+++`, verbatim and in order. */
  readonly header: readonly string[]
  readonly hunks: readonly Hunk[]
  /** Whether the source text ended with a newline, so a round trip can too. */
  readonly trailingNewline: boolean
}

/**
 * Whether one changed line is part of the patch being built.
 * Called only for `add` and `del` lines; context is never optional.
 */
export type LineSelector = (hunkIndex: number, lineIndex: number) => boolean

/** Take the whole diff. */
export const selectAll: LineSelector = () => true
/** Take none of it — {@link emitPatch} then returns ''. */
export const selectNone: LineSelector = () => false

const HUNK_HEAD = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/

/**
 * Parse one file's unified diff.
 *
 * @param text - a single file's diff, as `git diff -- <path>` prints it.
 * @returns the parsed patch, or null when the text carries no hunk at all —
 *          an empty diff, or a binary one, which says `Binary files … differ`
 *          and cannot be applied line by line.
 */
export function parsePatch(text: string): FilePatch | null {
  if (text.length === 0) return null
  const lines = text.split('\n')
  const trailingNewline = lines.length > 0 && lines[lines.length - 1] === ''
  if (trailingNewline) lines.pop()

  const header: string[] = []
  const hunks: Hunk[] = []
  let current: { head: RegExpExecArray; lines: PatchLine[] } | null = null

  const close = (): void => {
    if (current === null) return
    const [, oldStart, oldCount, newStart, newCount, heading] = current.head
    hunks.push({
      oldStart: Number.parseInt(oldStart!, 10),
      // The unified format allows the count to be omitted when it is 1.
      oldCount: oldCount === undefined ? 1 : Number.parseInt(oldCount, 10),
      newStart: Number.parseInt(newStart!, 10),
      newCount: newCount === undefined ? 1 : Number.parseInt(newCount, 10),
      heading: heading ?? '',
      oldCountOmitted: oldCount === undefined,
      newCountOmitted: newCount === undefined,
      lines: current.lines,
    })
    current = null
  }

  for (const line of lines) {
    const head = HUNK_HEAD.exec(line)
    if (head !== null) {
      close()
      current = { head, lines: [] }
      continue
    }
    if (current === null) {
      header.push(line)
      continue
    }
    if (line.startsWith('\\')) current.lines.push({ kind: 'nonewline', text: '' })
    else if (line.startsWith('+')) current.lines.push({ kind: 'add', text: line.slice(1) })
    else if (line.startsWith('-')) current.lines.push({ kind: 'del', text: line.slice(1) })
    // A context line is ' ' plus content, but git emits a BARE empty line for
    // an empty one; slicing that would be harmless and reading it as anything
    // else would drop the line.
    else current.lines.push({ kind: 'context', text: line.startsWith(' ') ? line.slice(1) : line })
  }
  close()

  if (hunks.length === 0) return null
  return { header, hunks, trailingNewline }
}

/** Spell a count the way the source spelled it, when that is unambiguous. */
function count(value: number, omitted: boolean): string {
  return value === 1 && omitted ? '' : `,${value}`
}

interface Emitted {
  readonly lines: readonly string[]
  readonly oldCount: number
  readonly newCount: number
  readonly changed: boolean
}

/** Apply the selection rules to one hunk's lines. */
function emitHunkLines(hunk: Hunk, hunkIndex: number, isSelected: LineSelector, reverseApply: boolean): Emitted {
  const out: string[] = []
  let oldCount = 0
  let newCount = 0
  let changed = false
  // Whether the line the next `\ No newline` marker would describe survived.
  let lastKept = false

  hunk.lines.forEach((line, lineIndex) => {
    if (line.kind === 'nonewline') {
      // The marker describes the line before it. Emitting it after a line that
      // is no longer in the patch makes git read it as describing a different
      // line entirely.
      if (lastKept) out.push('\\ No newline at end of file')
      return
    }
    if (line.kind === 'context') {
      out.push(` ${line.text}`)
      oldCount += 1
      newCount += 1
      lastKept = true
      return
    }
    const selected = isSelected(hunkIndex, lineIndex)
    if (line.kind === 'add') {
      // Forward apply: the target does not have an unselected addition, so it
      // is not part of this patch. Reverse apply: the target DOES have it — it
      // holds the post-image — so it has to be context or the patch will not
      // match.
      if (!selected && !reverseApply) { lastKept = false; return }
      if (!selected) {
        out.push(` ${line.text}`)
        oldCount += 1
        newCount += 1
        lastKept = true
        return
      }
      out.push(`+${line.text}`)
      newCount += 1
      changed = true
      lastKept = true
      return
    }
    // A deletion that is not part of this patch still EXISTS in a forward
    // apply's target (the pre-image), so it is presented as context. A reverse
    // apply's target never had it, so it is dropped instead.
    if (!selected) {
      if (reverseApply) { lastKept = false; return }
      out.push(` ${line.text}`)
      oldCount += 1
      newCount += 1
      lastKept = true
      return
    }
    out.push(`-${line.text}`)
    oldCount += 1
    changed = true
    lastKept = true
  })

  return { lines: out, oldCount, newCount, changed }
}

/**
 * Emit the selected part of a patch as text `git apply` will accept.
 *
 * A hunk with nothing selected is dropped whole: a hunk of pure context is
 * valid but pointless, and a patch of nothing but such hunks is a no-op git
 * would still report as applied.
 *
 * The new-side start of each hunk is recomputed by how much the hunks BEFORE
 * it (in this patch) actually shift the file. Taking one of two added lines
 * moves everything after it by one, and a header that still claims the
 * original offset describes a file that will not exist.
 *
 * @param file - a parsed patch.
 * @param isSelected - which changed lines to take.
 * @param reverseApply - emit for `git apply --reverse`, whose target holds the
 *          patch's POST-image rather than its pre-image: unselected additions
 *          become context and unselected deletions are dropped (the mirror of
 *          the forward rules). Selected lines keep their sign either way.
 * @returns the patch text, or '' when the selection is empty. The caller must
 *          treat '' as "nothing to do" and make no git call: a patch with no
 *          hunks is an error to `git apply`, not a no-op.
 */
export function emitPatch(file: FilePatch, isSelected: LineSelector, reverseApply = false): string {
  const body: string[] = []
  // Set from the first hunk that survives, so a patch starting at hunk 2 keeps
  // that hunk's own offset rather than inheriting one from hunks left out.
  let delta: number | null = null

  file.hunks.forEach((hunk, hunkIndex) => {
    const emitted = emitHunkLines(hunk, hunkIndex, isSelected, reverseApply)
    if (!emitted.changed) return
    if (delta === null) delta = hunk.newStart - hunk.oldStart
    const newStart = hunk.oldStart + delta
    const old = count(emitted.oldCount, hunk.oldCountOmitted)
    const fresh = count(emitted.newCount, hunk.newCountOmitted)
    body.push(`@@ -${hunk.oldStart}${old} +${newStart}${fresh} @@${hunk.heading}`)
    body.push(...emitted.lines)
    delta += emitted.newCount - emitted.oldCount
  })

  if (body.length === 0) return ''
  const text = [...file.header, ...body].join('\n')
  return file.trailingNewline ? `${text}\n` : text
}
