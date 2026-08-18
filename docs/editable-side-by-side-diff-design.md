# Editable side-by-side diff — design

Status: approved for implementation planning. Branch `feat/editable-diff`.
Lives in `docs/` rather than `docs/superpowers/specs/` because that path is
git-ignored, and this spec has to travel with the branch to whoever executes it.
Supersedes stages 1–2 of `docs/editable-diff-plan.md` (that document's stage 0
is already merged as `src/client/patch-model.ts`, which §1.4 moves).

Turn the drawer's read-only diff pane into IDEA's diff viewer: two tabs for the
two git layers, two side-by-side columns showing the **whole file**, the
working-tree column editable, and per-change-block staging, unstaging and
discarding.

---

## 0. Orientation for whoever implements this

Read this section even if you know the repo. It exists because the reader of
this spec is assumed to have no other context.

### What the project is

`@young1lin/dsh-ui-gitworkbench` — an out-of-tree web UI plugin for dsh
(DeepSeek Harness). It adds a git chip to every session header; the chip opens
a drawer with a file tree, a per-file diff, history and compare views, plus
staging, commit and fetch/pull/push. The dsh host itself lives in the sibling
checkout `../deepseek-harness` and **must never be modified**.

`README.md` is the deep handoff document (Chinese). Its §6「踩坑实录」is a
catalog of confirmed pitfalls — read it before non-trivial work.

### Two halves, two build paths

| Half | Sources | Build | Why |
| --- | --- | --- | --- |
| Host | `src/*.ts` | `tsc` → `lib/index.js` | tsdown/rolldown does NOT transpile stage-3 decorators (`@Remote`); its output is a Node SyntaxError |
| Client | `src/client/**` | `tsdown` → `lib/client.js` | closure-factory bundle required by dsh's ClientModuleSystem |

```bash
npm run typecheck                          # both tsconfigs, no emit
npm test                                   # vitest run, full suite
npx vitest run tests/<one>.test.ts         # single file
npx tsdown                                 # rebuild ONLY the client bundle
npm run bundle                             # host tsc + client tsc + tsdown
```

Live app: dsh web at `http://127.0.0.1:3080`.

- **Client-half changes** take effect after `npx tsdown` + browser refresh (the
  server reads `lib/client.js` from disk per request).
- **Host-half changes require restarting dsh web.** This was verified
  empirically, not assumed: the vendored cordis HMR is not mounted in the web
  profile, and the client HMR chain (`packages/client/hmr` in the harness)
  stat-polls *client bundles* only. A rebuilt `lib/index.js` is NOT picked up by
  a running process. **Ask the user to restart; do not kill their process.**

### Rules that will bite you

- **Host RPCs** are `@Remote('name')` methods on
  `class GitWorkbenchService extends TypertRemoteService`. The gateway reflects
  over `Function.prototype.toString`, so **every parameter must be a bare
  identifier** (no destructuring, no defaults) and **`signal` must be last**.
  Return values must be JSON-safe: never a property whose value is `undefined`
  — omit the key entirely.
- Host imports use `.js` extensions; client imports use `.ts`.
- Client code may import `@deepseek-ai/*` **only** as `import type` — the bundle
  purity gate rejects value imports. Third-party runtime libraries are NOT
  banned (shiki is already bundled); bundle size is the constraint, not policy.
  `lib/client.js` is currently ~2.46 MB.
- **Host git calls** go through the private `git()` helper, which uses
  `ctx.subprocess.spawn` with `stdout: 'pipe'` and accumulates chunks. Never
  `ctx.shell` — PTY scrollback silently truncates large output. Every call is
  prefixed `-c core.quotepath=false`.
- **Line endings are LF.** A naive Python text write on Windows rewrites the
  whole file as CRLF, producing a thousand-line diff. From Python, open binary
  and normalise (`data.replace(b'\r\n', b'\n')`).
- **UI copy is bilingual**: add every key to both dictionaries in
  `src/client/locales.ts` (zh + en). Code comments and commit messages are
  English.
