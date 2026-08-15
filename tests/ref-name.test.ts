import { describe, expect, it } from 'vitest'
import { isRefName } from '../src/worktree.js'

describe('isRefName', () => {
  it('accepts the branch names a repository actually uses', () => {
    for (const ref of ['main', 'master', 'wt/feature-cache', 'release/v1.2.3', 'fix-i18n', 'a']) {
      expect(isRefName(ref), ref).toBe(true)
    }
  })

  it('rejects a leading dash, which git would read as an option', () => {
    // `git diff --numstat --no-renames <ref>`: a ref of `--output=/etc/passwd`
    // would stop being a ref at all.
    expect(isRefName('--output=x')).toBe(false)
    expect(isRefName('-main')).toBe(false)
  })

  it('rejects range syntax, which would silently change what is compared', () => {
    expect(isRefName('main..head')).toBe(false)
    expect(isRefName('main...head')).toBe(false)
    expect(isRefName('..')).toBe(false)
  })

  it('rejects shell and path characters outside a ref name', () => {
    for (const ref of ['main;rm -rf /', 'main branch', 'main$(id)', 'main|tee', 'main\\head', 'main"x', "main'x"]) {
      expect(isRefName(ref), ref).toBe(false)
    }
  })

  it('rejects the empty string and an oversized value', () => {
    expect(isRefName('')).toBe(false)
    expect(isRefName('a'.repeat(200))).toBe(true)
    expect(isRefName('a'.repeat(201))).toBe(false)
  })
})
