/**
 * The rules around "go to definition" that are not React.
 *
 * Three of them earn their own module because each one is a decision rather
 * than plumbing, and each is wrong in a way no type would catch.
 *
 * WHEN the jump may be offered. The seam queries the file on disk — its
 * request carries a path and a position and no text — so the drawer may only
 * ask about a buffer that IS the file on disk. That rules out the staged
 * layer (the index's content), the history and compare views (older commits),
 * and any buffer with unsaved edits, where a position names one symbol on
 * screen and a different one on disk. The blame gutter already withholds
 * itself while dirty for the same reason; this is that rule applied to a
 * question whose wrong answer is quieter and therefore worse.
 *
 * WHICH line numbering is in force. The protocol counts lines from zero and
 * the editor counts from one, so every crossing is a chance to be off by one
 * in code that looks correct. Both conversions live here and nowhere else.
 *
 * WHERE the reader was standing. A jump that cannot be undone is a trap in a
 * review: following a symbol out of the file you were reading loses your
 * place, and the place is the work. The stack below is what Alt+Left pops.
 *
 * @module @young1lin/dsh-ui-gitworkbench/client/jump-view
 */

import type { JumpTarget } from '../lsp-jump.ts'

/**
 * Whether the drawer may offer a jump from this buffer.
 *
 * `layer` is the diff layer the buffer belongs to; only the unstaged layer's
 * right-hand side is the working-tree file. The Files tab passes 'unstaged'
 * because that is what it reads.
 */
export function canJump(layer: string, dirty: boolean): boolean {
  return layer === 'unstaged' && !dirty
}

/** A protocol position: zero-based line, zero-based UTF-16 character. */
export interface ProtocolPosition {
  readonly line: number
  readonly character: number
}

/**
 * An editor coordinate on its way to the seam.
 *
 * @param editorLine - one-based line, as CodeMirror's `doc.line()` counts.
 * @param column - zero-based UTF-16 offset within the line. CodeMirror's
 *   document offsets are already UTF-16 code units, which is the same unit the
 *   protocol counts in, so this crosses unchanged.
 */
export function toProtocolPosition(editorLine: number, column: number): ProtocolPosition {
  return {
    line: Math.max(0, Math.trunc(editorLine) - 1),
    character: Math.max(0, Math.trunc(column)),
  }
}

/** A protocol line on its way back to the editor, as a one-based line. */
export function toEditorLine(protocolLine: number): number {
  return Math.max(1, Math.trunc(protocolLine) + 1)
}

/** Where the reader was before a jump, so Alt+Left can put them back. */
export interface JumpMark {
  /** Repository-relative path, as the tree lists it. */
  readonly path: string
  /** One-based line, the editor's own numbering. */
  readonly line: number
}

/**
 * How many places back the stack remembers.
 *
 * Deep enough that following a chain of definitions and walking all the way
 * back is possible, bounded because this lives in component state for as long
 * as the drawer is open and nothing else ever trims it.
 */
export const JUMP_STACK_CAP = 50

/**
 * Record where a jump started from.
 *
 * A jump that lands on the line it started from — a symbol whose definition is
 * its own declaration, which is what every `const x = …` looks like to a
 * server — is not somewhere to come back FROM, so it is not pushed. Without
 * that check the stack fills with entries that appear to do nothing when
 * popped, and a back button that does nothing reads as broken.
 */
export function pushJumpOrigin(
  stack: readonly JumpMark[],
  origin: JumpMark,
  landing: JumpMark,
): readonly JumpMark[] {
  if (origin.path === landing.path && origin.line === landing.line) return stack
  const next = [...stack, origin]
  return next.length > JUMP_STACK_CAP ? next.slice(next.length - JUMP_STACK_CAP) : next
}

/** The most recent origin and the stack without it; both null when empty. */
export function popJumpOrigin(
  stack: readonly JumpMark[],
): { readonly mark: JumpMark | null; readonly rest: readonly JumpMark[] } {
  if (stack.length === 0) return { mark: null, rest: stack }
  return { mark: stack[stack.length - 1] ?? null, rest: stack.slice(0, -1) }
}

/** Segments of a location kept when naming somewhere outside the repository. */
const OUTSIDE_SEGMENTS = 3

/**
 * A short, readable name for a definition this drawer cannot open.
 *
 * The full location is either an absolute path with the whole machine's
 * directory structure in front of it, or a synthetic URI like
 * `jdt://contents/rt.jar/java.lang/String.class`. Neither is worth a line of
 * the pane at full length, and the tail is the part that identifies it. The
 * scheme is kept for a non-file URI because "this is not a file on disk" is
 * exactly what a reader needs to understand about it.
 */
export function describeOutside(uri: string): string {
  if (uri === '') return ''
  let body = uri
  let scheme = ''
  const mark = uri.indexOf('://')
  if (mark !== -1) {
    scheme = uri.slice(0, mark)
    body = uri.slice(mark + 3)
  }
  try {
    body = decodeURIComponent(body)
  } catch {
    // Keep the raw text: an undecodable location still identifies itself.
  }
  const parts = body.split(/[\\/]/).filter(part => part !== '')
  const tail = parts.slice(-OUTSIDE_SEGMENTS).join('/')
  const elided = parts.length > OUTSIDE_SEGMENTS ? '…/' + tail : tail
  return scheme === '' || scheme === 'file' ? elided : scheme + ':' + elided
}

/**
 * The locale key naming what happened, or '' when the jump landed and the
 * pane simply moves.
 *
 * Silence about a missing language server is a rule about the RESTING state —
 * no button, no underline, no header hint, because that is the ordinary
 * condition of a stock dsh profile and a drawer that flagged it would be
 * reporting its own setup as broken. It is not a rule about answers: someone
 * who deliberately pressed the key is owed a sentence, and dead silence in
 * response to a keystroke reads as a bug in the feature rather than as its
 * absence.
 *
 * Written as a total switch so the compiler refuses a new outcome that nobody
 * gave words to.
 */
export function jumpNoticeKey(target: JumpTarget): string {
  switch (target.outcome) {
    case 'ok': return ''
    case 'none': return 'jumpNone'
    case 'outside': return 'jumpOutside'
    case 'unavailable': return 'jumpUnavailable'
    case 'unclaimed': return 'jumpUnclaimed'
    case 'error': return 'jumpFailed'
    default: {
      const unreachable: never = target.outcome
      return unreachable
    }
  }
}
