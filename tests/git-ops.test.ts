/**
 * The argv builders and output readers behind the drawer's write operations.
 *
 * These are kept apart from the RPC methods so they can be tested without
 * spawning git: what matters about `git push` is the argument vector it is
 * given and what the plugin concludes from the exit code, and both are
 * decidable from strings. The spawn itself is the part with no branches in it.
 */
import { describe, expect, it } from 'vitest'
import {
  NON_INTERACTIVE_ENV,
  decodesAsUtf8,
  isBinaryPrefix,
  classifyFailure,
  commitArgv,
  fetchArgv,
  isSafePathArg,
  parseTracking,
  pullArgv,
  pushArgv,
  stageArgv,
  stageStateOf,
  unstageArgv,
} from '../src/git-ops.ts'

describe('path arguments', () => {
  it('rejects a path git would read as a flag', () => {
    // A file really can be named "-f". Passed positionally it would silently
    // become an option; every builder puts paths after `--`, and this is the
    // second lock on the same door.
    expect(isSafePathArg('src/index.ts')).toBe(true)
    expect(isSafePathArg('-f')).toBe(false)
    expect(isSafePathArg('--force')).toBe(false)
    expect(isSafePathArg('')).toBe(false)
  })

  it('puts every path after the -- separator', () => {
    expect(stageArgv(['a.ts', 'b.ts'])).toEqual(['add', '--', 'a.ts', 'b.ts'])
    expect(unstageArgv(['a.ts'])).toEqual(['restore', '--staged', '--', 'a.ts'])
  })

  it('refuses to build a command with no paths', () => {
    // `git add --` with no pathspec is a no-op, but `git add` bare would stage
    // the whole tree. An empty selection must never reach git at all.
    expect(() => stageArgv([])).toThrow(/no paths/i)
    expect(() => unstageArgv([])).toThrow(/no paths/i)
  })

  it('refuses a flag-shaped path', () => {
    expect(() => stageArgv(['--force'])).toThrow(/unsafe path/i)
  })
})

describe('commit', () => {
  it('passes the message as one argv element', () => {
    // No shell is involved, so quoting is not the risk; splitting is. A message
    // with spaces and newlines has to stay a single element.
    expect(commitArgv('fix: a thing\n\nwith a body', false))
      .toEqual(['commit', '-m', 'fix: a thing\n\nwith a body'])
  })

  it('amends when asked', () => {
    expect(commitArgv('reworded', true)).toEqual(['commit', '--amend', '-m', 'reworded'])
  })

  it('refuses an empty or blank message', () => {
    expect(() => commitArgv('', false)).toThrow(/message/i)
    expect(() => commitArgv('   \n  ', false)).toThrow(/message/i)
  })

  it('never adds -a', () => {
    // The drawer has a staging area; committing the whole worktree behind the
    // user's back would make the staged/unstaged split a lie.
    expect(commitArgv('m', false)).not.toContain('-a')
  })
})

describe('network commands', () => {
  it('prunes on fetch so a deleted remote branch stops counting', () => {
    expect(fetchArgv()).toEqual(['fetch', '--prune'])
  })

  it('maps each pull mode to its own flag', () => {
    expect(pullArgv('ff-only')).toEqual(['pull', '--ff-only'])
    expect(pullArgv('rebase')).toEqual(['pull', '--rebase'])
    expect(pullArgv('merge')).toEqual(['pull', '--no-rebase'])
  })

  it('sets the upstream on the first push of a branch', () => {
    expect(pushArgv('feature/x', false)).toEqual(['push', '--set-upstream', 'origin', 'feature/x'])
    expect(pushArgv('feature/x', true)).toEqual(['push'])
  })

  it('never force-pushes', () => {
    for (const hasUpstream of [true, false]) {
      const argv = pushArgv('main', hasUpstream)
      expect(argv).not.toContain('--force')
      expect(argv).not.toContain('-f')
      expect(argv).not.toContain('--force-with-lease')
    }
  })

  it('refuses to push a branch whose name git would read as a flag', () => {
    expect(() => pushArgv('--delete', false)).toThrow(/branch/i)
  })

  it('turns off every credential prompt', () => {
    // With stdin ignored, an interactive prompt does not fail — it blocks, and
    // it blocks the host process, not just the drawer.
    expect(NON_INTERACTIVE_ENV.GIT_TERMINAL_PROMPT).toBe('0')
    expect(NON_INTERACTIVE_ENV.GCM_INTERACTIVE).toBe('never')
    expect(NON_INTERACTIVE_ENV.GIT_ASKPASS).toBe('')
    expect(NON_INTERACTIVE_ENV.SSH_ASKPASS).toBe('')
  })
})

