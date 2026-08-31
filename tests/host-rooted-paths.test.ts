/**
 * Every RPC that carries a PATH must run git at the repository root.
 *
 * The drawer's paths are repository-relative — porcelain status and
 * `--numstat` print them that way wherever they run — while pathspecs,
 * `:path` revisions, `hash-object` arguments and `join(dir, path)` all
 * resolve against the directory a command runs IN. A session opened at a
 * subdirectory of the repository (a monorepo's `server/`) therefore listed
 * the right files and then showed an empty pane for every one of them:
 * `diff HEAD -- server/f` from `server/` looks for `server/server/f`,
 * matches nothing, and exits 0. The fix resolves the root once per RPC
 * (`rootedDirOf`) and runs everything there — `repo-root.ts`, plus
 * `repo-root.git.test.ts` for the git-side facts.
 *
 * `index.ts` extends TypertRemoteService and imports its dsh peers as
 * values, so vitest cannot load it; this guard reads it as TEXT instead,
 * in the shape of `commit-row-height.test.ts`: comments stripped first
 * (prose in a comment has fooled a scanner here twice), and the matched
 * method list asserted EXACTLY so a regex that stops matching anything
 * fails the test instead of passing it vacuously.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(fileURLToPath(new URL('../src/index.ts', import.meta.url)), 'utf8')

/** Comments stripped before anything is matched — see the file header. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

interface RemoteMethod {
  readonly name: string
  readonly params: string
  readonly body: string
}

/**
 * The @Remote methods of the service: name, parameter list, and body.
 *
 * The body is brace-matched from the signature, on the comment-stripped
 * text, so prose cannot push a boundary around and no decorator-less
 * helper is picked up by accident. The opening brace is the first one at
 * ANGLE-BRACKET depth zero — a return type like `Promise<{ readonly diff:
 * string }>` carries braces of its own before the body ever starts, and a
 * naive first-`{` match would hand back the type annotation as the body.
 */
function remoteMethods(text: string): RemoteMethod[] {
  const methods: RemoteMethod[] = []
  const decorator = /@Remote\('([^']+)'\)\s*(?:async\s+)?(\w+)\(([^)]*)\)/g
  for (let match = decorator.exec(text); match !== null; match = decorator.exec(text)) {
    const afterParams = match.index + match[0].length
    let angle = 0
    let open = -1
    for (let at = afterParams; at < text.length; at += 1) {
      const ch = text[at]
      if (ch === '<') angle += 1
      else if (ch === '>') angle = Math.max(0, angle - 1)
      else if (ch === '{' && angle === 0) { open = at; break }
    }
    if (open === -1) continue
    let depth = 0
    let end = -1
    for (let at = open; at < text.length; at += 1) {
      if (text[at] === '{') depth += 1
      else if (text[at] === '}') {
        depth -= 1
        if (depth === 0) { end = at; break }
      }
    }
    if (end === -1) continue
    methods.push({ name: match[1]!, params: match[3] ?? '', body: text.slice(open, end) })
  }
  return methods
}

/** A method is path-carrying when it takes one path or a list of them. */
function carriesPaths(method: RemoteMethod): boolean {
  return /\bpath:\s*string\b/.test(method.params) || /\bpaths:\s*readonly string\[\]/.test(method.params)
}

describe('path-carrying RPCs run at the repository root', () => {
  const stripped = code(source)
  const methods = remoteMethods(stripped)

  it('finds the service\u2019s remotes at all', () => {
    // The vacuous-pass backstop: if the decorator pattern stops matching,
    // every assertion below would hold over an empty set.
    expect(methods.map(m => m.name)).toContain('stats')
    expect(methods.length).toBeGreaterThan(10)
  })

  it('exactly the expected RPCs carry paths', () => {
    expect(methods.filter(carriesPaths).map(m => m.name).sort()).toEqual([
      'applyBlocks',
      'blame',
      'discardFile',
      'discardPlan',
      'fileDiff',
      'fileImage',
      'fileSides',
      'stage',
      'unstage',
      'writeChecked',
    ])
  })

  it('every path-carrying RPC resolves its directory with rootedDirOf', () => {
    // `stats` takes no path argument, so it is not listed here — its
    // repository-relative reads (the untracked measurement) are covered by
    // the same helper, which the next test pins.
    const offenders = methods
      .filter(carriesPaths)
      .filter(method => !method.body.includes('rootedDirOf'))
      .map(method => method.name)
    expect(offenders, 'RPCs carrying paths but not rooting their directory').toEqual([])
  })

  it('stats reads untracked files against the rooted directory too', () => {
    const stats = methods.find(method => method.name === 'stats')
    expect(stats, 'stats method not found').toBeDefined()
    expect(stats!.body, 'stats must resolve rootedDirOf in its parallel batch').toContain('rootedDirOf')
    expect(stats!.body, 'stats must measure untracked files at the root').toContain('measureUntracked(root,')
  })
})