- **Testing pattern**: pure rules live in React/CSS-free modules so vitest can
  load them; React state stays in `GitWorkbenchPanel.tsx` (~4500 lines). New
  behaviour = pure helper + unit tests first, component wiring after.
- **Commits**: conventional prefix, lowercase subject, a body explaining *why*,
  ending with a `Co-Authored-By:` trailer per model that worked on the change.
- **Other agents may have uncommitted work in this tree.** Check `git status`
  first and commit with `git commit --only <paths>` — never sweep the tree.
- **A tick IS a git call.** Never drive the UI against a worktree someone is
  looking at. Throwaway repos and probe files belong under
  `C:\PythonProject\gitworkbench-fixture` (its `.agents/` is git-ignored);
  leave `.agents/worktrees/fixture-01` at its resting state of 6 changed,
  0 staged.

### What already exists that this builds on

- `src/client/patch-model.ts` — parses a unified diff and re-emits an arbitrary
  **subset** of it as a patch `git apply` accepts. Implements git's `add -p`
  rules: a selected `+` is emitted, an unselected `+` is dropped, a selected `-`
  is emitted, an unselected `-` becomes **context**; both counts are recomputed
  and each hunk's new-side start is shifted by what earlier hunks in the same
  patch actually do. Tested twice: `tests/patch-model.test.ts` (shape) and
  `tests/patch-model.git.test.ts` (real `git apply --check` in a temp repo).
- `src/client/diff-model.ts` — `parseRows` for the existing unified rendering.
  Keep it; the new view is a second mode, not a replacement.
- `src/client/discard-flow.ts` — `nextAfterPlan`, the confirm-or-act-or-report
  decision for destructive actions. Reuse its shape for discard.
- `src/fs-remove.ts` — `resolveInside(root, relative)`, the path check every
  filesystem write must pass.
- `src/index.ts` `fileDiff` RPC — how a diff is fetched today, including
  `untrackedSegment()` for files git has never seen.

---

## 1. The design

### 1.1 One artifact serves three jobs

`git diff -U<LARGE> -- <path>` produces **a single hunk covering the entire
file**. Verified. That one artifact provides:

1. **Full-file display** — the user's explicit requirement: show the whole file,
   not three lines of context around each change.
2. **Row alignment for two columns** — a unified diff *is* an alignment.
   `context` → both columns, `del` → left only, `add` → right only. No diff
   algorithm has to be written or bundled.
3. **Patch emission** — `patch-model.ts` works on it unchanged, and a patch
   carrying the whole file as context is the strictest possible `git apply`
   context match, which makes the concurrency guard as strong as it can be.

`LARGE` is `1_000_000`. Guard the pathological case: if the file exceeds
**20 000 lines or 2 MB**, fall back to the existing unified view with a notice
(new locale key), because a 2 MB patch per click is not a reasonable wire
payload and the side-by-side DOM would be enormous.

### 1.2 The two tabs

| Tab | Left column (read-only) | Right column | Actions offered |
| --- | --- | --- | --- |
| **Unstaged** (`unstaged`) | index — `git show :<path>` | **working tree, EDITABLE** | stage block, discard block, save |
| **Staged** (`staged`) | HEAD — `git show HEAD:<path>` | index, read-only | unstage block |

Underlying diffs:

| Tab | Command |
| --- | --- |
| `unstaged` | `git diff -U1000000 -- <path>` (index → working tree) |
| `staged` | `git diff --cached -U1000000 -- <path>` (HEAD → index) |

**Decision, not an oversight: the staged tab's right column is read-only.**
Editing the index would mean writing a blob and `update-index` — a write with
no file behind it, invisible on disk, and something IDEA does not offer either.
To change staged content, edit the working tree and stage again.

**Untracked files** have no index entry. `git diff` reports nothing, so reuse
the existing `untrackedSegment()` path: base is empty, every line is an
addition, the staged tab is empty, and block-staging still works.

### 1.3 Editing, against an agent that writes the same files

