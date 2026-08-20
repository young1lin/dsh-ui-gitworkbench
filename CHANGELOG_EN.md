# Changelog

User-facing changes, newest first. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows SemVer.

## [0.1.10] - 2026-08-20

A performance release: what the drawer costs no longer depends on how long the file is.

### Performance

- **Long files open without freezing, and long files have syntax colour again.** The editor — the Files tab, and the side pane once editing is armed — used to hand shiki the WHOLE file: 1,637ms on 1,837 lines of real TypeScript, and files past 2,000 lines were simply not coloured, with a notice explaining why. That is not a fix; it is a freeze traded for a missing feature. The editor now asks only for the lines it is about to show, driven by CodeMirror's own viewport, and the 2,000-line cap went with the notice. Measured at 1,837 lines: **1,461ms with a 1,274ms frozen frame becomes 254ms with 60ms**. A 6,065-line file used to be fast and colourless; it is now **255ms, with colour**.
- **No line is ever tokenized twice.** Every window move used to re-lex a 240-line lead-in plus its rows and remember nothing — ten screenfuls cost 3,021ms. The new `token-cache.ts` cuts a document into 128-line chunks, tokenizes each once, and **continues from the grammar state the previous chunk ended in** (shiki 4.3 returns that state with the tokens and accepts it back, so the continuation is exact rather than a lead-in's guess). Only a cold jump into the middle of a file reads a lead-in, and only once. The diff panes' second pass — re-lexing each line alone, which has to exist because a hunk is not a real file and would otherwise paint added statements as object keys — depends on nothing but the line's text, so it is cached by it. **Scrolling back over a file: 77ms, no dropped frame.** Both caches are LRU, bounded in LINES, and report their own size, so the tests prove the bound rather than trusting it.
- **Changing the engine does not help — that was measured, not assumed.** Five shiki engine configurations (eager compilation, ES2024 and ES2018 targets, an internal cache) all landed between 130ms and 180ms for 300 lines of real code. Half a millisecond per line is this tokenizer's floor, so the only lever is to tokenize less and remember it — the two entries above.

### Fixed

- **Opening a second file froze for seven to nine seconds** — which is also what was really behind "clicking a 4,000-line file after a 22-line one nearly locks up". A CPU profile named `@codemirror/merge`'s diff. Switching files replaces the buffer and the side it is compared against in two separate transactions, so for one frame the new file's text sits opposite the OLD file's: two unrelated documents, diffed with no ceiling. The live tint now recomputes only once both sides have settled (by which point they are usually identical and it returns immediately), and `presentableDiff` is given the bound CodeMirror's own merge view uses (`scanLimit: 500`, plus a 100ms timeout). Without that bound, the pair in the new test takes **292 seconds**. Measured: a file switch goes from **6,952-8,974ms to 270-357ms**, and the text arrives painted.
- **Nothing document-sized runs on the keystroke path any more.** The live tint used to diff the whole document on EVERY transaction — 709ms per keystroke at 4,000 lines. Colour and tint now map through the edit (so they ride along with the text instead of smearing) and recompute once the typing stops.

### Internal

- `tests/no-leaks.test.ts`: per client source, every `addEventListener` has a `removeEventListener`, every `setInterval` a `clearInterval`, every observer a `disconnect`, and the CodeMirror layer's deferred timer — the one React's cleanup cannot reach — is cleared in `destroy()`. Comments and string literals are stripped before counting.
- `AGENTS.md` gains a "Performance first, and no leaks" section: nothing proportional to the file or the repository; a cap that turns a feature off is not a fix; nothing document-sized on the keystroke path; caches bounded, evicting, and able to report their size; and a performance change ships with before/after numbers taken on real code.

## [0.1.9] - 2026-08-20

### Performance

- **Long diffs in History and Compare no longer freeze either.** 0.1.8 fixed the side-by-side view in Changes; History and Compare render a unified view, which was left out of that change deliberately and carried the same two costs — every row in the DOM, and Shiki re-lexing every row. Both are windowed now. Measured: a 5,365-row diff costs **157ms, no dropped frame, and 81 rows in the DOM**, while the scroller still reports the full 107,304px. For comparison, the same pane froze for over four seconds on a diff of about 6,000 rows.

## [0.1.8] - 2026-08-20

An urgent fix release: one click that froze the page for three and a half
seconds, and files that showed nothing on the Compare tab.

### Performance

- **Opening a long file no longer freezes the pane.** The side-by-side diff put every line of the whole file into the DOM in two columns, and Shiki re-lexed every one of those lines individually — a cost proportional to the file's LENGTH, with no relation to how much of it changed. Measured on two files with exactly one changed line each: 22 lines cost 349ms, 4,000 lines cost 3,868ms, including **3,587ms during which nothing on the page moved**, with 8,000 cells and 112,000 `<span>`s in the DOM. The guard admits files up to 20,000 lines, five times that again. Only the rows in view are rendered now (spacers stand in for the rest, so the scrollbar is still the length of the FILE), and both Shiki passes run inside that window, with 240 lines of lead-in so a slice starting inside a block comment still lexes in context. The same 4,000-line file: **235ms, worst frame 89ms, 162 cells.** The number that matters is not the ratio — 15,000 lines now costs 327ms and renders the same 162 cells, so the cost is the viewport's rather than the file's. Files of 400 rows or fewer render whole, exactly as before.
- **The poll stops shipping a patch nobody asked for.** `stats` runs every 3 seconds while an agent is working, and each time it ran `git diff HEAD` over the whole worktree and clipped the result to 400,000 characters. Measured on a worktree with 90,000 changed lines: `status` ~110ms, `--numstat` ~140ms, and `git diff HEAD` **595ms producing 7.43MB, of which the clip discarded 94.6%**. The tree and the counters need only the first two, and the diff of the file actually on screen was already fetched on demand. The trade is one round trip when a file is selected, on every repository — chosen deliberately, because a bundled patch that is correct only below a size threshold is two behaviours, and the threshold is invisible from outside.

### Fixed

- **Added or modified files showed no content on the Compare tab** (most visibly XML, where the same file read correctly in History and in Files). Compare clips one combined patch at 400,000 characters and splits it per file, so everything past the cut had no content — and the per-file fallback every other tab uses was never taken there: `fileDiff` could not accept a ref range, a limitation the code stated outright. It can now (`base...head`, falling back to the two-tip diff when unrelated histories leave no merge base, exactly as the Compare tab itself does), and deliberately without caching, since a ref name is a moving pointer. On the file in the fixture: asking the working tree returned 0 bytes; asking `base...head` returned 220,877.

## [0.1.7] - 2026-08-20

### Added

- **The History tab keeps both arrangements and you pick**, defaulting to the three columns. 0.1.6 stacked the tab for a measured reason — in three columns the commit list had about 420px and every subject was ellipsised — but it paid for that in the other axis: the list went from thirteen rows tall to whatever is left above the diff. Both cost something, which makes this a choice rather than a fix. The switch is at the end of the `Branch` row, two icon buttons; the choice is remembered per browser. Each arrangement **keeps its own size**: side by side you drag a width, stacked you drag a height, and switching back finds the pane where you left it. The commit row changes shape with it — two lines beside the diff, where a 340px column cannot hold a hash, an author, a date and a subject; one line when it spans the drawer, in `git log --oneline`'s order.

### Fixed

- **The commit list's head wraps instead of clipping its search box at the pane's edge.** Dragged narrow, the pane cannot hold a title, a `Filter by` button and a search box on one line, and what it used to do was cut the search box off at the pane boundary — a control showing half of itself, with nothing to say the other half existed.

## [0.1.6] - 2026-08-20

### Added

- **Side-by-side diff (IDEA-style)** for every file in the Changes tab: two columns of the whole file, aligned row by row — the alignment is read off git's full-context diff rather than computed. Hovering any cell outlines the **change block** it belongs to and floats that block's buttons: **stage** or **roll back** the block on the unstaged tab, **unstage** it on the staged one. The click carries the block's hunk-line indices and the sha of the diff as rendered, so the host can prove the file has not moved since the pane drew it — and does nothing if it has. Binary and oversized files fall back to the unified view with a notice: a view that silently changes shape reads as broken, not as guarded.
- **The right column is editable** (unstaged layer only — editing the index would mean writing a blob with no file behind it). Editing **arms explicitly and saves explicitly**, never per keystroke. A save carries the blob sha the buffer is based on, and the host refuses a stale write; if the file moved while you were typing, the drawer raises a reload-or-overwrite banner, and overwrite waits for the refetch so it is checked against the file as it truly stands. The poll keeps running: a refresh landing on a dirty buffer updates the tree and leaves the editor alone.
- **The editor is CodeMirror 6 now**: a real undo stack, multiple selections, find-in-file, and Tab that indents instead of leaving the field. Highlighting still comes from shiki — the diff columns beside it are already shiki-painted, and a second grammar engine would cost another megabyte to render the same file in slightly different colours. **Diff tints survive while editing**, so a line you just typed reads as the same kind of thing as a line git already knows about.
- **The pane says which half takes keystrokes**: a 2px rule down the editor's leading edge, dim at rest and full accent while the caret is inside (which doubles as "this pane has the keyboard"). A read-only file draws no rule — the Files tab's editor is live the moment a file opens, with no button in between, and a CRLF or non-UTF-8 file **swallows** the keystrokes; a mark that appears on a pane which will refuse them is worse than no mark, so it and `EditorState.readOnly` come from one boolean.
- **Blame**: a gutter beside the working-tree column with the person's name and a short hash, merging consecutive lines from the same commit (forty rows of the same name says nothing). Clicking a line raises that commit's detail strip and offers a one-click jump to History filtered to "this person, on this file". It withdraws the moment the buffer is dirty — once lines have been typed the numbers no longer match the commits, and an annotation quietly pointing at the wrong line is worse than none.
- **A Files tab** that browses the **whole repository**, not just what git has something to say about — "who wrote this line" is almost always about a file nobody has touched today. Directory tree plus a search box (multi-term, smart case); read, blame and edit. **It remembers where you were**: the expanded folders and the open file are kept per worktree and survive a restart.
- **Pictures open as pictures**: PNG, JPEG, GIF, WebP, BMP, ICO, AVIF and SVG, identified by the **magic numbers in their format specs** (the extension only decides whether a file is worth asking about). SVG renders through an `<img>` with a `blob:` URL and is never inlined — the document inside an `<img>` is a non-scripted context by specification, and that guarantee is what makes showing SVG safe. A "Source" toggle shows the markup instead.
- **Walk a diff change by change**: previous/next buttons and a change count on both the Changes and the History diff, on **F7 / Shift+F7** (IDEA's spelling). A file whose whole delta is `+1 −1` cannot be found by scrolling: the tint on that one line is only visible once you are already looking at it. The landing keeps three rows of context above the change, and wraps at either end rather than going dead.
- **The History tab is stacked**: the commit list spans the whole drawer, one line per commit, with the tree and diff below it — the same arrangement as the Changes tab, so there is one layout to learn. In three columns the list had about 420px and **every subject was ellipsised**, which is the part a log is read for; dragging a divider could not help, since the drawer's width is fixed and it only moves the shortage elsewhere. The split between the two halves drags.

### Fixed

- **A file the editor cannot round-trip is refused before the save, not after**: a CRLF or non-UTF-8 file offers no edit affordance at all, rather than a button whose press would rewrite bytes nobody touched.
- **Every gesture that would drop the buffer asks first**: another file, another tab, closing the drawer, switching worktree.
- **A leave gesture that did not actually happen can no longer disarm the unsaved-edits guard.**
- **A file with no grammar crashed the whole header slot.**
- **A shortened line is changed, not vanished** — the side-by-side view used to read it as a deletion.
- **The stacked split could not be dragged back open after the window got shorter.** The list's height is stored in pixels and only the *drag* clamped it; make the window shorter and the stored height is taller than everything — the lower half collapses to zero and the handle is pushed past the bottom edge, leaving nothing on screen to pull it back with. The cap now lives in the stylesheet as a percentage, re-resolved on every layout. Your chosen height is capped, not rewritten: make the window tall again and it returns.
- **The tree/diff divider in History was pinned at its minimum.** The ceiling is `drawer − neighbour − MIN_DIFF`, and the stacked commit list spans the whole drawer, so that came out negative. Neighbourliness is now decided by geometry: two panes take space from each other only when one ends where the other begins.
- **The "this commit has a body" marker (`···`) floated over to the author's name.** The subject was allowed to grow as well as shrink — invisible while the list was a narrow column, and a defect once it spanned the drawer, where the subject takes all the free space and pushes the marker a thousand pixels right.
- **The blame toggle keeps git's own wording.**

### Performance

- **The Files tab froze on a large repository.** Reproduced and measured on a scratch repository of 56,000 files (the host caps `repoTree` at 50,000) with one directory holding 6,000 subdirectories:
  - **One click could put an unbounded number of rows in the DOM.** Files were capped per directory at 100; **subdirectories were not** — expanding that directory rendered 6,000 buttons: 875ms of main thread and a **628ms frozen frame**, growing with the directory. Subdirectories are now capped the same way, with the same "and N others" marker and the same escape hatch: the search box reads the whole path list and ignores the tree. That same click is now 123ms, no stall, 123 rows.
  - **The whole tree rebuilt itself on a timer.** The drawer polls `git status` every 3–15 seconds, and the untracked-path array comes back with a new identity whether or not the repository moved — the head of a chain that runs merge, then directory tree, then rows. Holding it steady while its contents are unchanged took the script time per 20s of sitting still from 49–92ms (rising with the number of rows on screen) to a flat ~4ms. That matters most while an agent is running, when the poll is every 3 seconds rather than 15.
- **The file browser holds up at repository scale**: the path list, the directory tree and the rows are pure functions with their own caps, and the number of rendered rows does not follow the size of the repository.

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
