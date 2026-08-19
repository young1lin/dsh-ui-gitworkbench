/**
 * The writeChecked sequence over a real git in a temp repo: the stale guard,
 * the atomic write, and the '' (did-not-exist) semantics of `expectedSha`.
 *
 * The decisions live in `src/write-checked.ts` behind an injected IO — the
 * same code `index.ts` binds — so what these tests drive is the sequence that
 * ships, not a restatement of it. File state is asserted on DISK (the read
 * happens behind the runner's back), because the whole point of this RPC is
 * what it leaves in the working tree: a refused save must leave the file
 * exactly as the concurrent writer left it.
 */
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rename as fsRename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { runWriteChecked, type WriteCheckedIo } from '../src/write-checked.js'

let repo = ''

function git(...args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' })
}

/** What the editor would have opened with: the file's blob sha, '' when absent. */
function diskSha(path: string): string {
  try {
    return git('hash-object', '--', path).trim()
  } catch {
    return ''
  }
}

const V1 = ['one', 'two', 'three', ''].join('\n')

beforeEach(async () => {
  // No commit is made: nothing in this sequence reads HEAD or the index —
  // `hash-object` works on bare working-tree files — and skipping `git commit`
  // keeps the suite's stderr free of the hook-discovery noise one would print.
  repo = await mkdtemp(join(tmpdir(), 'gw-write-'))
  git('init', '-q', '.')
  git('config', 'core.autocrlf', 'false')
  await writeFile(join(repo, 'f.ts'), V1)
})

afterEach(async () => {
  await rm(repo, { recursive: true, force: true })
})

/** Leftover temp files from the atomic write — the tree must not list any. */
async function tempLeftovers(): Promise<string[]> {
  const all = await readdir(repo)
  return all.filter(name => name.includes('gwtmp') || name.endsWith('.tmp'))
}

/**
 * The IO `index.ts` binds, pointed at this temp repo: a real git, the real
 * filesystem. `git` records its argv so the refusal tests can prove nothing
 * ran that could have written.
 */
function repoIo(overrides: Partial<WriteCheckedIo> = {}): { io: WriteCheckedIo; gitArgv: string[][] } {
  const gitArgv: string[][] = []
  const io: WriteCheckedIo = {
    git: async (cwd, argv) => {
      gitArgv.push([...argv])
      try {
        return { stdout: execFileSync('git', ['-C', cwd, ...argv], { encoding: 'utf8' }), exitCode: 0, stderr: '' }
      } catch (error) {
        const failure = error as { stdout?: string; stderr?: string; status?: number }
        return { stdout: failure.stdout ?? '', exitCode: failure.status ?? 1, stderr: failure.stderr ?? '' }
      }
    },
    exists: async p => {
      try {
        await stat(p)
        return true
      } catch {
        return false
      }
    },
    readBytes: p => readFile(p),
    writeBytes: async (p, bytes) => {
      await mkdir(join(p, '..'), { recursive: true })
      await writeFile(p, bytes)
    },
    rename: async (from, to) => { await fsRename(from, to) },
    remove: async p => { await rm(p, { force: true }) },
    delay: async () => {},
    ...overrides,
  }
  return { io, gitArgv }
}