The drawer polls every 3 s while an agent is running, 15 s otherwise. That is
how fast it *notices*, not a lock. Three rules follow, and they are the reason
this feature is safe:

1. **Explicit save.** A Save button and `Ctrl/Cmd+S`. Never save per keystroke:
   an autosave racing a concurrent agent write is precisely the data-loss case.
2. **Save carries the blob sha the editor opened with.** The host recomputes the
   file's sha and **refuses** when it differs, reporting "this file changed
   while you were editing it". This is the same shape as `discardFile`'s
   `expectedEffect`: the client's claim is never trusted; the host re-derives
   from what git reports at the moment of the write.
3. **A file with unsaved edits is not overwritten by the poll.** The tree still
   refreshes; the editor buffer does not. If the underlying file changed, show a
   banner offering reload-and-lose-edits.

### 1.4 Who builds the patch — the host, always

The client sends a **selection**, never patch text.

If the client sent raw patch text, the host would have to prove that text only
touches the file the user named; a patch is a file-addressing format and
accepting one from the browser is a write primitive with a path argument. So:

- client sends `path`, `layer`, `diffSha`, and the selected line coordinates;
- host re-fetches the diff **itself**, checks `sha1(diffText) === diffSha`, and
  refuses on mismatch — this closes the window where the file changes between
  the client's render and the click, which would otherwise make the selection
  indices point at different lines;
- host parses with `patch-model`, emits the subset, applies it.

**This requires `patch-model.ts` to be importable by both halves.** Move it:

```
src/client/patch-model.ts  ->  src/patch-model.ts
```

Each side imports it with its own extension convention, from the one file:

| Importer | Specifier |
| --- | --- |
| `src/index.ts` (host) | `./patch-model.js` |
| `src/client/*.ts(x)` (client) | `../patch-model.ts` |
| `tests/*.test.ts` | `../src/patch-model.ts` |

The module is pure TypeScript with no node imports, so both bundlers accept
it.
**Verify this first**, before building anything on it: add the client-side
import, run `npx tsdown`, and confirm the bundle still builds and the purity
gate passes. If it does not, fall back to the host owning a private copy and
delete the client's — duplication is cheaper than a broken bundle.

---

## 2. Host contracts

All are methods on `GitWorkbenchService` in `src/index.ts`. Remember: bare
identifier params, `signal` last, JSON-safe returns.

### 2.1 `fileSides`

```ts
@Remote('fileSides')
async fileSides(worktreePath: string, path: string, layer: string, signal: AbortSignal): Promise<FileSides>

interface FileSides {
  /** Unified diff at full context; '' when the layer has no change. */
  readonly diff: string
  /** sha1 of `diff`, echoed back by mutations to prove the same snapshot. */
  readonly diffSha: string
  /** Whole right-hand text, the editor's initial buffer. */
  readonly targetText: string
  /** Blob sha of the right-hand side; '' when it does not exist. */
  readonly targetSha: string
  readonly binary: boolean
  /** True when the file is past the size guard; the client shows the old view. */
  readonly tooLarge: boolean
}
```

- `layer` is `'unstaged'` or `'staged'`; anything else is an error.
- `targetText` for `unstaged` is the working-tree file; for `staged` it is
  `git show :<path>`.
- `targetSha` comes from `git hash-object -- <path>` (unstaged) or the index
  entry (staged).
- Binary files: set `binary: true`, leave `diff`/`targetText` empty. The client
  shows the existing "binary file" treatment and offers no actions.

### 2.2 `applyBlocks`

```ts
@Remote('applyBlocks')
async applyBlocks(worktreePath: string, path: string, layer: string, diffSha: string, lines: readonly number[], mode: string, signal: AbortSignal): Promise<GitOpResult>
```

- `lines` are indices into the single hunk's `lines` array as
  `patch-model.parsePatch` produced it. (Full context means one hunk; still,
  code defensively — if a future change lowers the context, index within
  `hunks[0]` and reject a diff with more than one hunk rather than mis-apply.)
