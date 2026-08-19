import { describe, expect, it } from 'vitest'

import {
  classifyJumpError, fileUriToPath, jumpDeclined, pickLocation, repoRelative,
  toJumpTarget, type JumpLocation,
} from '../src/lsp-jump.ts'

/** A location at the top of a file, which is all most of these tests need. */
const at = (uri: string, line = 0, character = 0): JumpLocation =>
  ({ uri, range: { start: { line, character } } })

const ROOT = 'file:///C:/PythonProject/harness-worktree'

describe('fileUriToPath', () => {
  it('decodes the escapes a server may or may not have applied', () => {
    // The same directory, spelled three ways by three servers.
    expect(fileUriToPath('file:///C:/src/a.ts')).toBe('/C:/src/a.ts')
    expect(fileUriToPath('file:///c%3A/src/a.ts')).toBe('/C:/src/a.ts')
    expect(fileUriToPath('file:///C:/my%20project/a.ts')).toBe('/C:/my project/a.ts')
  })

  it('normalizes the spellings that only differ as text', () => {
    expect(fileUriToPath('file:///C:/src//a.ts')).toBe('/C:/src/a.ts')
    expect(fileUriToPath('file:///C:/src/')).toBe('/C:/src')
    expect(fileUriToPath('file:///C:\\src\\a.ts')).toBe('/C:/src/a.ts')
  })

  it('says no to a document that is not a file at all', () => {
    // Eclipse JDT answers with these for anything inside a jar, and they are
    // real answers — there is simply no path on disk to open.
    expect(fileUriToPath('jdt://contents/rt.jar/java.lang/String.class')).toBeNull()
    expect(fileUriToPath('zipfile:///C:/lib.zip::/a.py')).toBeNull()
    expect(fileUriToPath('untitled:Untitled-1')).toBeNull()
  })

  it('refuses a malformed escape rather than guessing at the bytes', () => {
    expect(fileUriToPath('file:///C:/a%ZZ/b.ts')).toBeNull()
  })

  it('keeps a UNC authority, which is part of the location', () => {
    expect(fileUriToPath('file://server/share/a.ts')).toBe('server/share/a.ts')
  })
})

describe('repoRelative', () => {
  it('relativizes against the workspace uri the provider resolved', () => {
    expect(repoRelative(`${ROOT}/src/index.ts`, ROOT)).toBe('src/index.ts')
    expect(repoRelative(`${ROOT}/a/b/c.ts`, ROOT)).toBe('a/b/c.ts')
  })

  it('survives the two sides being encoded differently', () => {
    // The whole reason this function exists rather than a startsWith: one of
    // these is the server's spelling and the other is the seam's, and nothing
    // guarantees they match.
    expect(repoRelative('file:///c%3A/PythonProject/harness-worktree/src/a.ts', ROOT)).toBe('src/a.ts')
    expect(repoRelative(`${ROOT}/src/a.ts`, 'file:///c%3A/PythonProject/harness-worktree')).toBe('src/a.ts')
  })

  it('treats a drive letter as case-insensitive, and nothing else', () => {
    expect(repoRelative('file:///c:/PythonProject/harness-worktree/src/a.ts', ROOT)).toBe('src/a.ts')
    // A POSIX root is left strictly case-sensitive: `/home/Src` and
    // `/home/src` are two directories, and merging them would open the wrong
    // file rather than fail to open one.
    expect(repoRelative('file:///home/user/Repo/src/a.ts', 'file:///home/user/repo')).toBeNull()
  })

  it('says outside for a sibling directory sharing a name prefix', () => {
    // `harness-worktree-old` starts with the root's whole text; only the
    // separator check keeps it out.
    expect(repoRelative(`${ROOT}-old/src/a.ts`, ROOT)).toBeNull()
  })

  it('says outside for a dependency, which is the common real case', () => {
    expect(repoRelative('file:///C:/PythonProject/other/src/a.ts', ROOT)).toBeNull()
    expect(repoRelative('jdt://contents/rt.jar/java.lang/String.class', ROOT)).toBeNull()
  })

  it('does not report the root itself as a file within it', () => {
    expect(repoRelative(ROOT, ROOT)).toBeNull()
    expect(repoRelative(`${ROOT}/`, ROOT)).toBeNull()
  })

  it('refuses a relative path that climbs back out', () => {
    expect(repoRelative(`${ROOT}/../secrets.txt`, ROOT)).toBeNull()
  })
})