describe('writeChecked against a real git', () => {
  it('refuses a save whose sha is stale and writes nothing', async () => {
    const opened = diskSha('f.ts')
    // The agent rewrites the file behind the RPC's back.
    await writeFile(join(repo, 'f.ts'), 'externally rewritten\n')
    const { io } = repoIo()
    const result = await runWriteChecked(io, repo, 'f.ts', 'my edit\n', opened)
    expect(result).toMatchObject({ ok: false, failure: 'stale' })
    // JSON-safe failure: `sha` is OMITTED, not undefined.
    expect('sha' in result).toBe(false)
    expect(result.error).toContain('f.ts')
    // Nothing was written: the disk still holds the concurrent writer's bytes,
    // and the atomic write's temp file never survived.
    expect(await readFile(join(repo, 'f.ts'), 'utf8')).toBe('externally rewritten\n')
    expect(await tempLeftovers()).toEqual([])
  })

  it('writes the buffer with LF endings and returns the fresh sha', async () => {
    const opened = diskSha('f.ts')
    const text = 'line one\nline two\nline three\n'
    const { io } = repoIo()
    const result = await runWriteChecked(io, repo, 'f.ts', text, opened)
    expect(result.ok).toBe(true)
    // The returned sha is what a FRESH hash-object says, and the disk holds
    // the saved text byte for byte — LF, no translation.
    expect(result.sha).toBe(diskSha('f.ts'))
    const bytes = await readFile(join(repo, 'f.ts'))
    expect(bytes.toString('utf8')).toBe(text)
    expect(bytes.includes('\r')).toBe(false)
    expect(await tempLeftovers()).toEqual([])
    // JSON-safe success: failure/error are OMITTED, not undefined.
    expect('failure' in result).toBe(false)
    expect('error' in result).toBe(false)
  })

  it('writes through a temp file in the same directory and renames it over the target', async () => {
    const opened = diskSha('f.ts')
    const writes: string[] = []
    const renames: Array<[string, string]> = []
    const { io } = repoIo({
      writeBytes: async (p, bytes) => { writes.push(p); await writeFile(p, bytes) },
      rename: async (from, to) => { renames.push([from, to]); await fsRename(from, to) },
    })
    const result = await runWriteChecked(io, repo, 'f.ts', 'renamed in\n', opened)
    expect(result.ok).toBe(true)
    expect(writes).toHaveLength(1)
    // Same directory as the target: the rename stays inside one filesystem,
    // which is the only thing that makes it atomic.
    expect(writes[0]).not.toBe(join(repo, 'f.ts'))
    expect(join(writes[0]!, '..')).toBe(join(join(repo, 'f.ts'), '..'))
    expect(renames).toEqual([[writes[0]!, join(repo, 'f.ts')]])
  })

  it("accepts expectedSha '' only while the file is still absent", async () => {
    // The buffer was opened on a file that did not exist; saving recreates it.
    const created = await runWriteChecked(repoIo().io, repo, 'gone.txt', 'recreated\n', '')
    expect(created.ok).toBe(true)
    expect(await readFile(join(repo, 'gone.txt'), 'utf8')).toBe('recreated\n')
    expect(created.sha).toBe(diskSha('gone.txt'))
  })

  it("refuses expectedSha '' once the file exists", async () => {
    const result = await runWriteChecked(repoIo().io, repo, 'f.ts', 'someone made this\n', '')
    expect(result).toMatchObject({ ok: false, failure: 'stale' })
    expect(result.error).toContain('f.ts')
    expect(await readFile(join(repo, 'f.ts'), 'utf8')).toBe(V1)
  })

  it('reports a deleted-underneath file as stale rather than writing it back', async () => {
    const opened = diskSha('f.ts')
    await rm(join(repo, 'f.ts'))
    const result = await runWriteChecked(repoIo().io, repo, 'f.ts', 'restore my copy\n', opened)
    // The file is gone, so the recomputed sha is '' — not the sha the editor
    // opened with. Refusing is the safe direction: writing would resurrect a
    // file somebody deliberately deleted.
    expect(result).toMatchObject({ ok: false, failure: 'stale' })
    await expect(stat(join(repo, 'f.ts'))).rejects.toThrow()
  })

  it('treats a failed hash-object as a failure to save, not as a changed file', async () => {
    const opened = diskSha('f.ts')
    // A spawn error or a broken git must not masquerade as "exists with a
    // different sha" — that would look like the stale case while silently
    // skipping the guard's real work. It is a plain failure, nothing written.
    const seen: string[][] = []
    const { io } = repoIo({
      git: async (cwd, argv) => {
        seen.push([...argv])
        if (argv[0] === 'hash-object') {
          return { stdout: '', exitCode: 128, stderr: 'fatal: spawn exploded' }
        }
        return { stdout: execFileSync('git', ['-C', cwd, ...argv], { encoding: 'utf8' }), exitCode: 0, stderr: '' }
      },
    })
    const result = await runWriteChecked(io, repo, 'f.ts', 'my edit\n', opened)
    expect(result).toMatchObject({ ok: false, failure: 'unknown' })
    expect(result.error).toContain('hash-object')
    expect(await readFile(join(repo, 'f.ts'), 'utf8')).toBe(V1)
    expect(await tempLeftovers()).toEqual([])
    // Only the one hash ran — the write never started.
    expect(seen).toEqual([['hash-object', '--', 'f.ts']])
  })

  it('refuses a path outside the worktree before anything runs', async () => {
    const { io, gitArgv } = repoIo()
    const result = await runWriteChecked(io, repo, '../escape.txt', 'nope\n', '')
    expect(result).toMatchObject({ ok: false, failure: 'invalid' })
    expect(gitArgv).toEqual([])
    await expect(stat(join(repo, '..', 'escape.txt'))).rejects.toThrow()
  })

  it('cleans up the temp file when the rename fails, and the target is untouched', async () => {
    const opened = diskSha('f.ts')
    const writes: string[] = []
    const { io } = repoIo({
      writeBytes: async (p, bytes) => { writes.push(p); await writeFile(p, bytes) },
      rename: async () => { throw new Error('EPERM: locked by a virus scanner') },
    })
    const result = await runWriteChecked(io, repo, 'f.ts', 'not this time\n', opened)
    expect(result).toMatchObject({ ok: false, failure: 'unknown' })
    expect(result.error).toContain('f.ts')
    expect(await readFile(join(repo, 'f.ts'), 'utf8')).toBe(V1)
    expect(writes).toHaveLength(1)
    expect(await tempLeftovers()).toEqual([])
  })

  it('retries the rename on a transient Windows lock', async () => {
    const opened = diskSha('f.ts')
    let attempts = 0
    const { io } = repoIo({
      rename: async (from, to) => {
        attempts += 1
        if (attempts === 1) throw new Error('EPERM: another handle holds the target')
        await fsRename(from, to)
      },
    })
    const result = await runWriteChecked(io, repo, 'f.ts', 'second try\n', opened)
    expect(result.ok).toBe(true)
    expect(attempts).toBe(2)
    expect(await readFile(join(repo, 'f.ts'), 'utf8')).toBe('second try\n')
  })

  it('folds a throwing IO into a failed result rather than throwing', async () => {
    const { io } = repoIo({ exists: async () => { throw new Error('disk went away') } })
    const result = await runWriteChecked(io, repo, 'f.ts', 'x\n', diskSha('f.ts'))
    expect(result).toMatchObject({ ok: false, failure: 'unknown', error: 'disk went away' })
    expect(await readFile(join(repo, 'f.ts'), 'utf8')).toBe(V1)
  })
})

