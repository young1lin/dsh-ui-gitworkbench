/**
 * The editable right column's decision core: when a fetched layer payload may
 * replace the editor buffer and when it must not, what a save's answer does to
 * the buffer's basis, what "dirty" means, and what any gesture that would drop
 * the buffer must ask first.
 *
 * The host's sha check is the hard wall between the editor and a concurrent
 * agent write; these rules are everything the UI does around that wall. The
 * one with teeth is {@link applySides}: a refresh that lands over a DIRTY
 * buffer keeps the buffer and only notes whether the file moved underneath —
 * the tree refreshes, the editor does not, which is what makes polling safe to
 * leave running while somebody is typing.
 *
 * Pure: no React, no CSS, no git. `tests/side-edit.test.ts` loads it directly.
 */

/**
 * `gitWorkbench/writeChecked`'s answer, mirrored from the host's `WriteResult`
 * (the client re-declares host shapes rather than importing the host module,
 * which pulls node and the RPC decorators).
 */
export interface WriteResult {
  readonly ok: boolean
  /** Present only on failure; `stale` is the sha refusal. */
  readonly failure?: string
  /** A sentence for the user; names the file on the stale path. */
  readonly error?: string
  /** The file's blob sha after a successful write, for the next save. */
  readonly sha?: string
}

/** What a fetched layer payload contributes to the editor's basis. */
export interface EditSides {
  readonly targetText: string
  readonly targetSha: string
}

/** The editable right column's whole state, minus transient banners. */
export interface EditState {
  /** Whether the right column is the editor at all (unstaged tab only). */
  readonly armed: boolean
  /** The editor's text — the only thing the user changes directly. */
  readonly buffer: string
  /** Blob sha the buffer is based on: `writeChecked`'s `expectedSha`. */
  readonly baseSha: string
  /** The text `baseSha` names; dirty is buffer against THIS, not the disk. */
  readonly baseText: string
  /** The file changed underneath (fresh targetSha !== baseSha) while dirty. */
  readonly conflict: boolean
}

/** Before the first arm: nothing editable, no basis, nothing conflicting. */
export const DISARMED: EditState = { armed: false, buffer: '', baseSha: '', baseText: '', conflict: false }

/**
 * Whether the buffer holds edits no save has landed yet.
 *
 * Dirty is measured against `baseText` — the text of the last save or load —
 * not against what a poll says the disk holds: the poll's view is a snapshot
 * old by up to one interval, and "the agent changed the file" is a different
 * question from "you have unsaved edits".
 */
export function isDirty(edit: EditState): boolean {
  return edit.armed && edit.buffer !== edit.baseText
}

/**
 * Whether the editor may hold this payload's text: it must carry no carriage
 * return.
 *
 * The HTML textarea value API normalises `\r\n` to `\n` the moment text
 * enters it, so an armed CRLF file (an `core.autocrlf=true` checkout, or
 * `eol=crlf`) would save ANY later edit with every line ending rewritten —
 * a whole-file diff the reader never asked for. The first cut declines the
 * edit rather than translate endings on the way out: the file stays viewable
 * and the block actions keep working (they act on git's diff, not on the
 * buffer); only the editor is withheld, with a notice saying why.
 */
export function editableSides(sides: EditSides): boolean {
  return !sides.targetText.includes('\r')
}

/** The adopt core: buffer and basis become the payload, conflict cleared. */
function adopt(armed: boolean, sides: EditSides): EditState {
  return { armed, buffer: sides.targetText, baseSha: sides.targetSha, baseText: sides.targetText, conflict: false }
}

/**
 * Arm the editor from the payload currently on screen: the buffer starts as
 * the working-tree text, and the first save is checked against its sha.
 * A payload {@link editableSides} refuses is handed back unchanged — the
 * caller shows the notice instead of an editor.
 */
export function armEdit(edit: EditState, sides: EditSides): EditState {
  return editableSides(sides) ? adopt(true, sides) : edit
}

/**
 * A fetched payload lands over the editor.
 *
 * Clean (or disarmed): adopt — the editor follows the file, so the drawer
 * keeps up with the agent exactly as it did before editing existed, and an
 * armed editor whose file turned CRLF underneath disarms with the payload
 * adopted (clean costs no edits, and an armed editor must never hold text
 * the textarea would normalise). Dirty: keep the buffer whatever the payload
 * says (a poll must never overwrite unsaved edits) and record whether the
 * file itself moved, which is what the reload-and-lose-edits banner keys on.
 * An index-only change (same targetSha) leaves the flag down: the diff moved,
 * the edited file did not.
 */
