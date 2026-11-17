# @young1lin/dsh-ui-gitworkbench

🌏 [中文](./README.md) · [English](./README_EN.md)

An out-of-tree Web UI plugin for [dsh (DeepSeek Harness)](https://github.com/deepseek-ai/deepseek-harness) that adds a Git workbench to the dsh web interface — without touching dsh itself.

Every session header gets a small status card showing the current branch, ahead/behind counts, and added/deleted lines. Click it to open the workbench in DSH's native right sidebar alongside the conversation, with an overlay fallback on hosts missing the required lifecycle API:

- **Changes** — editable inline diffs and a file list opened as needed in the sidebar, with a toggle for full-context, side-by-side per-file diffs with dual line numbers, word-level highlights, Shiki syntax coloring, and an editable right column. A binary file is sniffed by its bytes and drawn when it is a picture (a deleted one shows HEAD's copy). A magnifier filters the tree by space-separated keywords (smart case); hovering a file reveals IDEA-style Rollback behind a consequence-specific dialog. The diff header keeps the current hunk and `current / total` visible: Unstaged offers Stage / Revert even in Edit mode, while Staged offers Unstage for the current hunk or the whole file.
- **Files** — a searchable repository tree with editable CodeMirror file views, image previews, and per-line blame information. Ctrl/Cmd+F opens a find panel dressed in the drawer's own controls that reports `3/128` — which match you are on, out of how many.
- **File references and paths**: add the selected file to the conversation from its toolbar, or right-click a file row / use its ellipsis menu to add it or copy its name, repository-relative path or absolute path. Draft text and existing references stay intact; nothing sends automatically. References use the displayed worktree, and historical or deleted files carry explicit Git version metadata. English and Chinese labels are included.
- **DSH file menus and annotations**: native file context menus open current changes in the worktree containing the clicked absolute path. Annotate a selection or hunk, then add multiple notes to the existing conversation draft in one step, without sending. Each note retains the displayed code, version and side and has its own source link. Pending notes are session-scoped in plugin memory and survive file, revision and worktree changes; refreshing or reloading clears pending notes, while DSH owns inserted drafts.
- **Code snapshots** — select code or a single hunk and use its conversation icon to add the displayed text and location. Snapshots identify the worktree, index, historical/comparison version or unsaved buffer, preserve the draft and never save or send automatically.
- **Sidebar layout** — code fills the available area, with the file list opened as needed. Above 900px, History keeps commits on the left and the selected diff on the right, with the file list opened as needed; narrower sidebars drill through commits, files and diffs. The commit section starts collapsed and retains its message. Source, view and refresh stay in the header; branch switching, sync and appearance live in the More menu.
- **History** — keep commits beside the selected diff in a wide sidebar, drill through commits, files and diffs in a narrow sidebar, or choose columns or a stacked layout in the overlay; scrolling to the bottom loads the next page automatically. Ctrl/Cmd+F finds in the diff (Enter / Shift+Enter walk the hits, `current / total` count, hits painted); a picture shows the commit's copy (a deleted one, the parent's). Rows carry the author, the hover card the exact time; an IDEA-style filter (a `user:` / `path:` / `after:` query grammar plus an authors / date / paths funnel) compiles into `git log` arguments and matches over all history, with an All-branches option.
- **Compare** — diff any two branches against each other, with the same find bar; a picture shows the head ref's copy (a deleted one, the base's).
- **Commit & sync** — ticking a file in the tree is a real `git add` / `git restore --staged`; with the expandable commit box and fetch / pull / push in More (a sync bar in the overlay), a full commit-and-push never leaves the panel. The header also carries a branch switcher (main worktree only): the current branch is marked, a branch held by another worktree is disabled with its whereabouts on hover, a remote-only branch checks out and tracks in one pick — local edits ride along when git can carry them and stop it (classified, intact) when it cannot; never forced.
- **Appearance** — seven theme families in light and dark (following the OS by default), plus a blurred background image and custom CSS, stored per project and globally with the project scope winning.

