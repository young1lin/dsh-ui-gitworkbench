import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as ts from 'typescript'

const text = readFileSync(fileURLToPath(new URL('../src/client/DiffViews.tsx', import.meta.url)), 'utf8')
const ast = ts.createSourceFile('DiffViews.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

function collect<T extends ts.Node>(matches: (node: ts.Node) => node is T): T[] {
  const out: T[] = []
  const visit = (node: ts.Node): void => {
    if (matches(node)) out.push(node)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return out
}

function variable(name: string): ts.VariableDeclaration {
  const found = collect((node): node is ts.VariableDeclaration =>
    ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name)
  expect(found.length, 'variable ' + name + ' should have one declaration').toBe(1)
  return found[0]!
}

function call(name: string): ts.CallExpression {
  const found = collect((node): node is ts.CallExpression =>
    ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name)
  expect(found.length, 'call ' + name + ' should appear once').toBe(1)
  return found[0]!
}

function ancestor<T extends ts.Node>(node: ts.Node, matches: (parent: ts.Node) => parent is T): T | null {
  let at = node.parent
  while (at !== undefined) {
    if (matches(at)) return at
    at = at.parent
  }
  return null
}

describe('persistent hunk toolbar wiring', () => {
  it('targets the selected block for every non-empty layer', () => {
    const selected = call('currentActionBlock')
    expect(selected.arguments.map(argument => argument.getText(ast))).toEqual([
      'totalBlocks',
      "bodyState.kind !== 'empty'",
      'selectedBlock',
    ])

    expect(variable('selectedBlock').initializer?.getText(ast))
      .toBe('blockSelection.key === rowWindowKey ? blockSelection.block : 0')

    const changes = collect((node): node is ts.VariableDeclaration =>
      ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'changes'
      && node.initializer?.getText(ast).includes('bodyState.kind') === true)[0]
    expect(changes, 'the side pane should derive one edit-aware change count').toBeDefined()
    expect(changes!.initializer?.getText(ast)).toBe("bodyState.kind === 'empty' ? 0 : totalBlocks")
  })

  it('mounts current-block actions in the fixed pane header', () => {
    const buttons = collect((node): node is ts.CallExpression =>
      ts.isCallExpression(node) && ts.isIdentifier(node.expression)
      && node.expression.text === 'blockButtons' && node.arguments[0]?.getText(ast) === 'currentBlock')[0]
    expect(buttons, 'the fixed header should render blockButtons(currentBlock)').toBeDefined()

    const span = ancestor(buttons!, ts.isJsxElement)
    expect(span, 'blockButtons(currentBlock) should be inside a JSX element').not.toBeNull()
    const classAttr = span?.openingElement.attributes.properties.find(property =>
      ts.isJsxAttribute(property) && property.name.getText(ast) === 'className')
    expect(classAttr?.getText(ast)).toContain('sideCurrentBlockActions')

    const gates: string[] = []
    let at: ts.Node | undefined = buttons!.parent
    while (at !== undefined) {
      if (ts.isConditionalExpression(at)) gates.push(at.condition.getText(ast))
      at = at.parent
    }
    expect(gates).toContain('currentBlock !== null')
  })

  it('keeps dirty state in the disabled rule rather than the visibility rule', () => {
    expect(variable('barDisabled').initializer?.getText(ast)).toContain('dirty')
    expect(call('currentActionBlock').arguments.map(argument => argument.getText(ast))).not.toContain('dirty')
  })

  it('offers a fixed whole-file exit from the staged layer', () => {
    const unstageAll = collect((node): node is ts.CallExpression =>
      ts.isCallExpression(node) && ts.isIdentifier(node.expression)
      && node.expression.text === 'runAllBlocks' && node.arguments[0]?.getText(ast) === "'unstage'")[0]
    expect(unstageAll, 'the Staged header should call runAllBlocks(unstage)').toBeDefined()
    const button = ancestor(unstageAll!, ts.isJsxElement)
    expect(button?.openingElement.tagName.getText(ast)).toBe('button')
    expect(button?.getText(ast)).toContain("t('fileUnstage')")
  })
})
