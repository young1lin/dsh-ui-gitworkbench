import { describe, expect, it } from 'vitest'

import { imageSourceFor, imageSourceKey } from '../src/client/image-source.ts'

describe('imageSourceFor', () => {
  it('changes: a present file is read from the working tree', () => {
    for (const status of ['added', 'modified', 'renamed', 'untracked'] as const) {
      expect(imageSourceFor('changes', status, null, [], '', ''), status).toEqual({ kind: 'worktree' })
    }
  })

  it('changes: a deleted file is the one HEAD still holds', () => {
    // The working tree has nothing under that name any more; what the reader
    // is looking at in the tree is the picture being removed.
    expect(imageSourceFor('changes', 'deleted', null, [], '', '')).toEqual({ kind: 'rev', rev: 'HEAD' })
  })

  it('history: a file is read at the selected commit', () => {
    expect(imageSourceFor('history', 'modified', 'abc1234', ['9999999'], '', ''))
      .toEqual({ kind: 'rev', rev: 'abc1234' })
  })

  it('history: a deleted file is read at the first parent', () => {
    // `<hash>^` is not a ref name the host accepts (no `^` in its alphabet),
    // so the parent comes from the commit the drawer already holds.
    expect(imageSourceFor('history', 'deleted', 'abc1234', ['9999999', '8888888'], '', ''))
      .toEqual({ kind: 'rev', rev: '9999999' })
  })

  it('history: nothing to ask without a commit, or a deletion without a parent', () => {
    expect(imageSourceFor('history', 'modified', null, [], '', '')).toBeNull()
    // A root commit deleting a file cannot happen, but a pre-0.1.4 host half
    // sends no parents at all — then there is no rev to name, and no picture.
    expect(imageSourceFor('history', 'deleted', 'abc1234', [], '', '')).toBeNull()
  })

  it('compare: the head ref’s copy, or the base’s when head deleted it', () => {
    expect(imageSourceFor('compare', 'added', null, [], 'main', 'feature'))
      .toEqual({ kind: 'rev', rev: 'feature' })
    expect(imageSourceFor('compare', 'deleted', null, [], 'main', 'feature'))
      .toEqual({ kind: 'rev', rev: 'main' })
  })

  it('compare: nothing to ask while an end is unpicked', () => {
    expect(imageSourceFor('compare', 'modified', null, [], '', 'feature')).toBeNull()
    expect(imageSourceFor('compare', 'modified', null, [], 'main', '')).toBeNull()
  })
})

describe('imageSourceKey', () => {
  it('names the source so a change of commit refetches and a re-render does not', () => {
    expect(imageSourceKey({ kind: 'worktree' })).toBe('worktree')
    expect(imageSourceKey({ kind: 'rev', rev: 'abc' })).toBe('rev:abc')
    expect(imageSourceKey({ kind: 'rev', rev: 'abc' })).not.toBe(imageSourceKey({ kind: 'rev', rev: 'abd' }))
  })
})