export function applySides(edit: EditState, sides: EditSides): EditState {
  if (!isDirty(edit)) {
    return adopt(edit.armed && editableSides(sides), sides)
  }
  return { ...edit, conflict: sides.targetSha !== edit.baseSha }
}

/**
 * The banner's reload action, on the user's explicit say-so: drop the edits
 * onto the fresh text with a clean, current basis — and disarmed when the
 * fresh text carries CRLF, for the same reason arming refuses it.
 */
export function reloadSides(edit: EditState, sides: EditSides): EditState {
  return adopt(editableSides(sides), sides)
}

/**
 * Another file or layer selected: the edit session belonged to what was on
 * screen, so the editor disarms and adopts the new payload from scratch.
 */
export function resetSides(edit: EditState, sides: EditSides): EditState {
  return adopt(false, sides)
}

/** The drawer-level unsaved-edits guard's state. */
export interface LeaveGuard {
  /** The pane's last dirty report — the pane is this flag's only writer. */
  readonly dirty: boolean
  /** Whether the unsaved-edits dialog is holding a deferred gesture. */
  readonly askOpen: boolean
}

/** No edits, no open ask: the guard at rest. */
export const LEAVE_GUARD_CLEAR: LeaveGuard = { dirty: false, askOpen: false }

/** What a gesture that would drop the editor's surface should do. */
export type LeaveGate = { readonly kind: 'run' } | { readonly kind: 'ask' } | { readonly kind: 'wait' }

/**
 * Decide a leave gesture — a layer tab, a file selection, the drawer's close,
 * a main-tab switch — against unsaved edits.
 *
 * `same` names a gesture whose target is what the pane already shows: the
 * already-active tab, the tree row of the file already rendered. Such a
 * gesture changes nothing the pane renders and discards nothing, so it runs
 * without asking — a dialog over it would promise "switching discards your
 * edits" and then discard nothing, and a Leave answer on it used to disarm
 * the guard entirely. For a real target: `run` acts now, `ask` opens the
 * unsaved-edits dialog (Stay keeps editing, Leave drops), `wait` does
 * nothing because an ask is already open — a second gesture waits on the
 * first's answer rather than stacking a dialog on it.
 */
export function gateLeave(guard: LeaveGuard, same: boolean): LeaveGate {
  if (same) return { kind: 'run' }
  if (!guard.dirty) return { kind: 'run' }
  return guard.askOpen ? { kind: 'wait' } : { kind: 'ask' }
}

/** An ask opened: the gesture is held for the dialog's answer. */
export function leaveAsked(guard: LeaveGuard): LeaveGuard {
  return { ...guard, askOpen: true }
}

/**
 * The dialog answered — Leave or Stay, both close the ask — and the dirty
 * flag is deliberately NOT touched.
 *
 * The pane is the flag's only writer: a genuine navigation routes through
 * `resetSides`, whose clean transition is what reports false, while a no-op
 * gesture leaves the pane armed and dirty and the guard correctly still
 * armed for the next one. Clearing the flag here — on the guess that "Leave
 * means the buffer went away" — is exactly what let a Leave confirmed on a
 * no-op gesture disarm the guard for every gesture after it.
 */
export function leaveAnswered(guard: LeaveGuard): LeaveGuard {
  return { ...guard, askOpen: false }
}

/** The pane reports its dirty flag — the one transition that writes it. */
export function paneDirtyReport(guard: LeaveGuard, dirty: boolean): LeaveGuard {
  return { ...guard, dirty }
}

/**
 * A successful `writeChecked`: the basis becomes the saved text and the sha
 * the host read back. The buffer is NOT touched — typing that landed while
 * the write was in flight stays dirty against the new basis, so it stays
 * visible as unsaved rather than being silently declared written.
 */
export function applySaveOk(edit: EditState, savedText: string, sha: string): EditState {
  return { ...edit, baseSha: sha, baseText: savedText, conflict: false }
}

/**
 * A refused save (`failure: 'stale'`): the buffer stands, the banner goes up.
 * The reload/overwrite the banner offers reads the fresh sha off the next
 * fetch, not off this refusal.
 */
export function markConflict(edit: EditState): EditState {
  return { ...edit, conflict: true }
}