describe('parseTracking', () => {
  const header = (line: string) => `${line}\n M src/index.ts\n`

  it('reads the branch, its upstream and the divergence', () => {
    expect(parseTracking(header('## main...origin/main [ahead 2, behind 3]'))).toEqual({
      branch: 'main', upstream: 'origin/main', ahead: 2, behind: 3, detached: false,
    })
  })

  it('reports a branch that has no upstream', () => {
    // This is what decides whether push needs --set-upstream, so "no upstream"
    // has to be distinguishable from "upstream, zero ahead".
    expect(parseTracking(header('## wt/feature-cache'))).toEqual({
      branch: 'wt/feature-cache', upstream: null, ahead: 0, behind: 0, detached: false,
    })
  })

  it('reads a one-sided divergence', () => {
    expect(parseTracking(header('## main...origin/main [ahead 5]')).ahead).toBe(5)
    expect(parseTracking(header('## main...origin/main [behind 4]')).behind).toBe(4)
    expect(parseTracking(header('## main...origin/main')).ahead).toBe(0)
  })

  it('recognises a detached HEAD', () => {
    const got = parseTracking(header('## HEAD (no branch)'))
    expect(got.detached).toBe(true)
    expect(got.upstream).toBeNull()
  })

  it('survives output with no branch header at all', () => {
    expect(parseTracking(' M a.ts\n').branch).toBe('')
  })

  it('keeps a branch name containing dots out of the upstream field', () => {
    // `...` separates branch from upstream, but a branch may legitimately
    // contain a dot ("release.2"), so the split cannot be on "." alone.
    expect(parseTracking(header('## release.2...origin/release.2 [ahead 1]'))).toEqual({
      branch: 'release.2', upstream: 'origin/release.2', ahead: 1, behind: 0, detached: false,
    })
  })
})

describe('stageStateOf', () => {
  it('splits the index column from the worktree column', () => {
    expect(stageStateOf('M ')).toEqual({ staged: true, unstaged: false })
    expect(stageStateOf(' M')).toEqual({ staged: false, unstaged: true })
    expect(stageStateOf('MM')).toEqual({ staged: true, unstaged: true })
    expect(stageStateOf('A ')).toEqual({ staged: true, unstaged: false })
  })

  it('counts an untracked file as unstaged only', () => {
    expect(stageStateOf('??')).toEqual({ staged: false, unstaged: true })
  })

  it('treats a conflict as unstaged, never as ready to commit', () => {
    // `UU` has content in the index, so a naive X-column read calls it staged
    // and the drawer would offer to commit a file with conflict markers in it.
    expect(stageStateOf('UU')).toEqual({ staged: false, unstaged: true })
    expect(stageStateOf('AA')).toEqual({ staged: false, unstaged: true })
    expect(stageStateOf('DU')).toEqual({ staged: false, unstaged: true })
  })
})

