/**
 * The `worktree_status` agent tool must declare every key `worktreeStatus`
 * returns.
 *
 * dsh validates a tool's output against its declared schema before the
 * model sees it (`createSuccessResult` in packages/core/tools), and the
 * status schema is `additionalProperties: false` — so a key the RPC gained
 * and the schema did not is not an extra field, it is `INVALID_TOOL_OUTPUT`
 * for every call of the tool. The RPC grew `remoteBranches`,
 * `remoteBranchesTruncated` and `mainWorktreePath` for the drawer's branch
 * switcher, and `repoRoot` for the subdirectory session, while the schema
 * still listed the original seven; the tool had been failing since the
 * first of those, unnoticed because the drawer reads the RPC directly.
 *
 * Two guards. The structural one always runs: it reads the schema's keys
 * and the RPC's declared return keys from `index.ts` as TEXT (comments
 * stripped, in the shape of `host-rooted-paths.test.ts`) and pins them
 * equal. The second runs dsh's own validator over the schema and a full
 * value whenever `@deepseek-ai/dsh-tools` resolves — on a developer
 * machine with the linked profile, not in CI, where the peers are absent
 * by design (`.npmrc`, README 6.5).
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(fileURLToPath(new URL('../src/index.ts', import.meta.url)), 'utf8')

/** Comments stripped before anything is matched — see the file header. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const host = code(source)

/** The `STATUS_SCHEMA` object literal, as text, `as const` dropped. */
function schemaLiteral(): string {
  const at = host.indexOf('const STATUS_SCHEMA = {')
  expect(at, 'STATUS_SCHEMA is not declared').toBeGreaterThanOrEqual(0)
  const open = host.indexOf('{', at)
  let depth = 0
  for (let i = open; i < host.length; i += 1) {
    if (host[i] === '{') depth += 1
    else if (host[i] === '}') {
      depth -= 1
      if (depth === 0) return host.slice(open, i + 1)
    }
  }
  throw new Error('STATUS_SCHEMA literal does not close')
}

/** Top-level keys of the schema's `properties` block. */
function declaredKeys(): string[] {
  const literal = schemaLiteral()
  const at = literal.indexOf('properties: {')
  expect(at).toBeGreaterThanOrEqual(0)
  const block = literal.slice(at + 'properties: {'.length)
  // A top-level property starts a line at the block's own indentation and is
  // followed by `: {`; nested keys sit deeper.
  return [...block.matchAll(/^ {8}(\w+): \{/gm)].map(match => match[1]!)
}

/** Keys of the object type `worktreeStatus` declares it resolves to. */
function returnedKeys(): string[] {
  const match = /async worktreeStatus\([^)]*\): Promise<\{([^}]*)\}>/.exec(host)
  expect(match, 'worktreeStatus signature not found').not.toBeNull()
  return match![1]!.split(';').map(part => part.trim().split(':')[0]!.trim()).filter(key => key.length > 0)
}

describe('the worktree_status tool output schema', () => {
  it('declares exactly the keys worktreeStatus returns, plus the ok/error envelope', () => {
    const returned = returnedKeys()
    expect(returned.length).toBeGreaterThan(5)
    expect(new Set(declaredKeys())).toEqual(new Set(['ok', 'error', ...returned]))
  })

  const require = createRequire(import.meta.url)
  let tools: { validateJsonSchemaValue(schema: unknown, value: unknown, path?: string): string[]; assertSupportedJsonSchema(schema: unknown): void } | null = null
  try { tools = require('@deepseek-ai/dsh-tools') } catch { tools = null }

  describe.skipIf(tools === null)("dsh's own validator", () => {
    // The literal is plain data once `as const` is gone; evaluating it is
    // what the tool registration does with it.
    const schema = new Function(`return ${schemaLiteral().replace(/\s+as const$/, '')}`)() as unknown

    it('accepts the schema itself under the dsh-tools subset', () => {
      expect(() => tools!.assertSupportedJsonSchema(schema)).not.toThrow()
    })

    it('accepts a full status, inside and outside a repository', () => {
      const inRepo = {
        binding: { repoRoot: 'C:/repo', worktreePath: 'C:/repo/.agents/worktrees/x', name: 'x', enteredAt: 't', branch: 'x' },
        bindingInherited: false,
        worktrees: [{ path: 'C:/repo', branch: 'main', head: 'abc' }],
        branches: ['main', 'x'],
        branchesTruncated: false,
        remoteBranches: ['origin/dev'],
        remoteBranchesTruncated: false,
        mainWorktreePath: 'C:/repo',
        repoRoot: 'C:/repo',
      }
      const outside = {
        binding: null, bindingInherited: false, worktrees: [], branches: [], branchesTruncated: false,
        remoteBranches: [], remoteBranchesTruncated: false, mainWorktreePath: null, repoRoot: null,
      }
      const refused = { ok: false, error: 'worktree tools require a calling session' }
      for (const value of [inRepo, outside, refused]) {
        expect(tools!.validateJsonSchemaValue(schema, value, 'value')).toEqual([])
      }
    })
  })
})
