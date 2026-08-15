---
name: gitworkbench-audit
description: |
  Use when reviewing a change, a module, or the whole plugin before release —
  orients the reviewer to this codebase's standards (two-half build, RPC
  constraints, source-scan guard discipline, destructive-command ban) and the
  review-specific checks that code alone cannot show.
  Triggers: "review my change", "audit the plugin", "is it ready to ship",
  "find issues in", pre-release, post-refactor.
---

# gitworkbench audit

## Orient first (read in this order)

1. **AGENTS.md** — commands, two-half table, conventions that bite.
2. **README §6 踩坑实录** — pitfalls confirmed by real debugging; every entry
   encodes a bug that actually shipped.
3. Knowledge base domains (`.agents/skills/business-logic/<domain>/overview.md`):
   stats-drawer, write-ops, worktree-emulation, plugin-loading.

## The seven-lens release audit (proven on this repo)

Run independent lenses in parallel; each returns READY / READY-WITH-RISKS /
NOT-READY with evidence (file:line) and severity (BLOCKER/MAJOR/MINOR/NIT):

| Lens | What it checks | How it ran last time |
|---|---|---|
| Build & test gate | typecheck, suite twice (flaky check), bundle, product purity | subagent, READY |
| Host half | @Remote signatures, spawn+pipe discipline, argv hardening, atomic writes | by hand, READY |
| Client half | locale key parity, import-type purity, tick queue races, effect cleanup | subagent, READY-WITH-RISKS |
| Test quality | module-to-test map, **mutation-test the scan guards**, env fragility | subagent, 9/10 mutations red |
| Docs & release metadata | README vs code, pack contents, license, files whitelist | 2 subagents, converged |
| Runtime probes | host RPCs live, UI probe live | 2 subagents, converged |
| Privacy | secrets, machine paths, git identity, sourcemap contents | by hand, clean |

Findings worth re-checking every release: LICENSE presence, `files` whitelist
drift (count the pack files), README claims vs the 18 RPCs, stale test-count
prose, the `data-quiet` Fetch-button variant ban (`tests/drawer-chrome`).

## Review-specific checks code alone cannot show

- **@Remote constraints** (invisible to TypeScript): bare-identifier params,
  `signal` LAST (the gateway reads `Function.prototype.toString`), JSON-safe
  returns — no `undefined` property values, omit the key entirely.
- **The destructive-command ban is total**: no `--force`, no `reset --hard`,
  no `clean` in ANY spelling, anywhere. Losing committed work needs its own
  confirmation design, not an adjacent button.
- **Spawn discipline**: every host git call is `ctx.subprocess.spawn` with
  `stdout:'pipe'` and manual chunk accumulation; `ctx.shell` (PTY scrollback
  truncation) must appear in comments only.
- **Purity gate**: `@deepseek-ai/*` in client code is `import type` only;
  shiki and friends are fine (third-party is not peer).
- **Guard mutation**: any new source-scanning test must be mutation-tested
  once (red on the guarded change) — prose in comments has fooled this repo's
  guards twice; the third attempt was caught by comment-stripping.
- **Concurrency invariants**: `withBindings`/`withStyle` promise-queue
  serialization; `busyRef` (not state) guards the drain loop; a source switch
  retires stale drain epochs.

## Severity calibration

BLOCKER = ships broken or loses user work. MAJOR = wrong or misleading in a
common path, or a release-blocking metadata gap. MINOR = edge-case correctness
or UX debt. NIT = style/count drift. When two independent lenses converge on
the same finding, trust it over any single read.
