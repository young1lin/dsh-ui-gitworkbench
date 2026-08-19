import { describe, expect, it } from 'vitest'

import {
  JUMP_STACK_CAP, canJump, describeOutside, jumpNoticeKey, popJumpOrigin,
  pushJumpOrigin, toEditorLine, toProtocolPosition, type JumpMark,
} from '../src/client/jump-view.ts'
import { jumpDeclined, toJumpTarget, type JumpOutcome } from '../src/lsp-jump.ts'

describe('canJump', () => {
  it('allows only the layer whose text is the file on disk', () => {
    // The seam's request carries a path and a position and no text: the
    // provider opens the document itself. Anything but the working-tree file
    // would have the drawer asking about one file and showing another.
    expect(canJump('unstaged', false)).toBe(true)
    expect(canJump('staged', false)).toBe(false)
  })

  it('withholds itself while the buffer is dirty', () => {
    // The same rule blame already follows, and for a worse failure: blame
    // shows a wrong name, this opens a wrong file with no sign anything went
    // astray.
    expect(canJump('unstaged', true)).toBe(false)
  })
})

describe('line numbering', () => {
  it('crosses between the protocol and the editor without drifting', () => {
    expect(toProtocolPosition(1, 0)).toEqual({ line: 0, character: 0 })
    expect(toProtocolPosition(42, 7)).toEqual({ line: 41, character: 7 })
    expect(toEditorLine(0)).toBe(1)
    expect(toEditorLine(41)).toBe(42)
  })

  it('round-trips, which is the property that actually matters', () => {
    for (const line of [1, 2, 99, 100_000]) {
      expect(toEditorLine(toProtocolPosition(line, 0).line)).toBe(line)
    }
  })

  it('clamps rather than producing a coordinate no document has', () => {
    expect(toProtocolPosition(0, 0).line).toBe(0)
    expect(toProtocolPosition(1, -5).character).toBe(0)
    expect(toEditorLine(-3)).toBe(1)
  })
})

describe('the back stack', () => {
  const mark = (path: string, line: number): JumpMark => ({ path, line })

  it('remembers where the reader was standing', () => {
    const stack = pushJumpOrigin([], mark('a.ts', 10), mark('b.ts', 3))
    const { mark: back, rest } = popJumpOrigin(stack)
    expect(back).toEqual({ path: 'a.ts', line: 10 })
    expect(rest).toEqual([])
  })

  it('does not record a jump that stayed put', () => {
    // A server answering a `const x = …` with the declaration itself lands on
    // the line the reader is already on. Pushing that fills the stack with
    // entries that appear to do nothing, and a back button that does nothing
    // reads as broken.
    expect(pushJumpOrigin([], mark('a.ts', 10), mark('a.ts', 10))).toEqual([])
    // A jump within the same file to another line IS somewhere to come back
    // from.
    expect(pushJumpOrigin([], mark('a.ts', 10), mark('a.ts', 88))).toHaveLength(1)
  })

  it('pops in the order the reader walked, deepest last', () => {
    let stack = pushJumpOrigin([], mark('a.ts', 1), mark('b.ts', 1))
    stack = pushJumpOrigin(stack, mark('b.ts', 1), mark('c.ts', 1))
    const first = popJumpOrigin(stack)
    expect(first.mark).toEqual({ path: 'b.ts', line: 1 })
    expect(popJumpOrigin(first.rest).mark).toEqual({ path: 'a.ts', line: 1 })
  })

  it('answers null on an empty stack instead of throwing', () => {
    expect(popJumpOrigin([]).mark).toBeNull()
  })

  it('drops the oldest rather than growing without bound', () => {
    let stack: readonly JumpMark[] = []
    for (let i = 0; i < JUMP_STACK_CAP + 10; i += 1) {
      stack = pushJumpOrigin(stack, mark('f.ts', i + 1), mark('g.ts', 1))
    }
    expect(stack).toHaveLength(JUMP_STACK_CAP)
    // The most recent place is the one worth keeping.
    expect(popJumpOrigin(stack).mark).toEqual({ path: 'f.ts', line: JUMP_STACK_CAP + 10 })
  })

  it('never mutates the stack it was handed', () => {
    const original: readonly JumpMark[] = [mark('a.ts', 1)]
    pushJumpOrigin(original, mark('b.ts', 2), mark('c.ts', 3))
    popJumpOrigin(original)
    expect(original).toEqual([mark('a.ts', 1)])
  })
})

describe('describeOutside', () => {
  it('keeps the tail, which is the part that identifies the file', () => {
    expect(describeOutside('file:///C:/PythonProject/app/node_modules/left-pad/index.js'))
      .toBe('…/node_modules/left-pad/index.js')
    expect(describeOutside('file:///C:/a/b.ts')).toBe('C:/a/b.ts')
  })

  it('keeps the scheme when the location is not a file at all', () => {
    // "There is no path on disk behind this" is the thing the reader most
    // needs to understand about a jdt: location, and the scheme is what says it.
    expect(describeOutside('jdt://contents/rt.jar/java.lang/String.class'))
      .toBe('jdt:…/rt.jar/java.lang/String.class')
  })

  it('decodes escapes so the name reads as a name', () => {
    expect(describeOutside('file:///C:/my%20project/a.ts')).toBe('C:/my project/a.ts')
  })

  it('keeps undecodable text rather than dropping the answer', () => {
    expect(describeOutside('file:///C:/a%ZZ/b.ts')).toContain('b.ts')
  })

  it('answers empty for the empty location', () => {
    expect(describeOutside('')).toBe('')
  })
})

describe('jumpNoticeKey', () => {
  it('says nothing when the jump landed', () => {
    expect(jumpNoticeKey(toJumpTarget(
      [{ uri: 'file:///r/a.ts', range: { start: { line: 1, character: 0 } } }],
      'file:///r',
    ))).toBe('')
  })

  it('gives every refusal its own words', () => {
    // Five different situations, five different sentences: "nothing is
    // configured" and "no definition here" are not the same news.
    const keys = (['none', 'outside', 'unavailable', 'unclaimed', 'error'] satisfies JumpOutcome[])
      .map(outcome => jumpNoticeKey(jumpDeclined(outcome, '', '')))
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys.every(key => key !== '')).toBe(true)
  })

  it('keeps "no seam at all" apart from "no server for this file"', () => {
    // The distinction the UI acts on: a missing seam is a fact about the
    // install and stays true for every file, so the drawer may stop offering
    // the button. An unclaimed extension is a fact about THIS file, and
    // treating it the same way would switch the feature off in the languages
    // the operator did configure.
    expect(jumpNoticeKey(jumpDeclined('unavailable', '', '')))
      .not.toBe(jumpNoticeKey(jumpDeclined('unclaimed', '', '')))
  })
})
