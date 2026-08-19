import { describe, expect, it } from 'vitest'

import { DEFAULT_INDENT, detectIndent, tabEdit } from '../src/client/indent.ts'

describe('detectIndent', () => {
  it('reads a tab-indented file as tabs', () => {
    expect(detectIndent('func main() {\n\tfmt.Println()\n\treturn\n}\n')).toBe('\t')
  })

  it('reads four-space Java as four', () => {
    const java = [
      'public final class Main {',
      '    public static void main(String[] args) {',
      '        System.out.println();',
      '    }',
      '}',
    ].join('\n')
    expect(detectIndent(java)).toBe('    ')
  })

  it('reads two-space TypeScript as two', () => {
    const ts = ['export function f() {', '  if (x) {', '    return 1', '  }', '}'].join('\n')
    expect(detectIndent(ts)).toBe('  ')
  })

  it('prefers the smaller step when two are equally common', () => {
    // Depth jumps of 4 and 8 both appear; 8 is two levels, never the unit.
    const text = ['a', '    b', '            c', 'd', '    e', '            f'].join('\n')
    expect(detectIndent(text)).toBe('    ')
  })

  it('falls back for a file with no indentation at all', () => {
    expect(detectIndent('one\ntwo\nthree\n')).toBe(DEFAULT_INDENT)
    expect(detectIndent('')).toBe(DEFAULT_INDENT)
  })

  it('learns from a single indented line when there is no step to measure', () => {
    expect(detectIndent('a\n      b\n')).toBe('      ')
  })

  it('ignores blank lines, which have no indentation to report', () => {
    expect(detectIndent('a\n\n  b\n\n    c\n')).toBe('  ')
  })
})

describe('tabEdit — inserting', () => {
  it('inserts one unit at the caret', () => {
    const out = tabEdit('ab', 1, 1, '  ', false)
    expect(out.text).toBe('a  b')
    expect([out.selectionStart, out.selectionEnd]).toEqual([3, 3])
  })

  it('replaces a within-line selection, the way typing would', () => {
    const out = tabEdit('abcd', 1, 3, '\t', false)
    expect(out.text).toBe('a\td')
    expect([out.selectionStart, out.selectionEnd]).toEqual([2, 2])
  })

  it('indents every line a multi-line selection touches', () => {
    const text = 'one\ntwo\nthree\n'
    const out = tabEdit(text, 0, 8, '  ', false) // through the end of "two"
    expect(out.text).toBe('  one\n  two\nthree\n')
  })

  it('keeps the touched lines selected so a second Tab indents again', () => {
    const once = tabEdit('one\ntwo\n', 0, 7, '  ', false)
    const twice = tabEdit(once.text, once.selectionStart, once.selectionEnd, '  ', false)
    expect(twice.text).toBe('    one\n    two\n')
  })

  it('leaves a blank line blank rather than making it whitespace', () => {
    // Trailing whitespace on an empty line is a diff on a line nobody edited.
    const out = tabEdit('a\n\nb', 0, 4, '  ', false)
    expect(out.text).toBe('  a\n\n  b')
  })

  it('does not take in the line the selection merely ends at the start of', () => {
    const out = tabEdit('one\ntwo\nthree', 0, 4, '  ', false)
    expect(out.text).toBe('  one\ntwo\nthree')
  })
})

describe('tabEdit — outdenting', () => {
  it('takes one unit off the caret line, whatever the column', () => {
    const out = tabEdit('    deep', 6, 6, '    ', true)
    expect(out.text).toBe('deep')
  })

  it('takes one unit off every selected line', () => {
    const out = tabEdit('  one\n  two\n', 0, 11, '  ', true)
    expect(out.text).toBe('one\ntwo\n')
  })

  it('tolerates a partial unit instead of refusing', () => {
    // Three spaces under a four-space unit: take what is there.
    const out = tabEdit('   odd', 0, 0, '    ', true)
    expect(out.text).toBe('odd')
  })

  it('does nothing to a line with no indentation left', () => {
    const out = tabEdit('flush', 2, 2, '  ', true)
    expect(out.text).toBe('flush')
  })

  it('outdents tabs one tab at a time', () => {
    const out = tabEdit('\t\tdeep', 0, 0, '\t', true)
    expect(out.text).toBe('\tdeep')
  })
})

describe('tabEdit — bounds', () => {
  it('clamps a selection past the end of the buffer', () => {
    const out = tabEdit('ab', 5, 9, '  ', false)
    expect(out.text).toBe('ab  ')
  })

  it('handles a caret at offset 0', () => {
    expect(tabEdit('x', 0, 0, '  ', false).text).toBe('  x')
  })
})