describe('pickLocation', () => {
  it('prefers a definition inside the repository over one outside it', () => {
    // The reviewer asked where this comes from IN THE CODE THEY ARE READING.
    // An interface declared in a dependency is a true answer to a different
    // question.
    const chosen = pickLocation([
      at('file:///C:/PythonProject/other/node_modules/x/index.d.ts'),
      at(`${ROOT}/src/index.ts`, 12),
    ], ROOT)
    expect(chosen?.uri).toBe(`${ROOT}/src/index.ts`)
  })

  it('falls back to the first location when none are in the repository', () => {
    // Keeping it lets the drawer say WHERE the definition went; dropping it
    // would report "no definition", which is false.
    const outside = at('jdt://contents/rt.jar/java.lang/String.class')
    expect(pickLocation([outside], ROOT)).toBe(outside)
  })

  it('answers null for an empty answer', () => {
    expect(pickLocation([], ROOT)).toBeNull()
  })
})

describe('classifyJumpError', () => {
  it('calls an unclaimed extension what it is, not a missing install', () => {
    // The seam throws LSP_UNAVAILABLE when no provider handles this file's
    // extension. Reporting that as "no language server" would be false for an
    // operator who configured one, and any rule keyed on "nothing installed"
    // would then misfire in the languages that do work.
    const thrown = Object.assign(new Error('no LSP provider handles "a.md"'), { code: 'LSP_UNAVAILABLE' })
    expect(classifyJumpError(thrown).outcome).toBe('unclaimed')
  })

  it('routes on the code, never on the message', () => {
    // A message saying the same thing in prose is not the contract.
    const lookalike = new Error('LSP_UNAVAILABLE: no provider')
    expect(classifyJumpError(lookalike).outcome).toBe('error')
  })

  it('keeps the message for anything else, so the pane can say what broke', () => {
    const thrown = Object.assign(new Error('server exited'), { code: 'LSP_MALFORMED_RESPONSE' })
    expect(classifyJumpError(thrown)).toMatchObject({ outcome: 'error', message: 'server exited' })
  })

  it('survives a throw that is not an Error at all', () => {
    expect(classifyJumpError('boom')).toMatchObject({ outcome: 'error', message: 'boom' })
    expect(classifyJumpError(null).outcome).toBe('error')
    expect(classifyJumpError(undefined).outcome).toBe('error')
  })
})

describe('toJumpTarget', () => {
  it('carries the position through unchanged, still zero-based', () => {
    expect(toJumpTarget([at(`${ROOT}/src/a.ts`, 41, 7)], ROOT)).toEqual({
      outcome: 'ok', path: 'src/a.ts', line: 41, character: 7, uri: '', message: '',
    })
  })

  it('distinguishes "no definition" from "definition elsewhere"', () => {
    // Two different sentences for the user, so they are two different
    // outcomes rather than one empty result.
    expect(toJumpTarget([], ROOT).outcome).toBe('none')
    const outside = toJumpTarget([at('jdt://contents/rt.jar/java.lang/String.class')], ROOT)
    expect(outside.outcome).toBe('outside')
    expect(outside.uri).toBe('jdt://contents/rt.jar/java.lang/String.class')
    expect(outside.path).toBe('')
  })

  it('clamps a malformed position instead of discarding a good path', () => {
    expect(toJumpTarget([at(`${ROOT}/src/a.ts`, -3, 2.7)], ROOT))
      .toMatchObject({ outcome: 'ok', line: 0, character: 2 })
    expect(toJumpTarget([at(`${ROOT}/src/a.ts`, Number.NaN, 0)], ROOT))
      .toMatchObject({ outcome: 'ok', line: 0 })
  })

  it('fills every field in every outcome', () => {
    // The gateway's payloads carry no `undefined`, and a caller that has to
    // check which fields exist this time will eventually forget one.
    const keys = ['outcome', 'path', 'line', 'character', 'uri', 'message'].sort()
    for (const target of [
      toJumpTarget([at(`${ROOT}/a.ts`)], ROOT),
      toJumpTarget([], ROOT),
      toJumpTarget([at('jdt://x')], ROOT),
      jumpDeclined('unavailable', '', ''),
      jumpDeclined('error', '', 'server exited'),
    ]) {
      expect(Object.keys(target).sort()).toEqual(keys)
      for (const value of Object.values(target)) expect(value).not.toBeUndefined()
    }
  })
})
