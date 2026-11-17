import { describe, expect, it, vi } from 'vitest'
import { nativeFileContribution } from '../src/client/native-file-menu.ts'
import { locateNativeFile } from '../src/native-file.ts'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('native file entry', () => {
  it('keeps the gesture session, absolute worktree path and line, and reports failed routing', async () => {
    const open = vi.fn(async () => true)
    const contribution = nativeFileContribution(key => key, open)
    const target = { sessionId: 'origin-session', path: 'C:/repo/.agents/worktrees/topic/deleted.ts', line: 23 }
    const actions = await contribution.resolve(target, new AbortController().signal)
    expect(actions).toHaveLength(1)
    await actions[0]!.run!()
    expect(open).toHaveBeenCalledWith(target)
    open.mockResolvedValue(false)
    await expect(actions[0]!.run!()).rejects.toThrow()
    expect(await contribution.resolve({ sessionId: 'one', path: '../relative.ts' }, new AbortController().signal)).toEqual([])
    const ctrl = new AbortController(); ctrl.abort()
    expect(await contribution.resolve(target, ctrl.signal)).toEqual([])
  })
  it('discovers the root from the clicked path, including a removed directory, without enumerating files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'workbench-native-'))
    try {
      const worktree = join(dir, 'tree'); await mkdir(worktree)
      const path = join(worktree, 'removed', 'old.ts')
      const root = vi.fn(async () => worktree.replace(/\\/g, '/'))
      const deleted = await locateNativeFile(path, root)
      expect(root).toHaveBeenCalledWith(worktree)
      expect(deleted).toMatchObject({ repository: worktree.replace(/\\/g, '/'), path: 'removed/old.ts', deleted: true })
      await writeFile(join(worktree, 'current.ts'), 'current')
      expect(await locateNativeFile(join(worktree, 'current.ts'), root)).toMatchObject({ path: 'current.ts', deleted: false })
      expect(await locateNativeFile('../relative.ts', root)).toBeNull()
      expect(await locateNativeFile(path, async () => null)).toBeNull()
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
})