- `mode` ∈ `'stage' | 'unstage' | 'discard'`:

| mode | layer it is valid on | argv |
| --- | --- | --- |
| `stage` | `unstaged` | `apply --cached` |
| `unstage` | `staged` | `apply --cached --reverse` |
| `discard` | `unstaged` | `apply --reverse` |

Reject any other combination.

Sequence:

1. Re-fetch the layer's diff; if `sha1(diff) !== diffSha`, return
   `{ ok: false, failure: 'stale', error: <message naming the file> }`.
2. `parsePatch` → `emitPatch` with a selector over `lines`.
3. If the emitted patch is `''`, return `{ ok: true }` and do nothing — an empty
   selection is not an error, and `git apply` rejects a patch with no hunks.
4. Run `git apply --check` with the same flags. On failure return git's own
   stderr verbatim.
5. Run the real apply.

**Feeding the patch to git.** The existing `git()` helper spawns with
`stdin: 'ignore'`, so patch text cannot go on stdin without changing it. Do the
simple thing: write the patch to a file in `os.tmpdir()` and pass its path as
the last argument (`git apply --cached <file>`), then delete it in a `finally`.
Do not extend `git()` unless you have verified the subprocess handle's stdin
write API in `../deepseek-harness` — and do not modify that checkout.

**`discard` is irreversible** and must go through the existing confirmation
chain (`src/client/discard-flow.ts`): ask what would happen, state the
consequence, act, and refuse if the answer changed. Never a
"don't ask again".

### 2.3 `writeChecked`

```ts
@Remote('writeChecked')
async writeChecked(worktreePath: string, path: string, text: string, expectedSha: string, signal: AbortSignal): Promise<WriteResult>

interface WriteResult {
  readonly ok: boolean
  readonly failure?: string
  readonly error?: string
  /** The file's blob sha after a successful write, for the next save. */
  readonly sha?: string
}
```

Optional fields obey the gateway's JSON rule: on success emit `ok` and `sha`
and **omit** `failure`/`error` entirely rather than setting them to
`undefined`; on failure omit `sha`.

1. `resolveInside(cwd, path)` from `src/fs-remove.ts` — the same lock, not a
   second one.
2. `git hash-object -- <path>`; if it differs from `expectedSha`, return
   `{ ok: false, failure: 'stale', error: … }` **without writing**.
   `expectedSha === ''` means "the file did not exist when I opened it"; accept
   only if it still does not exist.
3. Write atomically: temp file in the same directory, then `rename`. Follow
   `src/atomic-json.ts`.
4. Return the new sha from a second `hash-object`.

**Never add a `writeFile(path, content)` RPC without the sha check.** That is
the one thing this design must not leak.

---

## 3. Client contracts

### 3.1 `src/client/side-rows.ts` — new pure module

```ts
export interface SideCell { readonly line: number; readonly text: string }

export interface SideRow {
  /** `same` both columns equal; `change` a paired del/add; `del`/`add` one-sided. */
  readonly kind: 'same' | 'change' | 'del' | 'add'
  readonly left: SideCell | null
  readonly right: SideCell | null
  /** Index into the hunk's `lines` for the LEFT cell, -1 when absent. */
  readonly leftIndex: number
  /** Index into the hunk's `lines` for the RIGHT cell, -1 when absent. */
  readonly rightIndex: number
  /** Which change block this row belongs to; -1 for unchanged rows. */
  readonly block: number
}

export function alignRows(file: FilePatch): readonly SideRow[]
export function blockLines(rows: readonly SideRow[], block: number): readonly number[]
export function blockCount(rows: readonly SideRow[]): number
```

Pairing rule: within a run of consecutive changed lines, deletions and additions
pair up positionally (1st del with 1st add, 2nd with 2nd …) into `change` rows;
whatever is left over becomes one-sided `del` or `add` rows. This is what makes
a one-line edit render as one row with both sides, the way IDEA shows it,
instead of a delete row above an add row.

A **block** is a maximal run of changed rows uninterrupted by a `same` row. It
is the unit the stage/discard buttons act on.

