import { describe, expect, it } from 'vitest'

import { PLAIN, fileIcon } from '../src/client/file-icon.ts'

describe('fileIcon', () => {
  it('gives each language its own colour and monogram', () => {
    expect(fileIcon('samples/go/taskqueue/pool.go')).toEqual({ mono: 'GO', color: '#00add8' })
    expect(fileIcon('src/main/java/Main.java').mono).toBe('J')
    expect(fileIcon('src/queue.ts').mono).toBe('TS')
    expect(fileIcon('src/queue.rs').mono).toBe('RS')
  })

  it('reads only the last path segment', () => {
    // A directory called `go` must not make every file in it a Go file.
    expect(fileIcon('go/notes.md').mono).toBe('MD')
    expect(fileIcon('a/b/c/script.py').mono).toBe('PY')
  })

  it('is case-insensitive about the extension', () => {
    expect(fileIcon('Main.JAVA')).toEqual(fileIcon('main.java'))
    expect(fileIcon('README.MD')).toEqual(fileIcon('readme.md'))
  })

  it('lets a whole-name match beat the extension', () => {
    // package.json is npm's file before it is a JSON file — the name is the
    // more specific fact, so it wins.
    expect(fileIcon('package.json').mono).toBe('NP')
    expect(fileIcon('data.json').mono).toBe('JN')
    expect(fileIcon('Cargo.toml').mono).toBe('RS')
    expect(fileIcon('settings.toml').mono).toBe('TM')
  })

  it('knows the files that carry their type in their name', () => {
    expect(fileIcon('Dockerfile').mono).toBe('DK')
    expect(fileIcon('Makefile').mono).toBe('MK')
    expect(fileIcon('deploy/Dockerfile').mono).toBe('DK')
  })

  it('treats a dotfile name as a name, not as a suffix', () => {
    // `.gitignore` has no extension; splitting on the dot would call it a
    // "gitignore" language and, worse, would make `.env` look like a file
    // called nothing with an env suffix.
    expect(fileIcon('.gitignore').mono).toBe('GI')
    expect(fileIcon('.unknownrc')).toEqual(PLAIN)
  })

  it('falls back to plain for a type it has nothing to say about', () => {
    expect(fileIcon('notes.wat')).toEqual(PLAIN)
    expect(fileIcon('binary')).toEqual(PLAIN)
    expect(fileIcon('')).toEqual(PLAIN)
  })

  it('gives sibling extensions of one language the same paint', () => {
    expect(fileIcon('a.yml')).toEqual(fileIcon('a.yaml'))
    expect(fileIcon('a.mjs')).toEqual(fileIcon('a.js'))
    expect(fileIcon('a.zsh')).toEqual(fileIcon('a.sh'))
  })

  it('keeps every monogram short enough to render at 16px', () => {
    // Two characters is the budget; three would need a smaller face than the
    // rest of the tree, and the icons must sit on one optical band.
    const seen = new Set<string>()
    for (const name of ['a.go', 'a.java', 'a.tsx', 'a.cs', 'a.cpp', 'Dockerfile', 'package.json', '.gitignore']) {
      const { mono } = fileIcon(name)
      expect(mono.length).toBeGreaterThan(0)
      expect(mono.length).toBeLessThanOrEqual(2)
      seen.add(mono)
    }
    expect(seen.size).toBeGreaterThan(1)
  })
})
