/**
 * The editable right column's decision core, without React: when a fetched
 * layer payload may replace the editor buffer and when it must not, what a
 * save's answer does to the buffer's basis, and what "dirty" means.
 *
 * These are the rules that keep an editor from clobbering a concurrent agent
 * write client-side (the host's sha check is the hard wall; these decide what
 * the UI does around it), so they live in a module vitest can load directly —
 * the same split as `side-rows.ts`.
 */
import { describe, expect, it } from 'vitest'

import { armRefusal,
  DISARMED, LEAVE_GUARD_CLEAR, applySaveOk, applySides, armEdit, editableSides, gateLeave,
  isDirty, leaveAnswered, leaveAsked, markConflict, paneDirtyReport, reloadSides, resetSides,
} from '../src/client/side-edit.ts'

const SIDES_V1 = { targetText: 'one\ntwo\n', targetSha: 'sha-v1', binary: false, tooLarge: false } as const
const SIDES_V2 = { targetText: 'one\nTWO\n', targetSha: 'sha-v2', binary: false, tooLarge: false } as const

describe('isDirty', () => {
  it('is false while disarmed however the buffer reads', () => {
    expect(isDirty({ ...DISARMED, buffer: 'anything', baseText: 'other' })).toBe(false)
  })

  it('is armed-and-different, not armed alone', () => {
    const armed = { ...DISARMED, armed: true, buffer: 'one\ntwo\n', baseText: 'one\ntwo\n' }
    expect(isDirty(armed)).toBe(false)
    expect(isDirty({ ...armed, buffer: 'one\nTWO\n' })).toBe(true)
  })
})

describe('armEdit', () => {
  it('starts from the fetched working-tree text and its sha', () => {
    const edit = armEdit(DISARMED, SIDES_V1)
    expect(edit).toMatchObject({ armed: true, buffer: 'one\ntwo\n', baseText: 'one\ntwo\n', baseSha: 'sha-v1', conflict: false })
  })
})

describe('applySides — a refresh lands', () => {
  it('adopts the fresh text while the buffer is clean', () => {
    const clean = armEdit(DISARMED, SIDES_V1)
    const next = applySides(clean, SIDES_V2)
    expect(next).toMatchObject({ buffer: 'one\nTWO\n', baseText: 'one\nTWO\n', baseSha: 'sha-v2', conflict: false })
  })

  it('never overwrites a dirty buffer, and flags the change underneath it', () => {
    const dirty = { ...armEdit(DISARMED, SIDES_V1), buffer: 'my edit\n' }
    const next = applySides(dirty, SIDES_V2)
    // Rule 3: the tree refreshes, the editor buffer does not.
    expect(next.buffer).toBe('my edit\n')
    expect(next.baseSha).toBe('sha-v1')
    expect(next.conflict).toBe(true)
  })

  it('keeps the dirty buffer quiet when the file itself has not moved', () => {
    const dirty = { ...armEdit(DISARMED, SIDES_V1), buffer: 'my edit\n' }
    // Same targetSha back: an index-only change (the agent staged something)
    // moves the diff but not the working-tree file the editor holds.
    const next = applySides(dirty, { ...SIDES_V1, targetText: 'one\ntwo\n' })
    expect(next.buffer).toBe('my edit\n')
    expect(next.conflict).toBe(false)
  })

  it('treats a vanished file (targetSha "") as a change underneath a dirty buffer', () => {
    const dirty = { ...armEdit(DISARMED, SIDES_V1), buffer: 'my edit\n' }
    expect(applySides(dirty, { ...SIDES_V1, targetText: '', targetSha: '' }).conflict).toBe(true)
  })

  it('tracks every payload while disarmed', () => {
    expect(applySides(DISARMED, SIDES_V2)).toMatchObject({ buffer: 'one\nTWO\n', baseSha: 'sha-v2', armed: false })
  })
})

describe('reloadSides — the banner reload action', () => {
  it('drops the edits onto the fresh text and keeps the editor open', () => {
    const dirty = { ...armEdit(DISARMED, SIDES_V1), buffer: 'my edit\n', conflict: true }
    const next = reloadSides(dirty, SIDES_V2)
    expect(next).toMatchObject({ armed: true, buffer: 'one\nTWO\n', baseText: 'one\nTWO\n', baseSha: 'sha-v2', conflict: false })
  })
})

describe('resetSides — another file or layer', () => {
  it('disarms and adopts, whatever the buffer held', () => {
    const dirty = { ...armEdit(DISARMED, SIDES_V1), buffer: 'my edit\n', conflict: true }
    const next = resetSides(dirty, SIDES_V2)
    expect(next).toMatchObject({ armed: false, buffer: 'one\nTWO\n', baseText: 'one\nTWO\n', baseSha: 'sha-v2', conflict: false })
  })
})

