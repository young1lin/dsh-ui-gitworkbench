/**
 * The lock every filesystem path in the host passes through.
 *
 * git needs none of this: whatever pathspec it is handed it stays inside the
 * repository. `readFile`, `stat` and `readdir` have no such backstop, and the
 * paths they are given come from the browser. These are the spellings that
 * must not survive the trip.
 */
import { join, resolve, sep } from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolveInside } from '../src/path-lock.js'

const root = resolve(process.platform === 'win32' ? 'C:/gw-lock-root' : '/gw-lock-root')

describe('resolveInside', () => {
  it('resolves a plain relative path against the root', () => {
    expect(resolveInside(root, 'a/b.txt')).toBe(resolve(root, 'a/b.txt'))
  })

  it('resolves a directory row, which is how git reports a collapsed listing', () => {
    // `ls-files --directory` and `status --porcelain` both name a whole
    // directory with a trailing slash; that row reaches `ignoredDir` and
    // `measureUntracked` exactly as printed.
    expect(resolveInside(root, 'sub/')).toBe(resolve(root, 'sub'))
  })

  it('resolves paths written with the platform separator', () => {
    expect(resolveInside(root, ['a', 'b.txt'].join(sep))).toBe(resolve(root, 'a', 'b.txt'))
  })

  it('refuses to leave the worktree', () => {
    expect(() => resolveInside(root, '../escape.txt')).toThrow(/unsafe path/)
    expect(() => resolveInside(root, 'a/../../escape.txt')).toThrow(/unsafe path/)
    expect(() => resolveInside(root, '../../../../etc/passwd')).toThrow(/unsafe path/)
  })

  it('refuses a backslash traversal, which is a path on Windows and a name on POSIX', () => {
    // Win32 accepts both separators, so `a\..\..\b` walks out through any
    // check that only knew about `/` — the reason the spelling check
    // normalises before splitting.
    expect(() => resolveInside(root, 'a\\..\\..\\escape.txt')).toThrow(/unsafe path/)
  })

  it('refuses an absolute path, a drive letter and a UNC prefix', () => {
    expect(() => resolveInside(root, '/etc/passwd')).toThrow(/unsafe path/)
    expect(() => resolveInside(root, 'C:/Windows/System32/config/SAM')).toThrow(/unsafe path/)
    expect(() => resolveInside(root, '//server/share/file')).toThrow(/unsafe path/)
  })

  it('refuses a NUL byte, which truncates the path at the syscall', () => {
    expect(() => resolveInside(root, 'a.txt\0.png')).toThrow(/unsafe path/)
  })

  it('refuses an empty path and one git would read as an option', () => {
    expect(() => resolveInside(root, '')).toThrow(/unsafe path/)
    expect(() => resolveInside(root, '--output=/tmp/x')).toThrow(/unsafe path/)
  })

  it('refuses the worktree root itself', () => {
    expect(() => resolveInside(root, '.')).toThrow(/worktree root/)
    expect(() => resolveInside(root, './')).toThrow(/worktree root/)
  })

  it('does not mistake a sibling whose name starts with the root for a child', () => {
    // The second lock is `startsWith(base + sep)`, not `startsWith(base)`:
    // without the separator, `/repo-backup/secrets` reads as inside `/repo`.
    const child = resolveInside(root, 'x/file.txt')
    expect(child.startsWith(root + sep)).toBe(true)
    expect(child).not.toBe(join(`${root}-backup`, 'file.txt'))
  })
})
