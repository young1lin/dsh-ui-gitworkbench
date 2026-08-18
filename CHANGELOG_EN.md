# Changelog

User-facing changes, newest first. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows SemVer.

## [0.1.4] - 2026-08-18

### Added

- **History: who, and exactly when.** Rows show the author beside the abbreviated hash; the hover card adds author, committer (only when git recorded someone other than the author — rebases, cherry-picks, maintainer-applied patches), and the exact commit time (`%cI`, rendered in your browser's own timezone — no more "3 weeks ago" as the only answer).
- **IDEA-style pushdown history filtering**: criteria compile straight into `git log` arguments (`--author` / `--grep` / `--since` / `--until` / pathspecs) and match over **all history** before paging — not just the pages already on screen. A filtered page is still one contiguous walk, so the lane graph stays on. Matching is case-insensitive throughout; literals are regex-escaped (`a.b` matches `a.b`); the text criterion has a regex toggle.
- **Query-box grammar**: `user:name` (repeatable, OR), `path:dir`, `after:` / `before:` dates (git approxidate — "2 weeks ago" works), bare words match the message; recognized criteria render as removable chips with a one-click *Clear all*; quotes wrap values with spaces.
- **"Filter by" funnel with section tabs** (Users N / Date • / Paths N — constant height, each tab carries its own active-criteria count):
  - **Users**: multi-select from `git shortlog` (counts, fuzzy search, busiest 500 with the cap stated) — walking the **current ref**, so everyone listed is findable;
  - **Date**: presets (Today / Last 7 / Last 30 days) plus a **hand-rolled calendar** (month navigation, today accent, neighbouring-month days, After/Before toggle arming which bound a click lands in, per-bound clear — the native date widget is dated on Windows and the bundle's purity gate forbids libraries; the grid is a pure function styled entirely in theme tokens);
  - **Paths**: a directory tree **with file leaves** ("when did this file change" in one tick; a directory past 100 files truncates visibly) plus a search box (flat results, files first, case-insensitive over the full path, root-level files included). Ticking is **tri-state checkbox-tree** semantics: a folder tick covers and visibly checks everything under it and absorbs files already ticked inside it (one chip, the folder's); unticking a file under a checked folder cascades out to its siblings; folders show a partial state.
- **The history ref picker gains "All branches"**: finding what someone did no longer requires knowing which branch holds it; the roster follows.
- Typing and ticking write the SAME filter (both ways), debounced 300ms, in-flight requests cancelled, criteria changes reset to page 0.

### Fixed

- **Bare-date timezone roulette**: on Windows, git's parse of a bare `--since=2026-08-18` can exclude that very day's commits; the host now expands `yyyy-mm-dd` to the whole day (`T00:00:00` / `T23:59:59`).
- **A failed log no longer masquerades as "no match"**: an invalid regex or date shows `git log failed (exit N): <stderr>` in the empty state.
- **The author roster once used `--all` while the list walked one ref**: people visible in the menu could be unmatchable forever (with a Chinese author whose commits all live on other branches this read convincingly as "Chinese filtering is broken" — layer-by-layer probing proved the pattern reaches git intact; branch coverage was the whole story).
- The funnel button joined the shared button vocabulary (modifier specificity fixed); the filter box fills the pane head.

### Changed

- Person search matches the **author only** (IDEA parity; git has no author-OR-committer pushdown). The committer stays visible in the hover card.

## [0.1.3] - 2026-08-18

### Fixed

- **A bare `npm i @young1lin/dsh-ui-gitworkbench` in an empty directory died with E404 (`@deepseek-ai/dsh-compact` not found).** Every peerDependency was `*`, and when npm 7+ auto-installs a peer, `*` resolves through the **`latest` dist-tag** — which every `@deepseek-ai/*` package still points at the August 10 `0.0.1-rc.1` line, whose dependency on `dsh-compact` was never published to npm. Any install outside a dsh profile workspace therefore 404ed (dsh's 0.1.0-rc.7 release on August 17 sent more people into fresh-environment installs and into the trap). Peer ranges are now explicit — cordis `^4.0.1-rc.1`, the dsh packages `^0.1.0-rc.2` — so resolution no longer consults dist-tags; the `0.1.0-rc` dependency chain is verified to resolve standalone. The official channel, `dsh plugin --profile web add`, was never affected (the profile workspace already carries the peers). **Workaround while on 0.1.2**: `npm i @young1lin/dsh-ui-gitworkbench --legacy-peer-deps`.

## [0.1.2] - 2026-08-17

### Fixed

- **The session-header stats card no longer freezes while the drawer is shut.** Through a whole agent turn of edits, the chip's file count, +/− line totals and ahead/behind markers kept showing pre-turn numbers until you opened the drawer and forced a refresh. The chip now tracks the `running` signal dsh mirrors live in the sessions store: the moment a turn ends — when agent side effects have settled — it fetches fresh stats on its own, without resetting the drawer's tree expansion or flashing a loading placeholder. Mid-turn it does not churn (numbers land once, at the end) and idle sessions stay free of polling. Ahead/behind ride in the same payload, so the ↑ count catches up right after the agent commits. Out-of-session edits (your editor, other shells) still wait for the drawer to open, as before.

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
