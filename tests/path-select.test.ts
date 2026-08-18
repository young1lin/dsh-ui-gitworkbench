import { describe, expect, it } from 'vitest'
import { addPath, buildIndex, checkedState, isCovered, removePath } from '../src/client/path-select.ts'

const TREE = buildIndex([
  'x/s/aa/dd.md',
  'x/s/aa/ee.md',
  'x/s/aa/sub/ff.md',
  'x/s/bb.md',
  'y/z.md',
])

describe('isCovered', () => {
  it('an exact path or an ancestor prefix covers; a same-letter prefix does not', () => {
    expect(isCovered(['x/s/aa'], 'x/s/aa/dd.md')).toBe(true)
    expect(isCovered(['x/s/aa'], 'x/s/aa')).toBe(true)
    expect(isCovered(['x/s'], 'x/s2/q.md')).toBe(false)
    expect(isCovered(['x/s/aa/dd.md'], 'x/s/aa/ee.md')).toBe(false)
  })
})

describe('addPath', () => {
  it('ticking a folder absorbs the file already ticked inside it — the user\'s case', () => {
    expect(addPath(['x/s/aa/dd.md'], 'x/s/aa')).toEqual(['x/s/aa'])
  })

  it('absorbs every descendant, keeps unrelated paths', () => {
    expect(addPath(['x/s/aa/dd.md', 'x/s/aa/sub/ff.md', 'y/z.md'], 'x/s')).toEqual(['y/z.md', 'x/s'])
  })

  it('a tick already covered by an ancestor is a no-op', () => {
    expect(addPath(['x/s/aa'], 'x/s/aa/dd.md')).toEqual(['x/s/aa'])
  })
})

describe('removePath', () => {
  it('removing an exact tick drops just it', () => {
    expect(removePath(['x/s/aa', 'y/z.md'], 'y/z.md', TREE)).toEqual(['x/s/aa'])
  })

  it('unticking a file under a checked folder cascades out: folder becomes its other children', () => {
    expect(removePath(['x/s/aa'], 'x/s/aa/dd.md', TREE)).toEqual(['x/s/aa/ee.md', 'x/s/aa/sub'])
  })

  it('unticking a file nested two levels explodes each level; a dir left empty is NOT re-added', () => {
    // Re-adding x/s/aa/sub would re-include the very file being excluded
    // (a pathspec covers its whole subtree) — the tail must simply drop off.
    expect(removePath(['x/s'], 'x/s/aa/sub/ff.md', TREE)).toEqual(['x/s/bb.md', 'x/s/aa/dd.md', 'x/s/aa/ee.md'])
  })

  it('unticking something not covered changes nothing', () => {
    expect(removePath(['x/s/aa'], 'y/z.md', TREE)).toEqual(['x/s/aa'])
  })
})

describe('checkedState', () => {
  it('on for covered, off for unrelated, partial when only some descendants are in', () => {
    expect(checkedState(['x/s/aa'], 'x/s/aa/dd.md', TREE)).toBe('on')
    expect(checkedState(['x/s/aa'], 'y/z.md', TREE)).toBe('off')
    expect(checkedState(['x/s/aa/dd.md'], 'x/s/aa', TREE)).toBe('partial')
    expect(checkedState(['x/s/aa/dd.md'], 'x/s', TREE)).toBe('partial')
    // every leaf enumerated individually is also full coverage
    expect(checkedState(['x/s/aa/dd.md', 'x/s/aa/ee.md', 'x/s/aa/sub/ff.md', 'x/s/bb.md'], 'x/s', TREE)).toBe('on')
    expect(checkedState(['x/s/aa/dd.md', 'x/s/aa/ee.md', 'x/s/aa/sub', 'x/s/bb.md'], 'x/s', TREE)).toBe('on')
  })
})
