// src/worktree.ts — Task 1 delivers only the binding storage; later tasks append.
import { join } from 'node:path'
import { saveJsonAtomic } from './atomic-json.js'

export interface WorktreeBinding {
  readonly repoRoot: string
  readonly worktreePath: string
  readonly name: string
  readonly enteredAt: string
  /**
   * The branch checked out in the bound worktree. Optional on purpose:
   * bindings written before this field existed stay valid; a consumer without
   * it falls back to reading the branch off the worktree list.
   */
  readonly branch?: string
  /**
   * Commit the worktree's branch started from. Optional on purpose: bindings
   * written before this field existed stay valid, and a reuse path can fail to
   * recover a historical branch point. A consumer without it falls back to
   * diffing against the worktree's own HEAD.
   */
  readonly baseCommit?: string
}

export interface BindingsFile { readonly v: 1; readonly bindings: Record<string, WorktreeBinding> }

const BINDINGS_FIELDS = ['repoRoot', 'worktreePath', 'name', 'enteredAt'] as const

function emptyFile(): BindingsFile { return { v: 1, bindings: {} } }

function isBinding(value: unknown): value is WorktreeBinding {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  if (!BINDINGS_FIELDS.every(field => typeof record[field] === 'string' && (record[field] as string).length > 0)) return false
  // Absent is normal; present-but-malformed is corruption, and dropping the
  // whole record beats trusting half of it.
  const base = record['baseCommit']
  const branch = record['branch']
  return (base === undefined || (typeof base === 'string' && base.length > 0))
    && (branch === undefined || (typeof branch === 'string' && branch.length > 0))
}

export function bindingsPath(home: string): string {
  return join(home, '.dsh', 'gitworkbench-worktree-bindings.json').replace(/\\/g, '/')
}

export function parseBindings(raw: string): BindingsFile {
  try {
    const parsed = JSON.parse(raw) as { v?: unknown; bindings?: unknown }
    if (parsed?.v !== 1 || typeof parsed.bindings !== 'object' || parsed.bindings === null) return emptyFile()
    const out = emptyFile()
    for (const [sessionId, value] of Object.entries(parsed.bindings as Record<string, unknown>)) {
      if (sessionId.length > 0 && isBinding(value)) out.bindings[sessionId] = value
    }
    return out
  } catch {
    return emptyFile()
  }
}

export async function loadBindings(readText: (path: string) => Promise<string>, path: string): Promise<BindingsFile> {
  try { return parseBindings(await readText(path)) } catch { return emptyFile() }
}

export async function saveBindings(
  ensureDir: (dir: string) => Promise<void>,
  writeText: (path: string, text: string) => Promise<void>,
  rename: (from: string, to: string) => Promise<void>,
  path: string,
  file: BindingsFile,
): Promise<void> {
  await saveJsonAtomic(ensureDir, writeText, rename, path, file)
}

// ---- Task 3: RPC return shapes (all JSON-safe; success writes no error key) ----

export interface WorktreeOpResult {
  readonly ok: boolean
  /** Present on success. */
  readonly worktreePath?: string
  /** Present on success of enter/exit. */
  readonly branch?: string
  /** Operational guidance for the model, present when meaningful. */
  readonly hint?: string
  /** Present on failure only. */
  readonly error?: string
}

// ---- Task 2: worktree name/branch/path derivation + porcelain parsing ----

