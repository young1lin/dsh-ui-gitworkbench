import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // `worktree_enter` checks worktrees out under .agents/worktrees/, each a full
    // copy of this repository — tests included. Without this exclusion a run
    // collects every worktree's copy of the suite alongside the real one, so the
    // counts multiply and a stale branch's tests are reported as if they were
    // this working tree's. `.claude/worktrees` is the symlink view Claude Code
    // keeps of the same directories, and is excluded for the same reason.
    exclude: ['**/node_modules/**', '**/lib/**', '.agents/**', '.claude/**'],
  },
})
