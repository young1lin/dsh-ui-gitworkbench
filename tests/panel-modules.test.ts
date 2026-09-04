import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as ts from 'typescript'

const source = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../src/client/${name}`, import.meta.url)), 'utf8')

function moduleRefs(name: string): { imports: string[]; typeExports: string[] } {
  const ast = ts.createSourceFile(name, source(name), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const imports: string[] = []
  const typeExports: string[] = []
  for (const statement of ast.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      imports.push(statement.moduleSpecifier.text)
    }
    if (ts.isExportDeclaration(statement) && statement.isTypeOnly
      && statement.moduleSpecifier !== undefined && ts.isStringLiteral(statement.moduleSpecifier)) {
      typeExports.push(statement.moduleSpecifier.text)
    }
  }
  return { imports, typeExports }
}

const FEATURES = [
  'ChangesFileTree.tsx',
  'CommitHistory.tsx',
  'DiffViews.tsx',
  'WorkbenchControls.tsx',
] as const

describe('GitWorkbenchPanel module boundaries', () => {
  it('keeps the state orchestrator below the monolith threshold', () => {
    expect(source('GitWorkbenchPanel.tsx').split('\n').length).toBeLessThanOrEqual(2_300)
  })

  it('keeps each feature module reviewable', () => {
    for (const file of FEATURES) {
      expect(source(file).split('\n').length, file).toBeLessThanOrEqual(1_100)
    }
  })

  it('shares one CSS module contract and creates no panel import cycles', () => {
    for (const file of FEATURES) {
      const { imports } = moduleRefs(file)
      expect(imports, file).toContain('./GitWorkbenchPanel.module.css')
      expect(imports, file).not.toContain('./GitWorkbenchPanel.tsx')
    }
  })

  it('calls no hook after the panel gives up rendering', () => {
    // `GitWorkbenchPanel` returns null while the first stats fetch is in
    // flight, and again for a stats error with the drawer shut. Every handler
    // declared past those guards is therefore a plain function on purpose: one
    // `useCallback` down there renders fewer hooks than the previous pass on
    // the frame the stats land, which React reports as error #310 and the dsh
    // shell reports as "slot entry crashed in
    // 'conversation.session.header.actions'" — the chip vanishes with no other
    // sign. Caught live once; this is so it is caught here instead.
    const text = source('GitWorkbenchPanel.tsx')
    const ast = ts.createSourceFile('p.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    let body: ts.Block | undefined
    const findPanel = (node: ts.Node): void => {
      if (ts.isFunctionDeclaration(node) && node.name?.text === 'GitWorkbenchPanel') body = node.body
      else ts.forEachChild(node, findPanel)
    }
    ts.forEachChild(ast, findPanel)
    expect(body, 'GitWorkbenchPanel should be a function declaration').toBeDefined()

    const statements = body!.statements
    const guard = statements.findIndex(statement =>
      ts.isIfStatement(statement) && statement.thenStatement.getText(ast).includes('return null'))
    expect(guard, 'the panel should still bail out early').toBeGreaterThanOrEqual(0)

    const late: string[] = []
    for (const statement of statements.slice(guard)) {
      const walk = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
          && /^use[A-Z]/.test(node.expression.text)) {
          late.push(`${node.expression.text} at line ${ast.getLineAndCharacterOfPosition(node.pos).line + 1}`)
        }
        ts.forEachChild(node, walk)
      }
      walk(statement)
    }
    expect(late, 'no hook may be called after the early returns').toEqual([])
  })

  it('keeps the public data contracts in a React-free module', () => {
    expect(moduleRefs('GitWorkbenchPanel.tsx').typeExports).toContain('./git-workbench-types.ts')
    expect(moduleRefs('git-workbench-types.ts').imports).not.toContain('react')
  })
})