describe('applySaveOk — a successful writeChecked', () => {
  it('re-bases onto the returned sha and the saved text', () => {
    const dirty = { ...armEdit(DISARMED, SIDES_V1), buffer: 'my edit\n' }
    const next = applySaveOk(dirty, 'my edit\n', 'sha-written')
    expect(next).toMatchObject({ buffer: 'my edit\n', baseText: 'my edit\n', baseSha: 'sha-written', conflict: false })
    expect(isDirty(next)).toBe(false)
  })

  it('leaves typing done during the in-flight save dirty', () => {
    const dirty = { ...armEdit(DISARMED, SIDES_V1), buffer: 'my edit\n' }
    // The buffer moved on while the write was in flight; the basis is the
    // text that was actually saved, so the newer keys stay unsaved.
    const next = applySaveOk(dirty, 'my edit\n', 'sha-written')
    const typing = { ...next, buffer: 'my edit\nmore\n' }
    expect(isDirty(typing)).toBe(true)
  })

  it('clears a standing conflict: the basis is now what the host just wrote', () => {
    const conflicted = { ...armEdit(DISARMED, SIDES_V1), buffer: 'my edit\n', conflict: true }
    expect(applySaveOk(conflicted, 'my edit\n', 'sha-written').conflict).toBe(false)
  })
})

describe('markConflict — a refused (stale) save', () => {
  it('raises the banner flag without touching the buffer', () => {
    const dirty = { ...armEdit(DISARMED, SIDES_V1), buffer: 'my edit\n' }
    const next = markConflict(dirty)
    expect(next.buffer).toBe('my edit\n')
    expect(next.conflict).toBe(true)
  })
})

describe('editableSides — the CRLF gate', () => {
  it('refuses a payload whose text carries any carriage return', () => {
    // The textarea value API normalises \r\n to \n on entry, so arming a CRLF
    // file would make the NEXT save rewrite every line ending — the gate
    // declines the edit rather than translate endings on the way out.
    expect(editableSides({ ...SIDES_V1, targetText: 'one\r\ntwo\r\n' })).toBe(false)
    expect(editableSides({ ...SIDES_V1, targetText: 'a\rb' })).toBe(false)
  })

  it('allows LF text and an absent file', () => {
    expect(editableSides(SIDES_V1)).toBe(true)
    expect(editableSides({ ...SIDES_V1, targetText: '', targetSha: '' })).toBe(true)
  })

  it('is what armEdit refuses on: the state is handed back unchanged', () => {
    const crlf = { ...SIDES_V1, targetText: 'one\r\ntwo\r\n' }
    expect(armEdit(DISARMED, crlf)).toBe(DISARMED)
    // And an armed editor stays exactly as it was — no buffer swap.
    const armed = armEdit(DISARMED, SIDES_V1)
    expect(armEdit(armed, crlf)).toBe(armed)
  })

  it('disarms a clean armed editor whose file turned CRLF underneath', () => {
    // The poll adopts while clean; a file rewritten with CRLF since must not
    // leave an armed editor holding text the textarea would normalise.
    const armed = armEdit(DISARMED, SIDES_V1)
    const next = applySides(armed, { ...SIDES_V1, targetText: 'one\r\ntwo\r\n', targetSha: 'sha-crlf' })
    expect(next).toMatchObject({ armed: false, buffer: 'one\r\ntwo\r\n', baseSha: 'sha-crlf', conflict: false })
  })

  it('disarms on reload into CRLF content, and still adopts the text', () => {
    const dirty = { ...armEdit(DISARMED, SIDES_V1), buffer: 'my edit\n', conflict: true }
    const next = reloadSides(dirty, { ...SIDES_V1, targetText: 'one\r\n', targetSha: 'sha-crlf' })
    expect(next).toMatchObject({ armed: false, buffer: 'one\r\n', baseSha: 'sha-crlf', conflict: false })
  })

  it('still keeps a dirty buffer over a CRLF refresh — the save refuses anyway', () => {
    // Dirty never adopts; the CRLF file underneath shows up as a conflict,
    // and the host's sha check is what stops the write, not this gate.
    const dirty = { ...armEdit(DISARMED, SIDES_V1), buffer: 'my edit\n' }
    const next = applySides(dirty, { ...SIDES_V1, targetText: 'one\r\n', targetSha: 'sha-crlf' })
    expect(next.buffer).toBe('my edit\n')
    expect(next.armed).toBe(true)
    expect(next.conflict).toBe(true)
  })
})

