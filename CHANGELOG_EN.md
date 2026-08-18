# Changelog

User-facing changes, newest first. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows SemVer.

## [0.1.5] - 2026-08-18

### Fixed

- **Rolling back a directory row failed outright (`EISDIR`)**. `git status` will not descend into another repository: a nested untracked repo is reported as a single `?? sub/` line even under `--untracked-files=all`, and that row names a **directory**. The delete step lacked `recursive`, so it was the one row in the drawer whose roll-back died with `EISDIR`. The delete now lives in its own module (`src/fs-remove.ts`) with tests over both the path checks and the real filesystem behaviour.
- **A failed roll-back no longer looks like a dead button**. Asking the host what rolling a file back would do used to return the same value whether it failed or whether git simply reported nothing to roll back, and both ended in a silent refresh. Failure now puts git's own words in the operation banner; "nothing to roll back" still just refreshes, since the row disappearing is both the feedback and the fix.
- **A transport error no longer strands the drawer mid-question**. A throw from the plan request had no handler: the dialog never opened and the state never cleared, leaving no way out but closing the drawer.
- **An unrecognised consequence now always confirms**. Only an explicit `irreversible: false` from the host (recovering a deleted file) skips the dialog; an effect newer than this bundle no longer reads a missing flag as "reversible" and act on it silently.

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
- **Filter the file list by typing at it**: a magnifier in the tree toolbar opens a filter row — in the changes tree, in a commit's files under History, and in Compare. A commit that touched 140 files is a scroll, not a list.
  - **Space-separated terms are ANDed, in any order**: `panel css` finds `src/client/GitWorkbenchPanel.module.css`, which is how anyone types when they half-remember a path — and is what a single-substring match gets wrong for exactly the paths long enough to need filtering.
  - **Smart case**: an all-lowercase query ignores case, and the moment you type a capital it counts. `README` should not match `readme-generator`; `readme` should still find `README.md`. Decided per term, not for the whole query.
  - The count reports the narrowing (`2 / 6 files`); a filtered tree **ignores the fold state**, since matches hidden behind a directory collapsed twenty minutes ago read as "no matches"; the root tick acts on the **visible rows only** (a tick IS a git call, and "stage all" must not reach past a filter into files the pane is hiding); closing the box clears the query, because a hidden box still holding one leaves the pane filtered with its only explanation folded away; and switching commit or worktree clears it too, or a query typed against one commit hides most of the next one with nothing on screen saying why.
- **Roll one file back (IDEA's Rollback)**: hovering a row in the changes tree reveals a roll-back button that takes that one file to its committed state — a modification restored, a never-committed file deleted, a deleted file recovered, a rename undone. IDEA's semantics: it **does not ask about staging**, and takes the index and the working tree back together. Directories deliberately get no such gesture — the irreversible action does not get an entry point that can take a subtree with it.
  - **The dialog states the consequence, not "are you sure"**: the click does not act. It asks the host what rolling this file back WOULD do, and that answer supplies the wording. A row in the drawer is a poll old, and the difference between "goes back to its committed content" and "leaves the disk and cannot come back" is the entire subject of the question — which is exactly what a stale row gets wrong. Recovering a deleted file shows no dialog at all: a confirmation in front of a pure gain is how people learn to click through confirmations.
  - **The host does not trust the client's account of the file**: the plan is re-derived from a fresh whole-tree `git status` before anything runs (whole-tree, not a pathspec: git pairs a deletion with an addition to see a rename, and admitting only one half turns "undo the rename" into "restore one, DELETE the other"). If the file changed while the dialog was open, the freshly derived consequence no longer matches the one you agreed to, and nothing is done.
  - **No destructive spelling anywhere in the path**: no `clean`, no `reset --hard`, no `checkout -f`, no `--force` — only `git restore` with a single pathspec after `--`. Deletes go through the filesystem, and a path is refused if it is absolute, carries a drive letter or UNC prefix, or holds any `..` segment; the resolved path is re-checked against the worktree root immediately before the file is removed. A unit test scans every plan this module can produce to hold that line.

### Fixed

- **Bare-date timezone roulette**: on Windows, git's parse of a bare `--since=2026-08-18` can exclude that very day's commits; the host now expands `yyyy-mm-dd` to the whole day (`T00:00:00` / `T23:59:59`).
- **A failed log no longer masquerades as "no match"**: an invalid regex or date shows `git log failed (exit N): <stderr>` in the empty state.
- **The author roster once used `--all` while the list walked one ref**: people visible in the menu could be unmatchable forever (with a Chinese author whose commits all live on other branches this read convincingly as "Chinese filtering is broken" — layer-by-layer probing proved the pattern reaches git intact; branch coverage was the whole story).
- The funnel button joined the shared button vocabulary (modifier specificity fixed); the filter box fills the pane head.
- **The date presets were unthemed native buttons**: `.funnelPreset` never joined the shared button vocabulary, so Today / Last 7 days / Last 30 days rendered as the browser's default grey buttons — the one patch of foreign chrome in the drawer, with the third one clipped by the panel's width.
- **The calendar followed the browser's language, not the drawer's**: the month title and weekday row came from `Intl.DateTimeFormat(undefined, …)`, so an English drawer on a zh-CN machine printed "2026年8月" over 一二三四五六日. The tag now comes from the dictionary itself (`filterLocale`).
- **The funnel popup, reworked**: the panel used to scroll itself AND cap its list at 240px — one scrollbar nested in a 331px box while the anchor had left ~750px available; it is now a flex column with a single scrolling child and the list takes the height that was already there (9 authors per screen became 28). Native checkboxes became tokenised tri-state ticks (a bar for partial); directories gained the folder glyph files already had, so names line up in one column; indentation stopped being double-counted by `.pathChildren`'s margin (29px per level → 14px), which also retired the indent rail drawn in `--gs-border-soft` over `--gs-panel` (the same value as `--gs-raise` in the GitHub palettes, so it vanished under hover). The tab strip is a segmented control, After/Before is a captioned rect track that no longer mimics it, the calendar tints the days between the bounds, and the popup gained a footer — "N selected / Clear all" — where the only feedback used to be the chip row the popup covers.
- **A path-filtered commit did not open on the filtered file**: the fallback selection was always "the commit's first file", filter or no filter — so `path:xx/aa/dd.ts` narrowed the list to commits about that file, and clicking one opened whatever sorted first while the file the filter was ABOUT sat unhighlighted. The order now (`active-file.ts`, pure): **the existing selection** (an explicit click outranks the filter, and stepping down the filtered list stays put — which is the point of filtering) → **a file the filter names exactly** (ticking `xx/aa/dd.ts` is a statement about a file; ticking `xx` is one about a region, and the more specific intent wins) → **a file under a filtered directory** → **the first file** (the old behaviour). Ties inside a tier go to the commit's own file order, so the highlight lands on the topmost matching row — not to filter order, which is an artifact of ticking sequence and is never shown.
- **Folder and file icons now appear everywhere files are listed** (the changes tree, the history commit tree, compare), where only the filter's path tree had them; the file row's status badge moved from the head of the row to its tail, beside the line counts, so the row does not lead with two glyphs.
- **The path tree's folder and file icons follow IntelliJ's New UI idiom**: the CSS-border boxes became inline SVG — a 16px grid, 1px strokes, no fill, rounded joins, outlines where the old UI shipped filled silhouettes. Both share one 16px slot so folder and file names line up in a single column, and every straight edge sits on a .5 coordinate so the stroke lands on one pixel instead of straddling two. Still hand-drawn shapes in that language, not an icon package (bundle purity gate).

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