/**
 * The charset a worktree name may use: the intersection of what git accepts
 * in a ref component and what survives as a Windows directory name.
 *
 * The name is used verbatim as BOTH the directory under `.agents/worktrees/`
 * and the branch — there is NO forced prefix, the name the caller asks for is
 * the branch it gets — so every character must be legal in both worlds:
 *
 *   - git (check-ref-format): rejects `..`, a trailing dot, a `.lock` ending,
 *     control characters, space and `~ ^ : ? * [ \`. `+` is LEGAL — the
 *     earlier allowlist `[A-Za-z0-9._-]` rejected it and silently renamed
 *     `feature+20260810-...` to a generated `wt-<hex>`.
 *   - Windows (NTFS): rejects `< > : " | ? *` (git already covers those) and
 *     the reserved device names CON/PRN/AUX/NUL/COM1-9/LPT1-9 — even before
 *     the first dot, case-insensitive — which git never objects to.
 *   - argv: a leading `-` would read as an option; a leading `.` both hides
 *     the directory and starts the dot-component git rejects. So: start
 *     alphanumeric.
 */
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/
/** Windows device names that are legal git branches but catastrophic dirs. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

function isWorktreeName(raw: string): boolean {
  return NAME_PATTERN.test(raw)
    && !raw.includes('..')
    && !raw.endsWith('.')
    && !raw.endsWith('.lock')
    && raw.toLowerCase() !== 'head'
    && !WINDOWS_RESERVED.test(raw.split('.')[0] ?? raw)
}

export interface WorktreeEntry { readonly path: string; readonly head: string; readonly branch: string }

export function sanitizeName(raw: string | undefined, rng: () => string): string {
  if (raw !== undefined && isWorktreeName(raw)) return raw
  // No `wt-` here either: the caller's name is the identity everywhere, so a
  // generated fallback gets a neutral, self-describing one instead.
  return `worktree-${rng()}`
}

/** Resolves a path or fails — the failure is the caller's "does not exist". */
export type PathResolver = (path: string) => Promise<string>

async function resolveReal(resolve: PathResolver, path: string): Promise<string | null> {
  try { return (await resolve(path.replace(/\\/g, '/'))).replace(/\\/g, '/') } catch { return null }
}

/**
 * Find the registered worktree that IS `dir`, if any.
 *
 * String comparison is not enough: `.agents/worktrees` may be a junction to
 * `.claude/worktrees`, and git lists the path a worktree was REGISTERED
 * under, not the spelling this session would type. Both sides go through a
 * real-path resolution, so junctions, symlinks and separator styles collapse
 * to the same directory — and a worktree made by another tool (checked out
 * under its own branch, no `wt/` anywhere) is recognized and reused instead
 * of colliding with `git worktree add`.
 * @param entries - parsed `git worktree list --porcelain`.
 * @param dir - the worktree directory the caller wants.
 * @param resolve - real-path resolver (node:fs/promises realpath in the host).
 */
export async function findRegisteredWorktree(entries: readonly WorktreeEntry[], dir: string, resolve: PathResolver): Promise<WorktreeEntry | undefined> {
  const target = await resolveReal(resolve, dir)
  if (target === null) return undefined
  for (const entry of entries) {
    if (await resolveReal(resolve, entry.path) === target) return entry
  }
  return undefined
}

/** Longest ref name accepted — well past any real branch, short of a payload. */
const REF_MAX_LENGTH = 200
/** The character set git allows in a branch or tag name. */
const REF_CHARS = /^[A-Za-z0-9._/-]+$/

/**
 * Decide whether a ref name from an untrusted caller may be passed to git.
 *
 * A ref arrives from the browser as free text and becomes a POSITIONAL argument,
 * so three things are rejected before it gets there: a leading `-`, which git
 * would read as an option rather than a ref; `..`, which is range syntax and
 * would silently change what a comparison covers; and any character outside the
 * set git accepts in a ref name.
 * @param ref - candidate ref name.
 * @returns true when the value is safe to pass to git as a ref.
 */
export function isRefName(ref: string): boolean {
  return typeof ref === 'string'
    && ref.length > 0 && ref.length <= REF_MAX_LENGTH
    && !ref.startsWith('-')
    && !ref.includes('..')
    && REF_CHARS.test(ref)
}

