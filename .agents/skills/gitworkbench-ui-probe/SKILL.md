---
name: gitworkbench-ui-probe
description: |
  Use when verifying gitworkbench drawer behavior against the live app at
  http://127.0.0.1:3080 — driving the two Playwright probes safely (session
  targeting, never touching the operator's worktree), diagnosing probe
  failures, and recording UI demos.
  Triggers: "run the probes", "verify the UI", "smoke test the drawer",
  "record a demo", probe failures, "chip not showing".
---

# gitworkbench UI probe

Two probes, one rule above all: **a tick IS a real git call.** The probes never
drive ticks, but YOU might — never against a worktree someone is looking at.

## Before running anything

`Invoke-WebRequest http://127.0.0.1:3080` → expect 200. If dsh web is down,
stop and say so; do not start a replacement server.

## Probe 1 — host RPCs (probe_worktree.py)

```pwsh
# Point it at a QUIET session in the ACTIVE workspace — never one that is
# running (someone's audit/agent session), never the one you are in.
$env:DSH_SESSION_TEXT = '询问项目是做什么的'
python scripts/probe_worktree.py
```

- Exit 0 + `ALL PROBE ASSERTIONS PASSED` = 24 checks green (scratch repo
  enter/exit/reuse cycle + real-repo smoke + bindings residue).
- Hardcoded default labels ("Single number", "ok") belong to a workspace that
  no longer exists — the env var is mandatory in practice.
- Scratch repo self-destructs on failure; bindings file must show no residue.

## Probe 2 — six-step UI probe (verify_worktree_ui.py)

```pwsh
$env:DSH_SESSION_TEXT = '询问项目是做什么的'
python scripts/verify_worktree_ui.py
```

- 9/9 PASS expected (step 0/0b/1/2/3/5/4/6 + cleanup).
- The legacy fallback that switched the workspace to deepseek-harness is
  **opt-in only** (`WT_UI_ALLOW_HOST_FALLBACK=1`): that repo must never be
  modified. Missing session? Set DSH_SESSION_TEXT; do not opt in.
- A failed step 6 used to leave a dangling binding (chip vanishes with no
  visible cause); the probe now unbinds before cleanup, but if you ever see a
  hidden chip: `gitWorkbench/worktreeExit {sessionId, remove: false}` clears it.

## Playwright techniques that bite (from AGENTS.md)

- `wait_until='domcontentloaded'` + explicit waits — NEVER `networkidle` (the page holds a live WebSocket).
- CSS-module classes are hashed (`P-XXXX_local`) — select with `[class*="localName"]`.
- Fresh headless contexts default to **English** — match both zh and en strings.

## Recording a demo

For UI-behavior changes worth showing: capture the drawer flow as frames
(chip → open → tick a file on **fixture-01 only** → commit box) and encode a
deterministic, palette-quantized GIF (~15fps, max width ~900px). Keep GIFs out
of the repo; store under `.superpowers/` (git-ignored) or attach to handoff
docs externally.
