import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { removePathInside, resolveInside } from '../src/fs-remove.js'

let root = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'gw-rm-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('resolveInside', () => {
  it('resolves a plain relative path against the root', () => {
    expect(resolveInside(root, 'a/b.txt')).toBe(resolve(root, 'a/b.txt'))
  })

  it('refuses to leave the worktree', () => {
    expect(() => resolveInside(root, '../escape.txt')).toThrow(/unsafe path/)
    expect(() => resolveInside(root, 'a/../../escape.txt')).toThrow(/unsafe path/)
  })

  it('refuses an absolute path, a drive letter and a UNC prefix', () => {
    expect(() => resolveInside(root, '/etc/passwd')).toThrow(/unsafe path/)
    expect(() => resolveInside(root, 'C:/Windows/System32')).toThrow(/unsafe path/)
    expect(() => resolveInside(root, '//server/share/file')).toThrow(/unsafe path/)
  })

  it('refuses the worktree root itself', () => {
    expect(() => resolveInside(root, '.')).toThrow(/worktree root/)
  })
})

describe('removePathInside', () => {
  it('removes a file', async () => {
    const file = join(root, 'gone.txt')
    writeFileSync(file, 'x')
    await removePathInside(root, 'gone.txt')
    expect(existsSync(file)).toBe(false)
  })

  it('removes a directory row, which is how git reports a nested untracked repo', async () => {
    // `git status --porcelain=v1 --untracked-files=all` does NOT descend into
    // another repository: it prints one line, `?? sub/`. That row reaches the
    // drawer like any other, so rolling it back has to remove a directory.
    const dir = join(root, 'sub')
    mkdirSync(join(dir, '.git'), { recursive: true })
    writeFileSync(join(dir, 'a.txt'), 'x')
    await removePathInside(root, 'sub/')
    expect(existsSync(dir)).toBe(false)
  })

  it('treats an absent path as already done', async () => {
    await expect(removePathInside(root, 'never-existed.txt')).resolves.toBeUndefined()
  })

  it('leaves a sibling of the worktree alone', async () => {
    const sibling = join(root, '..', 'gw-rm-sibling.txt')
    writeFileSync(sibling, 'x')
    try {
      await expect(removePathInside(root, '../gw-rm-sibling.txt')).rejects.toThrow(/unsafe path/)
      expect(existsSync(sibling)).toBe(true)
    } finally {
      await rm(sibling, { force: true })
    }
  })

  it.runIf(process.platform === 'win32')('removes a file whose name is a Windows device name', async () => {
    // `nul`, `con`, `aux`, `com1` — with or without an extension — are device
    // names to Win32. git lists such a file as untracked but can neither index
    // nor `clean` it ("failed to remove nul: Permission denied"), so the
    // filesystem delete is the ONLY thing that can roll it back.
    for (const name of ['nul', 'con.md', 'aux.log']) {
      const target = join(root, name)
      writeFileSync(`\\\\?\\${target}`, 'device-named file')
      expect(existsSync(`\\\\?\\${target}`)).toBe(true)
      await removePathInside(root, name)
      expect(existsSync(`\\\\?\\${target}`)).toBe(false)
    }
  })

  it('resolves paths with the platform separator too', async () => {
    mkdirSync(join(root, 'a'), { recursive: true })
    writeFileSync(join(root, 'a', 'b.txt'), 'x')
    await removePathInside(root, ['a', 'b.txt'].join(sep))
    expect(existsSync(join(root, 'a', 'b.txt'))).toBe(false)
  })
})