/**
 * The extra rules an ENTER branch must satisfy beyond {@link isRefName}.
 *
 * isRefName guards untrusted refs that reach git as positional arguments
 * (leading `-`, `..`, alien characters). A branch worktreeEnter CREATES has
 * two more classes of trouble: spellings check-ref-format refuses that
 * REF_CHARS happens to pass (a leading or trailing dot, a `.lock` ending),
 * and `head` — a legal ref on Linux that collides with HEAD on the
 * case-insensitive filesystems the host runs on.
 */
function isEnterBranch(branch: string): boolean {
  return isRefName(branch)
    && !branch.startsWith('.')
    && !branch.endsWith('.')
    && !branch.endsWith('.lock')
    && branch.toLowerCase() !== 'head'
}

/**
 * Decide the branch a worktreeEnter call lands on.
 *
 * The worktree NAME is the identity knob — the directory under
 * `.agents/worktrees/` — and doubles as the branch by default (the old
 * contract, kept for callers that pass no branchName). branchName splits the
 * two for the one thing the name can never express: a SLASH branch
 * (`feature/foo` is a legal ref and an impossible Windows directory).
 *
 * Reuse keeps the registered worktree's own branch, request or no request;
 * an explicit branchName it displaces is reported as branchOverridden so the
 * hint can say so — refusing there would break enter's idempotency (the same
 * call re-issued must rebind, not explode).
 *
 * An illegal branchName is REFUSED, never substituted: the worktree name may
 * be auto-generated because a directory label is arbitrary, but a branch is
 * semantic — silently renaming it lands work on the wrong branch.
 * @param wtName - sanitized worktree name (the default branch).
 * @param branchName - caller-requested branch, or undefined for the default.
 * @param existingBranch - the registered worktree's own branch when the
 * target directory already holds one, else undefined.
 * @returns the branch to create or keep, plus whether an explicit request
 * was set aside — or the refusal error.
 */
export function resolveEnterBranch(
  wtName: string,
  branchName: string | undefined,
  existingBranch: string | undefined,
): { ok: true; branch: string; branchOverridden: boolean } | { ok: false; error: string } {
  if (branchName !== undefined && !isEnterBranch(branchName)) {
    return { ok: false, error: 'branchName is not a valid branch name' }
  }
  if (existingBranch !== undefined) {
    return { ok: true, branch: existingBranch, branchOverridden: branchName !== undefined && branchName !== existingBranch }
  }
  return { ok: true, branch: branchName ?? wtName, branchOverridden: false }
}

export function worktreeDir(repoRoot: string, name: string): string {
  return `${repoRoot.replace(/\/+$/, '')}/.agents/worktrees/${name}`
}

// ---- session lineage: the binding a session effectively works under ----

/** A binding resolved for a session, with whether it is the session's own. */
export interface EffectiveBinding<T> {
  readonly binding: T
  /** False when the binding is the session's own; true when an ancestor's. */
  readonly inherited: boolean
}

/**
 * Deepest ancestor chain walked before the lookup gives up. Real delegation
 * nests two or three levels; the cap exists so a corrupt lineage (a cycle the
 * guard below somehow missed, a pathologically deep chain) costs a bounded
 * number of lookups instead of walking forever.
 */
const LINEAGE_HOP_CAP = 8

/**
 * Resolve the binding a session effectively works under: its own, else the
 * nearest ancestor's.
 *
 * A subagent session never gets a binding of its own — `worktree_enter` is
 * called by the session that wants the worktree — but it works wherever its
 * parent conversation works: the standing prompt, the chip, and `worktree_exit`'s
 * diagnostics all answer "which worktree is THIS session in" through here. The
 * walk is re-resolved on every read, so a session exiting its worktree changes
 * only its own binding: descendants lend the next bound ancestor up the chain
 * on their next read (possibly none — the common case — possibly a grandparent's,
 * which is still the conversation tree they work in) and nothing dangles.
 *
 * Own wins over inherited on purpose: a session that enters a worktree of its
 * own is deliberately somewhere else than its parent.
 * @param sessionId - the session whose effective binding is wanted.
 * @param parentOf - session id → parent session id, as `agent/session-start`
 * delivered it (subagent headers name their parent).
 * @param bindingOf - binding lookup (the bindings file, or the prompt mirror).
 * @returns the effective binding, or undefined when neither the session nor any
 * ancestor (within the hop cap) is bound.
 */
