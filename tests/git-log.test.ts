import { describe, expect, it } from 'vitest'
import { commitMessageText, parseLog } from '../src/git-log.ts'

const RS = '\x1e'
const US = '\x1f'

/** One LOG_FORMAT record: hash, when, subject, parents, refs, body. */
function record(hash: string, when: string, subject: string, parents = '', refs = '', body = ''): string {
  return [RS, hash, US, when, US, subject, US, parents, US, refs, US, body].join('')
}

describe('parseLog', () => {
  it('reads a one-line subject with an empty body', () => {
    const commits = parseLog(record('33c7e30', '3 hours ago', 'chore: store README', 'bad6090'))
    expect(commits).toEqual([
      {
        hash: '33c7e30', when: '3 hours ago', subject: 'chore: store README',
        body: '', parents: ['bad6090'], refs: [],
      },
    ])
  })

  it('keeps a multi-line body inside one record', () => {
    const stdout = [
      record(
        'abc1234', 'yesterday',
        'docs(worktree): align spec bundle size with final-HEAD regression run',
        'def5678', '',
        '\nThe fixture grew past the cap after the README landed.\n\nKeep the bundle\nunder the limit.\n',
      ),
      record('def5678', '2 days ago', 'fix: i18n', '0000000'),
    ].join('')
    const commits = parseLog(stdout)
    expect(commits).toHaveLength(2)
    expect(commits[0]!.subject).toMatch(/^docs\(worktree\)/)
    expect(commits[0]!.body).toContain('Keep the bundle')
    expect(commits[0]!.body).toContain('\n')
    expect(commits[1]).toMatchObject({ hash: 'def5678', subject: 'fix: i18n', body: '' })
  })

  it('reads both parents of a merge, first parent first', () => {
    // Order is the whole meaning of %p: the first parent is the branch being
    // merged INTO, and the graph draws it as the lane that continues.
    const commits = parseLog(record('m0merge', 'now', "Merge branch 'feature'", 'aaa1111 bbb2222'))
    expect(commits[0]!.parents).toEqual(['aaa1111', 'bbb2222'])
  })

  it('gives a root commit no parents rather than an empty string', () => {
    const commits = parseLog(record('r00t', '3 years ago', 'initial commit', ''))
    expect(commits[0]!.parents).toEqual([])
  })

  it('strips git decoration syntax down to bare names', () => {
    const commits = parseLog(record(
      'abc1234', 'now', 'feat: x', 'def5678',
      'HEAD -> main, origin/main, tag: v1.2.0',
    ))
    expect(commits[0]!.refs).toEqual(['main', 'origin/main', 'v1.2.0'])
  })

  it('reports no refs for the commits that carry none', () => {
    expect(parseLog(record('abc1234', 'now', 'feat: x', 'def5678'))[0]!.refs).toEqual([])
  })

  it('drops a remote HEAD, which never says anything the branch beside it does not', () => {
    // origin/HEAD is symbolic: it points wherever origin's default branch does,
    // so it is always a duplicate label on a commit that already has the real one.
    const commits = parseLog(record(
      'abc1234', 'now', 'feat: x', 'def5678',
      'HEAD -> master, origin/master, origin/HEAD, upstream/HEAD, wt/smoke',
    ))
    expect(commits[0]!.refs).toEqual(['master', 'origin/master', 'wt/smoke'])
  })
})

describe('commitMessageText', () => {
  it('is just the subject when there is no body', () => {
    expect(commitMessageText({ hash: 'a', subject: 'one line', when: '', body: '' })).toBe('one line')
  })

  it('joins subject and body with a blank line', () => {
    expect(commitMessageText({
      hash: 'a', subject: 'docs: foo', when: '', body: 'More detail.\nSecond paragraph.',
    })).toBe('docs: foo\n\nMore detail.\nSecond paragraph.')
  })
})
