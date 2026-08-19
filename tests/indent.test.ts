import { describe, expect, it } from 'vitest'

import { DEFAULT_INDENT, detectIndent } from '../src/client/indent.ts'

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

  it('reads a Java file with a text block as four, not eight', () => {
    // The live probe caught this one: a text block indents its body TWO levels
    // at once, so counting steps between consecutive lines made 8 the most
    // common step in a file that is plainly indented by 4.
    const java = [
      'public final class Main {',
      '    private static final String BANNER = """',
      '            task-queue demo',
      '            """;',
      '    public static void main(String[] args) {',
      '        System.out.println(BANNER);',
      '        System.out.println("x"',
      '            + "y");',
      '    }',
      '}',
    ].join('\n')
    expect(detectIndent(java)).toBe('    ')
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
