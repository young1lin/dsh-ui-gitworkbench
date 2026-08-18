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

import {
  DISARMED, applySaveOk, applySides, armEdit, isDirty, markConflict, reloadSides, resetSides,
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
