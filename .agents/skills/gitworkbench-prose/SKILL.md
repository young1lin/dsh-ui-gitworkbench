---
name: gitworkbench-prose
description: |
  Use when writing or reviewing prose in this repo — README, AGENTS.md,
  knowledge-base docs, commit messages, code comments — so claims match the
  code, AI-reasoning residue stays out, and line endings survive Windows.
  Triggers: "update the README", "write the handoff", "docs feel stale",
  "clean up the prose", before committing doc changes.
---

# gitworkbench prose standard

## Claims must match the code

This repo's audit history: the README once omitted 7 of the 18 RPCs and
claimed "no external highlighter" while shipping shiki (2.3MB of the bundle).
Before asserting anything countable:

```pwsh
# RPC count / names
Select-String -Path src\index.ts -Pattern "@Remote\('" | Measure-Object
# theme families, test files, any "N things" claim
(Get-ChildItem tests -Filter *.test.ts).Count
```

A number in prose without a command behind it is a defect.

## No reasoning-trace residue

Forbidden patterns (each has shipped in this repo's lineage): "used to" /
"no longer" / "was previously" change narration; "(design decision N)" session
citations; audit-item codes (F3, MAJOR-2) in durable docs; "as discussed" /
"as you suggested" addressivity; stack vantage ("a later PR adds");
hedged-planning residue ("possibly", "may want to consider") in specs.

Docs state what IS. History belongs in CHANGELOG or the commit body.

## Where prose lives (this repo's map)

| Content | Home |
|---|---|
| What/why/how + pitfalls | `README.md` (Chinese handoff document; §6 is the pitfall catalog) |
| Agent working rules | `AGENTS.md` (English; CLAUDE.md is a symlink view) |
| Domain knowledge | `.agents/skills/business-logic/<domain>/overview.md` |
| Why-this-commit | commit body (conventional prefix, lowercase subject) |
| Why-this-line | code comment (English) |
| Bilingual UI strings | `src/client/locales.ts` — zh AND en keys, always both |

## Windows line-ending discipline

The repo is LF. Python/PowerShell text-mode writes flip whole files to CRLF —
a thousand-line phantom diff (this bit the sync worker's first run). Before
committing any tool-written file: read bytes, replace CRLF with LF, write back
without BOM. The knowledge-base sync worker needs this after EVERY run.

## Commit-message shape

```
<type>(gitworkbench): lowercase subject

Body explains WHY the change is shaped this way — the constraint it serves,
the failure it prevents. Not a diff narration.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

Types in use: feat / fix / refactor / test / docs / chore. No remote exists;
commits are local-only and permanent — write them for the reader in six months.