describe('writeChecked refuses a file it cannot round-trip', () => {
  it('refuses a save over a non-UTF-8 file, and leaves its bytes alone', async () => {
    // GBK "中文注释": no NUL byte, so the binary sniff waves it through, and
    // the text the editor was handed is a lossy decode of it. Saving that back
    // would replace every non-ASCII byte in the file.
    const gbk = Buffer.concat([
      Buffer.from('package main\n// ', 'ascii'),
      Buffer.from([0xD6, 0xD0, 0xCE, 0xC4, 0xD7, 0xA2, 0xCA, 0xCD]),
      Buffer.from('\nfunc main() {}\n', 'ascii'),
    ])
    await writeFile(join(repo, 'gbk.go'), gbk)
    const { io } = repoIo()
    // The buffer as the pane would have handed it over: the lossy decode.
    const result = await runWriteChecked(io, repo, 'gbk.go', gbk.toString('utf8'), diskSha('gbk.go'))
    expect(result).toMatchObject({ ok: false, failure: 'invalid' })
    expect(result.error).toContain('not UTF-8')
    // The bytes on disk are untouched — not "mostly", exactly.
    expect(Buffer.compare(await readFile(join(repo, 'gbk.go')), gbk)).toBe(0)
  })

  it('refuses before the sha check, so the message names the real problem', async () => {
    // A stale sha AND a bad encoding: the encoding sentence is the useful one,
    // because retrying with a fresh sha would fail exactly the same way.
    await writeFile(join(repo, 'latin.txt'), Buffer.from([0x63, 0x61, 0x66, 0xE9, 0x0A]))
    const { io } = repoIo()
    const result = await runWriteChecked(io, repo, 'latin.txt', 'caf�\n', 'not-the-sha')
    expect(result).toMatchObject({ ok: false, failure: 'invalid' })
    expect(result.error).toContain('not UTF-8')
  })

  it('still writes a plain UTF-8 file, including non-ASCII it can round-trip', async () => {
    await writeFile(join(repo, 'utf8.txt'), '中文注释\n', 'utf8')
    const { io } = repoIo()
    const result = await runWriteChecked(io, repo, 'utf8.txt', '中文注释 changed\n', diskSha('utf8.txt'))
    expect(result.ok).toBe(true)
    expect(await readFile(join(repo, 'utf8.txt'), 'utf8')).toBe('中文注释 changed\n')
  })
})
