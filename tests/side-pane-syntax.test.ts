/**
 * The side-by-side pane paints its two columns with the FILE pass.
 *
 * Its columns are whole files — `git diff -U1000000` is one hunk covering
 * everything — so the file pass is the exact answer, and the per-line re-lex
 * `highlightWindow` performs is the diff-reconstruction rule applied where no
 * reconstruction happened. The bug that showed it: a JSX block comment (the
 * brace-wrapped kind) whose continuation lines carry no star prefix, so the
 * re-lex painted `switch` and `in` inside the prose as keywords.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import * as ts from 'typescript'

import { highlightRange, shikiThemeOf, warmHighlighter, type HighlightRun } from '../src/client/highlight.ts'

const THEME = shikiThemeOf('github-dark')
const KEYWORD = '#FF7B72'

beforeAll(() => warmHighlighter())

const colours = (runs: HighlightRun[] | undefined): string =>
  (runs ?? []).map(run => run.color ?? '-').join(',')

describe('the file pass over a JSX comment', () => {
  it('keeps prose continuation lines as comment text', () => {
    const lines = [
      '{/* The switch lives HERE rather than in the commit list, and',
      '    a control that comes and goes is worse than one beside an',
      '    empty space. */}',
      'const after = 2',
    ]
    const runs = highlightRange('jsx-comment', lines, 'typescript', THEME, 0, lines.length)
    expect(runs).toBeDefined()
    expect(colours(runs?.[0])).not.toContain(KEYWORD)
    expect(colours(runs?.[1])).not.toContain(KEYWORD)
    expect(colours(runs?.[2])).not.toContain(KEYWORD)
    expect(colours(runs?.[3])).toContain(KEYWORD)
  })
})

describe('SideBySideView', () => {
  const text = readFileSync(fileURLToPath(new URL('../src/client/DiffViews.tsx', import.meta.url)), 'utf8')
  const ast = ts.createSourceFile('DiffViews.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

  /** Every callee name in the file, from the AST — prose in a comment cannot
   *  satisfy this the way a text scan has twice been satisfied. */
  function callees(): string[] {
    const out: string[] = []
    const walk = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) out.push(node.expression.text)
      ts.forEachChild(node, walk)
    }
    walk(ast)
    return out
  }

  it('paints both columns with the file pass, never the diff re-lex', () => {
    const names = callees()
    expect(names.filter(name => name === 'highlightWindow')).toHaveLength(0)
    // The editor buffer, the left column, the right column.
    expect(names.filter(name => name === 'highlightRange').length).toBeGreaterThanOrEqual(3)
  })
})