describe('gateLeave — what a leave gesture does with unsaved edits', () => {
  // The layer-tab guard and the drawer-level guards (file selection, close,
  // main tab) all ask through the same dialog; this is the one decision they
  // share, lifted where vitest can drive it.
  it('runs the gesture when the buffer is clean', () => {
    expect(gateLeave(LEAVE_GUARD_CLEAR, false)).toEqual({ kind: 'run' })
    expect(gateLeave({ dirty: false, askOpen: true }, false)).toEqual({ kind: 'run' })
  })

  it('asks first when there are unsaved edits', () => {
    expect(gateLeave({ dirty: true, askOpen: false }, false)).toEqual({ kind: 'ask' })
  })

  it('waits when an ask is already open — gestures do not stack on it', () => {
    expect(gateLeave({ dirty: true, askOpen: true }, false)).toEqual({ kind: 'wait' })
  })

  it('runs a gesture whose target is what the pane already shows, without asking', () => {
    // The already-active tab, the tree row of the file already rendered:
    // such a gesture discards nothing, and a dialog promising "switching
    // discards your edits" over it would be promising a lie.
    expect(gateLeave({ dirty: true, askOpen: false }, true)).toEqual({ kind: 'run' })
    expect(gateLeave({ dirty: true, askOpen: true }, true)).toEqual({ kind: 'run' })
  })
})

describe('leaveAnswered — the dialog answered, Leave or Stay', () => {
  it('closes the ask and does not touch the dirty flag', () => {
    // The pane is the flag's only writer. Clearing it here — on the guess
    // that "Leave means the buffer went away" — is what let a Leave on a
    // no-op gesture (the dialog ran, the navigation was a no-op, the pane
    // stayed armed and dirty) disarm the guard for every later gesture.
    expect(leaveAnswered({ dirty: true, askOpen: true })).toEqual({ dirty: true, askOpen: false })
    expect(leaveAnswered({ dirty: false, askOpen: true })).toEqual({ dirty: false, askOpen: false })
  })

  it('keeps the guard armed after a Leave on a no-op gesture', () => {
    // The round-2 regression, stated as the sequence: dirty buffer, a
    // no-op gesture runs (no dialog), a DIFFERENT gesture still asks.
    const dirty = paneDirtyReport(LEAVE_GUARD_CLEAR, true)
    expect(gateLeave(dirty, true)).toEqual({ kind: 'run' })
    expect(gateLeave(leaveAnswered(leaveAsked(dirty)), false)).toEqual({ kind: 'ask' })
  })

  it('clears only when the pane itself reports clean', () => {
    // A genuine navigation resets the pane (resetSides), whose clean
    // transition is the report that opens the guard again.
    const navigated = paneDirtyReport(leaveAnswered(leaveAsked(paneDirtyReport(LEAVE_GUARD_CLEAR, true))), false)
    expect(navigated).toEqual({ dirty: false, askOpen: false })
    expect(gateLeave(navigated, false)).toEqual({ kind: 'run' })
  })

  it('leaveAsked opens the ask; paneDirtyReport reports without closing one', () => {
    expect(leaveAsked({ dirty: true, askOpen: false })).toEqual({ dirty: true, askOpen: true })
    expect(paneDirtyReport({ dirty: true, askOpen: true }, true)).toEqual({ dirty: true, askOpen: true })
  })
})

describe('armRefusal — why the editor is withheld', () => {
  it('lets a plain UTF-8, LF payload arm', () => {
    expect(armRefusal({ targetText: 'a\nb\n', targetSha: 'x' })).toBeNull()
    expect(editableSides({ targetText: 'a\nb\n', targetSha: 'x' })).toBe(true)
  })

  it('names the encoding when the host says the file is not UTF-8', () => {
    // The corruption case: the text on screen is a lossy decode, so saving it
    // back would replace every non-ASCII byte in the file.
    const sides = { targetText: 'package main\n// ��\n', targetSha: 'x', lossyEncoding: true }
    expect(armRefusal(sides)).toBe('encoding')
    expect(editableSides(sides)).toBe(false)
  })

  it('names CRLF when the text carries carriage returns', () => {
    expect(armRefusal({ targetText: 'a\r\nb\r\n', targetSha: 'x' })).toBe('crlf')
  })

  it('reports the encoding first when a file is both', () => {
    // One sentence for two causes leaves the reader wondering whether
    // converting line endings would help; for this file nothing would.
    expect(armRefusal({ targetText: 'a\r\n', targetSha: 'x', lossyEncoding: true })).toBe('encoding')
  })

  it('treats a payload without the flag as fine, for an older host half', () => {
    expect(armRefusal({ targetText: 'a\n', targetSha: 'x' })).toBeNull()
    expect(armRefusal({ targetText: 'a\n', targetSha: 'x', lossyEncoding: false })).toBeNull()
  })
})