It also ships **worktree emulation**: the model can call the `worktree_enter` / `worktree_exit` / `worktree_status` agent tools to create or leave an isolated worktree under `.agents/worktrees/<name>` and bind the session to it. The name doubles as the branch by default; pass `branch` to choose another — unlike the name it may contain slashes (`feature/foo`), the spelling a Windows directory name can never hold. **A subagent session never writes a binding of its own — it borrows the nearest bound ancestor's worktree along its lineage**: the standing prompt, the chip, and `worktree_status` all resolve that effective binding for a session without one, and the borrow disappears when the parent exits. The status card lights up its binding marker, the panel header gains a worktree switcher listing every worktree in the repository, and the stats follow the binding.

<div align="center">
  <video src="https://github.com/user-attachments/assets/c6a73c7b-bf69-4b97-80a2-9175bc293d7d" muted autoplay loop playsinline controls width="100%"></video>
  <sub>Demo (2:24) — status card → Changes (ticking to stage, per-file diffs, committing) → Appearance (light/dark, seven palettes, background image) → History (commit graph, worktree switching)</sub>
</div>

> The Chinese [README.md](./README.md) is the project's deep handoff document — including the pitfall catalog (§6) that every contributor should read before changing the build, the RPC layer, or the Windows-specific handling.

## Install

**Prerequisites**: dsh installed and `dsh web` running; Node.js ≥ 20, pnpm ≥ 10.

**Recommended — the official plugin channel, one command:**

```sh
dsh plugin --profile web add @young1lin/dsh-ui-gitworkbench
```

Then **restart dsh and hard-refresh the browser** (Ctrl/Cmd + Shift + R). The package declares its `dsh.bundle.patch`, so the CLI registers the host half into the profile's `dsh.profile.bundles` and mounts it on the next start — you never hand-write a `cordis.patch.yml` entry. Without a `dsh` command on PATH, run it through npx:

```sh
npx -y --package @deepseek-ai/dsh dsh plugin --profile web add @young1lin/dsh-ui-gitworkbench
```

**Upgrading an installed copy** uses `update`, not a repeated `add`:

```sh
dsh plugin --profile web update @young1lin/dsh-ui-gitworkbench
```

`dsh plugin` is a thin pnpm forwarder: repeating `add` does not error, but it reinstalls the latest version and **overwrites a `link:` install** (a from-source checkout suddenly reverts to the npm build). `update` reconciles by installed state, so a `dsh.bundle` declaration a newer version gained is activated automatically. Restart dsh afterwards either way.

<details>
<summary><b>Alternative: one-line installer scripts</b> (same official channel, two extra conveniences)</summary>

```sh
# macOS / Linux (or Windows with Git Bash / WSL)
curl -fsSL https://raw.githubusercontent.com/young1lin/dsh-ui-gitworkbench/main/scripts/install.sh | bash
```

```powershell
# Windows (PowerShell 5.1+ / pwsh)
irm https://raw.githubusercontent.com/young1lin/dsh-ui-gitworkbench/main/scripts/install.ps1 | iex
```

Beyond the install command, the scripts pre-write pnpm 11's `minimumReleaseAgeExclude` so a release younger than 24 hours installs immediately, and idempotently remove legacy manual mount lines (a double mount shows two status cards on the page). They also take options — pinning a version, `pm2 restart dsh-web` afterwards, `--dry-run` — documented at the top of each script.

</details>

<details>
<summary><b>Developing from source</b></summary>

`dsh plugin --profile web add <repo path>` installs the checkout into the profile. After editing the client half, run `npx tsdown` and refresh the browser; host-half changes need a dsh restart. When switching a `link:` dependency back to the npm version, remove the manual mount line from `cordis.patch.yml` (the installer scripts do this automatically).

</details>

## For maintainers

```sh
pnpm install        # .npmrc keeps auto-install-peers off; the dsh peers come from the web profile at runtime
pnpm typecheck      # both tsconfigs — the client half is otherwise never checked
pnpm test           # vitest, full suite
pnpm bundle         # tsc (host half: lib/index.js) + tsdown (client half: lib/client.js)
```

The plugin has two halves with different feedback loops: the host half (`src/index.ts` and friends) is a `TypertRemoteService` exposing the RPCs behind every view, and must be rebuilt and followed by a dsh restart; the client half (`src/client/**`) is a closure-factory bundle that the web server re-reads from disk on every request, so a rebuild plus a browser refresh is enough. Pure logic lives in React-free modules so vitest can load it directly.