describe('classifyFailure', () => {
  it('passes a successful command through', () => {
    expect(classifyFailure(0, '', '')).toBeNull()
  })

  it('names an authentication failure', () => {
    expect(classifyFailure(128, 'fatal: Authentication failed for https://github.com/x/y', '')).toBe('auth')
    expect(classifyFailure(128, 'could not read Username for https://github.com: terminal prompts disabled', '')).toBe('auth')
    expect(classifyFailure(128, 'Permission denied (publickey).', '')).toBe('auth')
  })

  it('names a missing upstream', () => {
    expect(classifyFailure(128, 'fatal: no upstream configured for branch \'wt/x\'', '')).toBe('no-upstream')
  })

  it('names a rejected non-fast-forward push', () => {
    expect(classifyFailure(1, 'hint: Updates were rejected because the tip of your current branch is behind', '')).toBe('diverged')
    expect(classifyFailure(1, '! [rejected]        main -> main (fetch first)', '')).toBe('diverged')
  })

  it('names a pull that could not fast-forward', () => {
    expect(classifyFailure(128, 'fatal: Not possible to fast-forward, aborting.', '')).toBe('diverged')
  })

  it('names a merge conflict', () => {
    expect(classifyFailure(1, 'CONFLICT (content): Merge conflict in src/index.ts', '')).toBe('conflict')
  })

  it('names an empty commit', () => {
    expect(classifyFailure(1, '', 'nothing to commit, working tree clean')).toBe('nothing-to-commit')
    expect(classifyFailure(1, '', 'no changes added to commit')).toBe('nothing-to-commit')
  })

  it('names local changes that would be overwritten', () => {
    expect(classifyFailure(1, 'error: Your local changes to the following files would be overwritten by merge:', '')).toBe('dirty')
  })

  it('falls back to unknown rather than guessing', () => {
    expect(classifyFailure(1, 'fatal: something nobody has seen before', '')).toBe('unknown')
  })

  it('names a network failure', () => {
    // Offline and bad-remote-URL are fixable in different places, and neither
    // is git's fault — the catalog asks for a class of its own, not a shrug
    // (TESTS.md D5).
    expect(classifyFailure(128, "fatal: unable to access 'https://example.com/r.git': Could not resolve host: example.com", '')).toBe('network')
    expect(classifyFailure(128, 'fatal: unable to connect to socket: Connection timed out', '')).toBe('network')
  })

  it('leaves a pre-commit hook refusal unknown, so its stderr stays the evidence', () => {
    // A hook's veto matches none of the known failures, and classifying it as
    // dirty or conflict would REPLACE the hook's own message with a wrong
    // hint. `unknown` keeps the raw stderr as the thing the user reads
    // (TESTS.md D7).
    expect(classifyFailure(1, 'pre-commit: refusing commit (found TODO)', '')).toBe('unknown')
  })
})

describe('tracking header corners', () => {
  it('reads an unborn branch header as the branch name', () => {
    // Fresh `git init`: the header is "## No commits yet on main" (captured
    // from a real unborn repository). The sync bar wants "main", not the
    // whole English sentence, and divergence stays zero — there is nothing
    // to be ahead of (TESTS.md I1).
    expect(parseTracking('## No commits yet on main\n?? first.txt\n')).toEqual({
      branch: 'main', upstream: null, ahead: 0, behind: 0, detached: false,
    })
  })
})

describe('decodesAsUtf8', () => {
  it('accepts ASCII and real UTF-8', () => {
    expect(decodesAsUtf8(Buffer.from('plain ascii\n'))).toBe(true)
    expect(decodesAsUtf8(Buffer.from('中文注释 — em dash\n', 'utf8'))).toBe(true)
    expect(decodesAsUtf8(Buffer.from(''))).toBe(true)
  })

  it('rejects GBK, which carries no NUL byte and so passes the binary sniff', () => {
    // "中文注释" as GBK. This is the corruption case: the editor would decode
    // it to U+FFFD and write those back over every non-ASCII byte.
    const gbk = Buffer.from([0xD6, 0xD0, 0xCE, 0xC4, 0xD7, 0xA2, 0xCA, 0xCD, 0x0A])
    expect(isBinaryPrefix(gbk, 8000)).toBe(false)
    expect(decodesAsUtf8(gbk)).toBe(false)
  })

  it('rejects Latin-1 and Shift JIS text too', () => {
    expect(decodesAsUtf8(Buffer.from([0x63, 0x61, 0x66, 0xE9, 0x0A]))).toBe(false) // café
    expect(decodesAsUtf8(Buffer.from([0x93, 0xFA, 0x96, 0x7B, 0x0A]))).toBe(false) // 日本
  })

  it('rejects a truncated multi-byte sequence', () => {
    expect(decodesAsUtf8(Buffer.from([0xE4, 0xB8]))).toBe(false)
  })

  it('accepts a UTF-8 BOM, which is valid UTF-8', () => {
    expect(decodesAsUtf8(Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from('x\n')]))).toBe(true)
  })
})
