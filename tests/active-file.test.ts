import { describe, expect, it } from 'vitest'
import { NO_PATHS, preferredFile } from '../src/client/active-file.ts'

const files = (...paths: string[]): { path: string }[] => paths.map(path => ({ path }))

describe('preferredFile', () => {
  it('falls back to the first file with no filter and no selection', () => {
    expect(preferredFile(files('a.ts', 'b.ts'), NO_PATHS, null)).toBe('a.ts')
  })

  it('returns null when the view has no files', () => {
    expect(preferredFile([], NO_PATHS, null)).toBe(null)
    expect(preferredFile([], ['src'], 'gone.ts')).toBe(null)
  })

  it('keeps a selection this view still lists', () => {
    expect(preferredFile(files('a.ts', 'b.ts'), NO_PATHS, 'b.ts')).toBe('b.ts')
  })

  it('drops a selection this view does not list', () => {
    expect(preferredFile(files('a.ts', 'b.ts'), NO_PATHS, 'gone.ts')).toBe('a.ts')
  })

  it('opens on the filtered file rather than the first one', () => {
    // The reported bug: filtering by one file and clicking a commit opened
    // whatever sorted first in it.
    const commit = files('CHANGELOG.md', 'src/other.ts', 'xx/aa/dd.ts')
    expect(preferredFile(commit, ['xx/aa/dd.ts'], null)).toBe('xx/aa/dd.ts')
  })

  it('an explicit selection outranks the filter', () => {
    const commit = files('CHANGELOG.md', 'xx/aa/dd.ts')
    expect(preferredFile(commit, ['xx/aa/dd.ts'], 'CHANGELOG.md')).toBe('CHANGELOG.md')
  })

  it('a stale selection gives way to the filter, not to the first file', () => {
    const commit = files('CHANGELOG.md', 'xx/aa/dd.ts')
    expect(preferredFile(commit, ['xx/aa/dd.ts'], 'not/in/this/commit.ts')).toBe('xx/aa/dd.ts')
  })

  it('matches a file under a filtered directory', () => {
    const commit = files('README.md', 'src/deep/nested/x.ts')
    expect(preferredFile(commit, ['src'], null)).toBe('src/deep/nested/x.ts')
  })

  it('a directory spec does not match a sibling sharing its prefix', () => {
    // `src` must not select `srcutil.ts` — the boundary is the separator.
    const commit = files('srcutil.ts', 'src/x.ts')
    expect(preferredFile(commit, ['src'], null)).toBe('src/x.ts')
  })

  it('a spec naming a file matches that file exactly', () => {
    const commit = files('a/b.ts')
    expect(preferredFile(commit, ['a/b.ts'], null)).toBe('a/b.ts')
  })

  it('an exactly-named file beats one that only sits under a filtered directory', () => {
    // Both are in the filter, and the commit touches both. The reader named
    // `src/a.ts`; `docs` is a region they named nothing inside of.
    const commit = files('docs/intro.md', 'src/a.ts')
    expect(preferredFile(commit, ['docs', 'src/a.ts'], null)).toBe('src/a.ts')
  })

  it('ties inside one tier go to the file order, not the filter order', () => {
    const commit = files('a.ts', 'b.ts', 'c.ts')
    // Filter order deliberately reversed: the topmost matching ROW must win,
    // because that order is the one the reader can actually see.
    expect(preferredFile(commit, ['c.ts', 'a.ts'], null)).toBe('a.ts')
  })

  it('falls back to the first file when nothing in the commit matches', () => {
    const commit = files('CHANGELOG.md', 'package.json')
    expect(preferredFile(commit, ['src/never.ts'], null)).toBe('CHANGELOG.md')
  })

  it('a filtered path that is a whole directory tree still prefers its deepest hit', () => {
    const commit = files('z.md', 'xx/aa/dd.ts', 'xx/bb/ee.ts')
    expect(preferredFile(commit, ['xx'], null)).toBe('xx/aa/dd.ts')
  })
})
