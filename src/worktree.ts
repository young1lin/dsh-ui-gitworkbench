// src/worktree.ts — Task 1 delivers only the binding storage; later tasks append.
import { join } from 'node:path'
import { saveJsonAtomic } from './atomic-json.js'

export interface WorktreeBinding {
  readonly repoRoot: string
  readonly worktreePath: string
  readonly name: string
  readonly enteredAt: string
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
  return base === undefined || (typeof base === 'string' && base.length > 0)
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

const NAME_PATTERN = /^[A-Za-z0-9._-]{1,40}$/

export interface WorktreeEntry { readonly path: string; readonly head: string; readonly branch: string }

export function sanitizeName(raw: string | undefined, rng: () => string): string {
  if (raw !== undefined && NAME_PATTERN.test(raw) && raw !== '.' && raw !== '..') return raw
  return `wt-${rng()}`
}

export function branchFor(name: string): string { return `wt/${name}` }

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

export function worktreeDir(repoRoot: string, name: string): string {
  return `${repoRoot.replace(/\/+$/, '')}/.agents/worktrees/${name}`
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