`blockLines(rows, block)` returns **every** hunk line index the block covers:
each row's `leftIndex` and `rightIndex` where they are not -1, ascending, no
duplicates. That array is exactly `applyBlocks`'s `lines` argument, and the
correspondence is the contract that makes the buttons correct — it is asserted
directly against `emitPatch` in the tests below.

Tests (`tests/side-rows.test.ts`), all pure:

- a pure-context diff yields all `same` rows and `blockCount === 0`;
- an equal-length del/add run pairs into `change` rows;
- 3 dels and 1 add yields 1 `change` plus 2 `del`;
- 1 del and 3 adds yields 1 `change` plus 2 `add`;
- two runs separated by one context line are two blocks;
- `blockLines` returns indices that, fed to `emitPatch`, reproduce exactly that
  block (assert against `patch-model` directly — this is the contract that
  makes the buttons correct);
- line numbers on both sides are continuous and correct across a block;
- a new-file diff (`--- /dev/null`) has an empty left column throughout.

### 3.2 Rendering

New component in `GitWorkbenchPanel.tsx`, alongside `DiffView` rather than
replacing it (history and compare tabs keep the unified view):

- two columns, one shared vertical scroll, aligned rows;
- existing syntax highlighting via `highlight.ts` — highlight per column;
- the gutter shows each side's real line number, blank where a side is absent;
- a block renders with a hover affordance carrying its buttons: unstaged tab →
  「暂存这块 / 撤回这块」, staged tab →「取消暂存这块」;
- the right column of the unstaged tab is editable. Start with a plain
  `contenteditable`/`textarea` overlay aligned to the row grid — **no editor
  library in the first cut**; revisit only if line-level editing proves
  insufficient, and record a bundle-size budget then;
- while the buffer is dirty: the Save button enables, the tab cannot be
  switched without a prompt, and block buttons are disabled (a patch computed
  from a stale diff must not be applied on top of unsaved edits).

Keep the new component in its own file if `GitWorkbenchPanel.tsx` growth
becomes awkward — it is already ~4500 lines, and a self-contained
`SideBySideView.tsx` is a reasonable boundary.

### 3.3 Locale keys

Both dictionaries in `src/client/locales.ts`, zh + en. At minimum: tab labels,
the three block actions, save, revert-buffer, the too-large notice, the binary
notice, the stale-diff error, the stale-file error, the unsaved-changes prompt.

---

## 4. Failure surfaces, and what each one must say

The predecessor bug this design exists to avoid: a failed action that reports
nothing looks exactly like a dead button, and the natural response to a dead
button is to click it again. Every path below produces a visible sentence.

| Situation | Detected by | Message |
| --- | --- | --- |
| File changed since the diff was rendered | `diffSha` mismatch | "this file changed since the diff was loaded; nothing was applied" + auto-reload the pane |
| File changed since the editor opened | `expectedSha` mismatch | "this file changed while you were editing it" + offer reload (losing edits) or overwrite via a fresh open |
| Patch does not apply | `git apply --check` | git's stderr, verbatim |
| Empty selection | client-side | no call at all; the button is disabled |
| Binary / too large | `fileSides` flags | fall back to the existing view, state why |

---

## 5. Verification

1. `npm run typecheck` and `npm test` green.
2. `tests/patch-model.git.test.ts` extended: for a multi-block file, staging
   block 1 leaves block 0 unstaged; discarding block 0 reverts only those lines;
   unstaging from the staged layer round-trips.
3. A new git-backed test for `writeChecked`'s stale path: write the file behind
   the RPC's back, then attempt a save with the old sha and assert nothing was
   written.
4. Live probe against dsh (see `scripts/verify_worktree_ui.py` for the pattern —
   `wait_until='domcontentloaded'`, **never** `networkidle`; CSS-module classes
   are hashed, select with `[class*="localName"]`; a fresh headless context
   defaults to the **English** dictionary, so match both spellings). Cover: both
   tabs render the full file; a block stages and the tree's staged count moves;
   an edit saves and the diff re-renders; a concurrent write makes the save fail
   with the stale message rather than clobbering.
