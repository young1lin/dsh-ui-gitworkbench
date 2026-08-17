# Changelog

User-facing changes, newest first. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows SemVer.

## [0.1.1] - 2026-08-17

### Fixed

- **`worktree_enter` rejected names git accepts.** `+` is legal in both git refs and NTFS directories, but the old allowlist `[A-Za-z0-9._-]{1,40}` refused it — a real `feature+20260810-...` was silently rewritten to a generated `wt-<hex>`. The charset is now the intersection of git's ref rules and Windows' directory rules: `+` allowed; `..`, trailing dots, `.lock` endings, Windows reserved device names (CON/NUL/COM1-9/LPT1-9, checked before the first dot, case-insensitive) and `head` refused; must start alphanumeric; cap raised to 64 characters.
- **No forced `wt/` branch prefix.** A freshly created worktree's branch is the name verbatim, and the generated fallback name is `worktree-<hex>` — no `wt` anywhere, at any layer.
- **Reuse now matches on real paths.** When the target directory already holds a registered worktree — one made by another tool, or reached through a junction (`.agents/worktrees` pointing at `.claude/worktrees`) where git lists a different spelling — the session binds to it and **keeps its own branch**, instead of unconditionally running `git worktree add` into a `fatal: ... already exists`.
- CI: `pnpm/action-setup` no longer declares a pnpm version in the workflows — `package.json`'s `packageManager` is the single source of truth (specifying both aborts the action).

### Added

- Optional `branch` field on session bindings: the system prompt and the status-card badge state the bound worktree's real branch instead of deriving one; records written before the field existed remain valid.
- Syntax highlighting for **SQL, XML (xsl/xsd/svg), INI (properties/conf/cfg), and diff (patch)** files in the diff view.
- The Chinese README was rewritten (the official plugin command now leads the install section, one-liner scripts demoted to an alternative) and an idiomatic `README_EN.md` was added; both embed the demo video up top.

## [0.1.0] - 2026-08-17

Initial release. A session-header status card (branch / ahead-behind / counts) plus a workbench panel (Changes, History, Compare tabs); per-file diffs with dual line numbers, word-level highlights, and Shiki coloring; ticking a file in the tree is a real stage; a commit box and a fetch / pull / push sync bar; seven theme families × light/dark, background image and custom CSS in project/global scopes; and worktree emulation (`worktree_enter` / `worktree_exit` / `worktree_status` agent tools with per-session bindings). See the [README](./README.md).
