---
name: gitworkbench-release-checks
description: |
  Use before building, committing, or claiming a change is ready in
  @young1lin/dsh-ui-gitworkbench — selects the smallest checks that cover the outgoing
  diff instead of reflexively running everything, and knows which half
  (host vs client) dictates the feedback loop.
  Triggers: "pre-commit", "before I push", "check my change", "is it safe to
  bundle", "verify the build", release readiness.
---

# gitworkbench release checks

The repo has two halves with different feedback loops, and a full-suite reflex
wastes the loop that matters. Pick the smallest set that covers the diff.

## Step 1 — which half did you touch?

```pwsh
git diff --name-only --staged   # or: git diff --name-only <base>
```

| Touched | Half | Loop |
|---|---|---|
| `src/client/**` | client | `npx tsdown` + browser refresh at http://127.0.0.1:3080 (server re-reads `lib/client.js` per request) |
| `src/index.ts`, `src/worktree.ts`, `src/git-ops.ts`, `src/git-log.ts`, `src/commit-cache.ts`, `src/style-store.ts`, `src/atomic-json.ts` | host | `npm run bundle` + **restart dsh web** (host code lives in memory) |
| `tests/**` only | none | `npx vitest run` suffices |
| `package.json` / tsconfigs / tsdown.config.ts | both | full `npm run bundle` + `npm test` |
| `README.md` / `AGENTS.md` / knowledge base | none | no build; review only |

## Step 2 — the minimum check set

1. **Always**: `npm run typecheck` (~5s, both tsconfigs, catches the client half that rolldown never checks).
2. **Touched a pure module** (`stage-tree.ts`, `diff-model.ts`, `git-ops.ts`, `worktree.ts`, `atomic-json.ts`, `style-store.ts`, `themes.ts`, `commit-cache.ts`, `git-log.ts`, `worktree-view.ts`, `commit-graph.ts`, `op-feedback.ts`)? Run its test file directly: `npx vitest run tests/<module>.test.ts`.
3. **Touched `GitWorkbenchPanel.tsx` or `.module.css`**: run the structural guards: `npx vitest run tests/drawer-chrome.test.ts tests/diff-regression.test.ts tests/theme-palettes.test.ts`. These scan source text; a styling change they do not know about should ADD an assertion, not bypass the run.
4. **Touched the host half**: `npm run bundle` must exit 0 (tsc transpiles the stage-3 `@Remote` decorators — a syntax error here only surfaces at build).
5. **Claiming release readiness**: add `npm test` (15 files / 224 tests, ~2.5s — cheap enough to stop agonizing) and `npm pack --dry-run` (35-file whitelist, 498.0 kB packed; a file-count drift means the `files` list broke). `npm pack` triggers `prepack` → `bundle:publish`, which rebuilds `lib/client.js` WITHOUT a sourcemap — run `pnpm exec tsdown` afterwards to get the dev build back.

## Step 3 — guards that must never be skipped

- **Mutation-test any new source-scanning guard** (AGENTS.md: guards here have passed vacuously twice): change the guarded code, confirm the test goes red, `git checkout --` restore.
- **Bundle purity**: client code must keep `@deepseek-ai/*` as `import type` only. Check: expect 0 hits for `@deepseek-ai` in `lib/client.js`.
- **A tick IS a git call.** If your change touches tick behavior, drive it ONLY against the sibling scratch fixture `../gitworkbench-fixture/.agents/worktrees/fixture-01` (6 changed / 0 staged at rest; select-all + deselect-all returns it to 0). Never against a worktree someone is viewing.

## Step 4 — commit discipline

Conventional prefix, lowercase subject, body explains **why**, ends with:
`Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
Other agents may have uncommitted work: `git status` first, commit with `git commit --only <paths>`, never sweep.

## The realistic sync note

This repo has **no git remote**: pre-push/post-merge hooks never fire. Knowledge-base sync is manual: `uv run --script .agents/skills/business-logic/.scripts/auto_sync.py manual` (or `--staged`), then normalize CRLF to LF on the touched .md files before committing.