5. Run everything against the fixture worktree, never a tree in use.

---

## 6. Non-goals

- No editing of the index (staged) side.
- No `writeFile` RPC without a sha check.
- No `git clean`, `reset --hard`, `checkout -f`, or `--force` anywhere — the
  doctrine in the header of `src/git-ops.ts` stands.
- No collaborative editing. The agent is the only other writer, and it is
  handled by refusing, not by merging.
- No editor library in the first cut.
- No new file creation, rename or delete — a later stage, evaluated separately.

---

## 7. Suggested order

1. Move `patch-model.ts` to `src/`, prove both bundlers accept it. **Stop and
   confirm before continuing** — everything else assumes it.
2. `fileSides` + `side-rows.ts` + tests. Read-only side-by-side view, both tabs.
3. `applyBlocks` + block buttons, discard behind the confirmation chain.
4. `writeChecked` + the editable right column and its save/stale handling.

Each step is independently shippable and independently revertable. Steps 3 and
4 do not depend on each other.

---

## 8. Addendum: what shipped, and where it differs

Recorded after the implementation on `feat/editable-diff` and its whole-branch
review (2026-08-19). Each item names the section it qualifies; the
qualification is for the case named, not a retraction of the rest.

**(a) While armed, the editor is a dense two-column layout — §3.2's "textarea
overlay aligned to the row grid" is superseded for the armed state.** The
transparent-textarea-over-its-own-rendered-lines technique is exactly what
shipped; what it is aligned to changed. One grid cannot stay diff-aligned and
hold a buffer whose line count diverges from the diff the moment a keystroke
lands — that alignment would be a per-keystroke diff. So arming swaps the pane
to a dense layout: the left column renders the index side densely (one row per
index line, no diff holes) and the right column is the buffer. The
diff-aligned two-column view returns the moment the buffer drops.

**(b) An empty layer diff is a state of the pane's BODY, never of the pane.**
The tab row — Unstaged/Staged, plus the Edit/Save cluster — always renders, and
the no-change sentence renders below it. The empty cases are happy paths, not
edge cases: a fully staged file's unstaged side, a file with nothing staged. A
pane-level empty return there hides the other layer's tab (and its unstage
action) for exactly those files, and the Edit button still belongs — the
working tree is the edit target even when every change in it is already
staged. The empty case is deliberately NOT routed to the old unified view:
that would resurrect the merged-layer view inside the new mode.
`side-rows.ts`'s `sideBodyState` is this decision as code.

**(c) `emitPatch` grew a third parameter: reverse-apply emission.** `discard`
(`apply --reverse` against the working tree) and `unstage` (`apply --cached
--reverse` against the index) apply the patch at a target holding the patch's
POST-image, so git's forward `add -p` rules mirror there: an unselected `+`
line becomes CONTEXT (the target does have it) and an unselected `-` line is
DROPPED (the target never had it); selected lines keep their sign either way.
Emitted with the forward rules, a subset patch fails against the post-image
with "patch does not apply" — confirmed against git itself and pinned by the
staged-layer cases in `tests/patch-model.git.test.ts`.

**(d) Known first-cut limits, as follow-ups.**

- The block action bar is pointer-only: hover carries it, and there is no
  keyboard path to a block's stage/roll-back buttons.
- Highlighting is whole-buffer per change — O(buffer) per keystroke — not
  incremental.
- The diff-text cap counts UTF-16 code units (`String.length`), not bytes: a
  diff of text whose characters take 3 UTF-8 bytes per unit can carry up to 3x
  the byte budget the cap was sized for. (The target-side cap is exact — real
  bytes off `stat`/`Buffer`.)
- `preferredFile`'s fallback is unguarded: when the file being edited vanishes
  from the tree (the agent committed it), the pane re-points at another file
  and the buffer drops with it — no unsaved-edits question, because no gesture
  fired.
