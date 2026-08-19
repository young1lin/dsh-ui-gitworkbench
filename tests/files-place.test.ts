import { describe, expect, it } from 'vitest'

import { NO_PLACE, openAt, placeAt, reconcilePlace, toggleDir, withPlace, type FilesPlace, type FilesPlaces } from '../src/client/files-place.ts'
import { pathKey } from '../src/client/worktree-view.ts'

const place = (over: Partial<FilesPlace> = {}): FilesPlace => ({ ...NO_PLACE, ...over })

describe('openAt', () => {
  it('selects the file and opens every folder above it', () => {
    expect(openAt(NO_PLACE, 'src/client/themes.ts')).toEqual({
      open: 'src/client/themes.ts',
      expanded: ['src', 'src/client'],
      query: '',
      blameOn: false,
    })
  })

  it('keeps folders that were already open', () => {
    const out = openAt(place({ expanded: ['docs'] }), 'src/a.ts')
    expect([...out.expanded].sort()).toEqual(['docs', 'src'])
  })

  it('does not duplicate a folder that is already open', () => {
    const out = openAt(place({ expanded: ['src'] }), 'src/a.ts')
    expect(out.expanded).toEqual(['src'])
  })

  it('opens a root-level file without expanding anything', () => {
    expect(openAt(NO_PLACE, 'package.json').expanded).toEqual([])
  })

  it('leaves the search and the blame toggle alone', () => {
    const out = openAt(place({ query: 'que', blameOn: true }), 'src/a.ts')
    expect(out.query).toBe('que')
    expect(out.blameOn).toBe(true)
  })
})

describe('toggleDir', () => {
  it('opens a folded directory and folds an open one', () => {
    const opened = toggleDir(NO_PLACE, 'src')
    expect(opened.expanded).toEqual(['src'])
    expect(toggleDir(opened, 'src').expanded).toEqual([])
  })

  it('leaves the selection alone', () => {
    expect(toggleDir(place({ open: 'a.ts' }), 'src').open).toBe('a.ts')
  })
})

describe('reconcilePlace', () => {
  const paths = ['src/a.ts', 'src/b.ts', 'docs/readme.md']

  it('keeps a selection the repository still has', () => {
    const held = place({ open: 'src/a.ts', expanded: ['src'] })
    expect(reconcilePlace(held, paths)).toEqual({ place: held, vanished: null })
  })

  it('drops a selection the repository no longer has, and says which', () => {
    // An editor over a file that is not there would render an empty buffer as
    // if the file itself were empty.
    const out = reconcilePlace(place({ open: 'src/gone.ts' }), paths)
    expect(out.place.open).toBeNull()
    expect(out.vanished).toBe('src/gone.ts')
  })

  it('treats an empty list as "not read yet", not as an empty repository', () => {
    // The fetch is in flight for most of the time this runs; blanking the
    // selection on it would clear the selection every time the tab opens.
    const held = place({ open: 'src/a.ts' })
    expect(reconcilePlace(held, [])).toEqual({ place: held, vanished: null })
  })

  it('keeps expanded folders even when they are gone from the list', () => {
    // A directory leaves ls-tree when a branch is checked out or a rebase is
    // halfway through. Re-opening the same six folders every time is the
    // annoyance this exists to remove; a stale entry renders nothing.
    const held = place({ open: 'src/a.ts', expanded: ['src', 'deleted/dir'] })
    expect(reconcilePlace(held, paths).place.expanded).toEqual(['src', 'deleted/dir'])
  })

  it('does nothing when nothing is open', () => {
    const held = place({ expanded: ['src'] })
    expect(reconcilePlace(held, paths)).toEqual({ place: held, vanished: null })
  })

  it('keeps the search and the blame toggle across a reconcile', () => {
    const held = place({ open: 'src/gone.ts', query: 'que', blameOn: true })
    const out = reconcilePlace(held, paths)
    expect(out.place.query).toBe('que')
    expect(out.place.blameOn).toBe(true)
  })

  it('reports a file that was added and then removed again as vanished once', () => {
    const first = reconcilePlace(place({ open: 'new.ts' }), paths)
    expect(first.vanished).toBe('new.ts')
    // With the selection now cleared, a second pass has nothing to report.
    expect(reconcilePlace(first.place, paths).vanished).toBeNull()
  })
})

describe('places per worktree', () => {
  it('keeps each worktree place apart', () => {
    // A worktree IS a different place: different files, at different paths,
    // and the open one may not exist in the other at all.
    let places: FilesPlaces = new Map()
    places = withPlace(places, 'C:/repo/a', place({ open: 'src/a.ts', expanded: ['src'] }))
    places = withPlace(places, 'C:/repo/b', place({ open: 'lib/b.ts' }))
    expect(placeAt(places, 'C:/repo/a').open).toBe('src/a.ts')
    expect(placeAt(places, 'C:/repo/b').open).toBe('lib/b.ts')
    expect(placeAt(places, 'C:/repo/a').expanded).toEqual(['src'])
  })

  it('hands a worktree nobody has visited an empty place', () => {
    expect(placeAt(new Map(), 'C:/repo/fresh')).toEqual(NO_PLACE)
  })

  it('does not mutate the map it was given', () => {
    const before: FilesPlaces = new Map([['k', place({ open: 'a.ts' })]])
    const after = withPlace(before, 'k', place({ open: 'b.ts' }))
    expect(placeAt(before, 'k').open).toBe('a.ts')
    expect(placeAt(after, 'k').open).toBe('b.ts')
  })

  it('keys the same worktree once however its path was spelled', () => {
    // git reports forward slashes; a session cwd arrives with the platform's.
    // The separator is built rather than written: a backslash in a literal
    // here is an escape sequence, which is how this test first went red.
    let places: FilesPlaces = new Map()
    places = withPlace(places, pathKey(['C:', 'repo', 'a'].join(String.fromCharCode(92))), place({ open: 'src/a.ts' }))
    expect(placeAt(places, pathKey('C:/repo/a/')).open).toBe('src/a.ts')
  })

  it('treats an absent path as a real key, not as no key', () => {
    // '' names the session's own repository — the source the drawer starts on.
    const places = withPlace(new Map(), pathKey(undefined), place({ open: 'a.ts' }))
    expect(placeAt(places, pathKey(null)).open).toBe('a.ts')
  })
})
