# AGENTS.md

This file provides guidance to coding agents working in this repository. Claude Code reads it through the `CLAUDE.md` symlink that points here; other agent tools (Codex, Gemini CLI, …) read `AGENTS.md` directly.

## What this is

`@young1lin/dsh-ui-gitworkbench` — an out-of-tree web UI plugin for dsh (DeepSeek Harness): a git-workbench chip in every session header, opening a drawer with the file tree, per-file diff, history, and compare views, plus staging, commit, and fetch/pull/push sync. Ticks in the tree are real `git add` / `git restore --staged` calls. The dsh host itself lives in the sibling checkout `../deepseek-harness` and must never be modified.

`README.md` is the deep handoff document (Chinese). §6 「踩坑实录」 is a catalog of pitfalls confirmed by real debugging — read it before non-trivial work.

## Commands

```bash
npm run typecheck          # both tsconfigs (host + client), no emit
npm test                   # = npx vitest run, full suite
npx vitest run tests/stage-tree.test.ts   # single file
npx tsdown                 # rebuild ONLY the client bundle
npm run bundle             # full build: host tsc + client tsc + tsdown
```

Live app: dsh web runs at http://127.0.0.1:3080. Client-half changes take effect after `npx tsdown` + browser refresh (the server reads `lib/client.js` from disk per request); host-half changes require restarting dsh web.

## Two halves, two build paths

This split shapes everything else:

| Half | Sources | Build | Why |
| --- | --- | --- | --- |
| Host | `src/index.ts`, `src/worktree.ts`, `src/style-store.ts`, `src/atomic-json.ts`, `src/git-ops.ts`, `src/git-log.ts`, `src/commit-cache.ts` | `tsc` → `lib/index.js` | tsdown/rolldown does NOT transpile stage-3 decorators (`@Remote`); its output is a Node SyntaxError |
| Client | `src/client/**` | `tsdown` → `lib/client.js` | closure-factory bundle required by dsh's ClientModuleSystem; CSS Modules inlined by a vendored lightningcss plugin |

- Host RPCs: `class GitWorkbenchService extends TypertRemoteService` with `@Remote('name')` markers; the Typert gateway discovers them by reflecting the markers — no descriptors, no monorepo edits. Browser calls go through `connection.rpc.call('/api', 'gitWorkbench/<method>', {args})` from the slot registration's `inject` factory in `src/client/index.ts`.
- `@Remote` method params must be bare identifiers with `signal` last (the gateway reads `Function.prototype.toString`), and return values must be JSON-safe — no `undefined` property values, omit the key entirely.
- Host git calls use `ctx.subprocess.spawn` with `stdout: 'pipe'`, accumulating chunks manually — never `ctx.shell` (PTY scrollback silently truncates large output: lost branch headers, lost files).

## Testing pattern

Pure rules live in React/CSS-free modules so vitest can load them — `src/client/stage-tree.ts`, `diff-model.ts`, `worktree-view.ts`, `commit-graph.ts`, `op-feedback.ts`, `themes.ts`, `highlight.ts` (client); `worktree.ts`, `style-store.ts`, `atomic-json.ts`, `commit-cache.ts`, `git-ops.ts`, `git-log.ts` (host). React state stays in `GitWorkbenchPanel.tsx` (~3400 lines: chip + drawer + diff rendering). New behavior = pure helper + unit tests first, component wiring after.

`scripts/` holds the live probes — `probe_worktree.py` (host RPCs), `verify_worktree_ui.py` (6-step Playwright UI probe), `llm_smoke.py` (real-LLM smoke). They are local-only and git-ignored: they embed machine-local paths and need a running dsh instance.

## Conventions that bite

- **Line endings are LF.** A naive Python text write on Windows rewrites the whole file as CRLF — a thousand-line diff. From Python, open binary and normalize (`data.replace(b'\r\n', b'\n')`).
- **Playwright against the live app:** navigate with `wait_until='domcontentloaded'` and explicit waits — NEVER `networkidle` (the page holds a live WebSocket; it never fires). CSS-module classes are hashed (`P-XXXX_local`) — select with `[class*="localName"]`. Fresh headless contexts default to the **English** dictionary; match both zh and en spellings of any UI string.
- **A tick IS a git call.** Never drive ticks against a worktree someone is looking at. Use the scratch worktree `../gitworkbench-fixture/.agents/worktrees/fixture-01` (6 changed, 0 staged at rest; select-all then deselect-all returns it to 0). The drawer's source pin is per-browser, so a headless client can switch sources without moving the operator's view.
- **Source-scanning tests have twice been fooled by prose in comments.** Strip comments before scanning, and mutation-test any such guard (change the guarded code, confirm the test goes red).
- **UI copy is bilingual** (`src/client/locales.ts`, zh + en — add both keys); code comments and commit messages are English.
- **Commits:** conventional prefix, lowercase subject, a body explaining *why*, ending with a `Co-Authored-By:` trailer per model that worked on the change, ranked by token usage — credit the model(s) that actually wrote it, never a fixed name (history shows the spellings: `Claude Opus 5 (1M context) <noreply@anthropic.com>`, `GLM-5.3 <noreply@zhipuai.cn>`, `Grok-4.6 <noreply@x.ai>`). Remote is `origin` = github.com/young1lin/dsh-ui-gitworkbench; publishing is tag-driven — push `vX.Y.Z` and `.github/workflows/publish.yml` publishes to npm via Trusted Publishing (no local npm login; the workflow re-runs typecheck/tests/build itself).
- **Other agents may have uncommitted work in this tree** (e.g. `scripts/verify_worktree_ui.py`). Check `git status` first and commit with `git commit --only <paths>` — never sweep the tree, and don't touch files that aren't yours.
- `.npmrc` must keep `auto-install-peers=false` (dev-time weight control: the harness peers resolve from the web profile / linked checkout; letting pnpm auto-install the whole `@deepseek-ai/*` tree locally adds nothing). The peers ARE published on npm — consumer installs resolve them fine. `@deepseek-ai/*` imports in client code must be `import type` only — the bundle purity gate rejects value imports.

<!-- business-logic-skill: explore-first (managed by install_hooks.py) -->

## Explore via the business-logic knowledge base first

When asked to understand business logic, locate a feature, explain how
something works, or find the code for a given concept, **consult the
living knowledge base at `.claude/skills/business-logic/` before re-deriving the design from
source or grepping blindly.** It has one `overview.md` per business
domain, plus flow docs, call-relation graphs, DB schemas and pitfall
notes, kept in sync with the code by auto-sync git hooks -- usually
faster and more accurate than re-reading the source.

Start by listing `.claude/skills/business-logic/` to see the domain directories, then read the
relevant domain's `overview.md` and drill into its docs as needed.
Fall back to reading source only when a doc is missing or stale, and
backfill what you learned so the next exploration is current.

<!-- /business-logic-skill -->
