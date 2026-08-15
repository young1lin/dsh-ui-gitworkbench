# @young1lin/dsh-ui-gitworkbench

🌏 [中文](./README.md) · [English](./README_EN.md)

An out-of-tree Web UI plugin for [dsh (DeepSeek Harness)](https://github.com/deepseek-ai/deepseek-harness) that adds a Git workbench to the dsh web interface — without touching dsh itself.

Every session header gets a small status card showing the current branch, ahead/behind counts, and added/deleted lines. Click it and a workbench panel slides in from the right with everything about the session worktree's changes:

- **Changes** — a collapsible file tree beside per-file diffs: dual line numbers, word-level highlights, Shiki syntax coloring.
- **History** — commits, file tree, and diff in three panes; scrolling to the bottom loads the next page automatically.
- **Compare** — diff any two branches against each other.
- **Commit & sync** — ticking a file in the tree is a real `git add` / `git restore --staged`; with the commit box and the fetch / pull / push bar, a full commit-and-push never leaves the panel.
- **Appearance** — seven theme families in light and dark (following the OS by default), plus a blurred background image and custom CSS, stored per project and globally with the project scope winning.

It also ships **worktree emulation**: the model can call the `worktree_enter` / `worktree_exit` / `worktree_status` agent tools to create or leave an isolated worktree under `.agents/worktrees/<name>` and bind the session to it. The status card lights up its binding marker, the panel header gains a worktree switcher listing every worktree in the repository, and the stats follow the binding.

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