Releases are tag-driven: pushing a `vX.Y.Z` tag runs the CI checks and publishes to npm through OIDC trusted publishing — no npm token anywhere. The full runbook (first manual publish, trusted-publisher setup, why the tarball carries no sourcemap) lives in the Chinese README's maintainer section.

## Known limits

- The status card mounts in the `conversation.session.header.actions` slot, so it appears only once a session is actually open. In headless automation without a real session the card will not show — open a session in the UI to see it.
- Person search in the history filter matches the **author** only (IDEA parity — git has no author-or-committer pushdown). The committer stays visible in the hover card.

### 6.31 Native retained tabs and code snapshots

On a compatible DSH host, the status card opens a native `sidebar.right.pane.tab` workbench, sharing the sidebar's split, floating and fullscreen controls. Hosts without the required sidebar lifecycle API keep the overlay entry. `keepMounted: true` retains the selected worktree, reading position and edit buffer through tab/session switches and collapse. Hidden bodies stop heavy polling, cancel pending insertions and release confirmation dialogs' Escape handlers. Native close uses `registerCloseHandler` to reach the unsaved-edit confirmation; a background tab is revealed before asking, and confirmation admits exactly one close.

Select code and use its conversation icon, or quote the current hunk. References carry the displayed repository, path, frozen version, side, coordinates and actual text; unsaved buffers are marked. Drafts show compact chips. A registered DSH input-source codec serializes them, and the public `userText` rule and message-node slot render sent references. Clicking code first tries to restore its selection in the retained editor. Repository, path, version, index layer, captured source identity and actual code must match; old-side references stay on the old side, and hunks validate both sides. Returning from the file list reveals the code pane while retaining the toolbar, unsaved edits and undo history. If an exact return is unavailable, a read-only saved snapshot opens with a way back to the retained editor. File references use the specified worktree or frozen version. The draft is preserved, and nothing saves or sends automatically. Old absolute mentions contain no frozen identity and open their current worktree. The message renderer requires that public DSH API, verified on 0.2.2-rc.1.

Docked Changes uses CodeMirror’s official `unifiedMergeView` for editable inline diffs, incremental updates and unchanged-region folding. Comparison ignores CRLF versus LF while retaining raw text and quote offsets; genuine final-newline changes are labeled. Visible deletion widgets mount bounded read-only CodeMirror views, so a large deletion does not paint its entire contents. Shiki colors visible rows. Selection styling survives focus moving to the draft. Staged content and protected encodings remain read-only, with the side-by-side option retained. Old and new code share the same text column and horizontal scrolling; deletion hints retain the original line range, and wrapping follows the main editor.

`WorkbenchChrome` places repository/worktree context, view selection, Refresh and More on the first row. The repository menu shows the path, counts and version, with a separate Git branch action and a worktree viewing list. More groups appearance and remote sync; pull strategies expand inside the same menu and Settings opens separately. `EditorToolbar` combines file selection, staging layers, hunk navigation, context-sensitive quoting and an editor menu on the second row. Controls wrap at 410px or less. The full path remains in the file tooltip; historical commit and comparison identities stay visible. Quoting uses the selection when present and the current hunk otherwise. Whole-file references, copy-path actions and stage/revert/edit commands live in the editor menu. Menus use Radix Dropdown Menu for keyboard navigation, checked state, focus return and narrow-pane placement. `dock-layout` retains each view’s commits, files and code location. At 900px or less, lists and code each use the full area; wider panes can show them together. CSS hides retained editors without losing buffers, selection or undo. Changes of file, version, source and close still use the unsaved-edit guard. The commit section starts collapsed and retains its message and amend state. Labels are maintained in English and Chinese.

Click a new-side line number to select the physical line, or select code and right-click or press Shift+F10. The menu can add actual code with its path, or copy code, file names and paths. Opening the menu freezes its code, worktree and version; adding captures the latest draft insertion position, preserving text typed while the menu was open. Unsaved buffers can be quoted without saving, and closing still requires the unsaved-edit confirmation.

Selection gestures retain coordinates; only an explicit Add copies source text. DOM endpoints are measured inside code cells, ignoring gutters and controls while mapping a displayed CR to one source character. CodeMirror uses `doc.lineAt` and `sliceString` without walking the complete document on selection keys. Tests cover coordinates, snapshot identity, draft transactions and retained-tab lifetimes; DOM test dependencies are development-only.