export function resolveEffectiveBinding<T>(
  sessionId: string,
  parentOf: ReadonlyMap<string, string>,
  bindingOf: (id: string) => T | undefined,
): EffectiveBinding<T> | undefined {
  const own = bindingOf(sessionId)
  if (own !== undefined) return { binding: own, inherited: false }
  const seen = new Set<string>([sessionId])
  let ancestor = parentOf.get(sessionId)
  for (let hops = 0; ancestor !== undefined && hops < LINEAGE_HOP_CAP; hops += 1) {
    if (seen.has(ancestor)) return undefined
    seen.add(ancestor)
    const binding = bindingOf(ancestor)
    if (binding !== undefined) return { binding, inherited: true }
    ancestor = parentOf.get(ancestor)
  }
  return undefined
}

/**
 * The session's parent edge, read off a dsh session header: the id of the
 * session this one was delegated by, or undefined for a top-level session (or
 * a malformed empty value). Both `parentOf` feeds — the `agent/session-start`
 * listener and the prompt-time self-heal — go through here, so their input
 * guards cannot drift apart.
 */
export function lineageEdgeOf(header: { readonly parentSession?: string } | undefined): string | undefined {
  const parent = header?.parentSession
  return typeof parent === 'string' && parent.length > 0 ? parent : undefined
}

/**
 * The standing notice for a session's effective binding — the text the
 * `worktree:binding` prompt context returns. Both variants carry the same two
 * operational rules; what differs is who holds the binding, and the inherited
 * variant must NOT offer `worktree_exit` (the caller cannot unbind a parent's
 * binding — the exit would fail, and the model should not be told to try).
 * @param name - worktree name (also the directory under `.agents/worktrees/`).
 * @param branch - branch checked out there, when known.
 * @param inherited - whether an ancestor, not this session, holds the binding.
 */
export function bindingNotice(name: string, branch: string | undefined, inherited: boolean): string {
  const rel = `.agents/worktrees/${name}`
  const branchNote = branch === undefined ? '' : ` (branch ${branch})`
  const opening = inherited
    ? `This session works in git worktree "${name}"${branchNote}, entered by its parent session.`
    : `This session is bound to git worktree "${name}"${branchNote}.`
  const closing = inherited
    ? 'A path without that prefix acts on the MAIN worktree, not the worktree this conversation works in. '
      + '(The binding belongs to the parent session; worktree_exit here would not unbind it.)'
    : 'A path without that prefix acts on the MAIN worktree, not the bound one. Call worktree_exit to unbind.'
  return `${opening}\n`
    + 'The session working directory is still the repository root, so the binding is a convention you must apply yourself:\n'
    + `- shell commands: pass workdir "${rel}"\n`
    + `- file tools: prefix every path with ${rel}/\n`
    + closing
}

export function parseWorktreeList(porcelain: string): WorktreeEntry[] {
  const out: WorktreeEntry[] = []
  let path = ''
  let head = ''
  let branch = ''
  const flush = (): void => {
    if (path.length > 0 && head.length > 0 && branch.length > 0) {
      out.push({ path, head, branch })
    }
    path = ''; head = ''; branch = ''
  }
  for (const line of porcelain.split('\n')) {
    if (line.length === 0) { flush(); continue }
    if (line.startsWith('worktree ')) path = line.slice('worktree '.length)
    else if (line.startsWith('HEAD ')) head = line.slice('HEAD '.length)
    else if (line.startsWith('branch refs/heads/')) branch = line.slice('branch refs/heads/'.length)
    else if (line === 'detached') { path = ''; head = ''; branch = '' }
  }
  flush()
  return out
}
