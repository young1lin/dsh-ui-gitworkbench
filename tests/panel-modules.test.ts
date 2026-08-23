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

  it('keeps the public data contracts in a React-free module', () => {
    expect(moduleRefs('GitWorkbenchPanel.tsx').typeExports).toContain('./git-workbench-types.ts')
    expect(moduleRefs('git-workbench-types.ts').imports).not.toContain('react')
  })
})
