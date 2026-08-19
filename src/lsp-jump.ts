/**
 * Turning one LSP definition answer into something this drawer can open.
 *
 * The seam hands back locations as URIs verbatim from the language server,
 * plus `resolvedWorkspaceUri` — the provider's own canonical `file:` URI for
 * the workspace root. Relativizing against THAT string, rather than against
 * the path this process asked with, is a requirement of the seam and not a
 * style choice: the request root may be a symlink, and the server may be
 * executing on a different platform than the caller.
 *
 * Two things make the comparison harder than a `startsWith`.
 *
 * Encoding. `file:///c%3A/src` and `file:///c:/src` name the same directory,
 * and different servers emit both. A raw prefix test calls the second one
 * "outside the repository", and the jump silently stops working for a whole
 * language.
 *
 * Case. On Windows the same directory is reachable as `C:\` and `c:\`, and a
 * server that canonicalizes differently than git does would again land
 * outside. The retry below is deliberately narrow — it loosens case ONLY when
 * both sides look like drive-letter paths, so a genuinely case-sensitive
 * filesystem keeps its two distinct directories distinct.
 *
 * Everything here is pure, so it is testable without a language server, and
 * the client half imports the payload type from this module rather than
 * mirroring it — a mirrored interface is a second source of truth that drifts.
 *
 * @module @young1lin/dsh-ui-gitworkbench/lsp-jump
 */

/** A zero-based UTF-16 cursor coordinate, matching the LSP wire convention. */
export interface JumpPosition {
  readonly line: number
  readonly character: number
}

/**
 * One location as the seam reports it. A structural mirror of `LspLocation`
 * from `@deepseek-ai/dsh-lsp` (0.1.0-rc.7), declared here rather than imported
 * because the package is an OPTIONAL host capability: this plugin must
 * typecheck, build and run in an assembly that never loads it. Only the two
 * fields actually read are mirrored, which is also what keeps the copy from
 * drifting.
 */
export interface JumpLocation {
  readonly uri: string
  readonly range: { readonly start: JumpPosition }
}

/**
 * Why a jump did not land somewhere openable. Every outcome is a sentence the
 * drawer can say out loud — there is no bucket meaning "something went wrong",
 * because the real cases want different words:
 *
 * - `unavailable`: there is no `ctx.lsp` at all. The ordinary state of a stock
 *   dsh profile, since no bundle loads the seam — a fact about the INSTALL,
 *   true for every file, and the one the UI may act on permanently.
 * - `unclaimed`: the seam is there and no provider handles this file's
 *   extension. A fact about THIS FILE: the same drawer jumps normally in a
 *   language the operator did configure. Kept apart from `unavailable`
 *   precisely because conflating them makes any "stop offering this" rule
 *   wrong — one press in a README would switch the feature off for the .ts
 *   files where it works.
 * - `none`: the server answered, and there is no definition at that position.
 * - `outside`: there is a definition and it is not in this repository — a jar,
 *   a `node_modules` package, a `jdt://` synthetic document. Naming where it
 *   went is more use than pretending the query failed.
 * - `error`: the server or the seam threw.
 */
export type JumpOutcome = 'ok' | 'none' | 'outside' | 'unavailable' | 'unclaimed' | 'error'

/**
 * The `gitWorkbench/goToDefinition` payload.
 *
 * Every field is present in every outcome, carrying a neutral value when it
 * does not apply: the Typert gateway's payloads may not hold `undefined`, and
 * a partial shape would push that rule onto each call site.
 *
 * `line` and `character` stay ZERO-BASED here, as the protocol has them. The
 * single conversion to the editor's one-based lines lives in the client's
 * `jump-view.ts`, so no code between the server and that function has to
 * remember which convention it is holding.
 */
export interface JumpTarget {
  readonly outcome: JumpOutcome
  /** Repository-relative, forward slashes; '' unless `outcome` is 'ok'. */
  readonly path: string
  /** Zero-based line; 0 unless `outcome` is 'ok'. */
  readonly line: number
  /** Zero-based UTF-16 character; 0 unless `outcome` is 'ok'. */
  readonly character: number
  /** The raw URI, for 'outside' — the client shortens it. '' otherwise. */
  readonly uri: string
  /** Message for 'error'; '' otherwise. */
  readonly message: string
}

/** A {@link JumpTarget} carrying nothing but its reason. */
export function jumpDeclined(outcome: JumpOutcome, uri: string, message: string): JumpTarget {
  return { outcome, path: '', line: 0, character: 0, uri, message }
}

/**
 * Normalize a `file:` URI to a comparable path string.
 *
 * Returns null for anything that is not a `file:` URI, which is how synthetic
 * documents (`jdt://contents/...` from Eclipse JDT, `zipfile://` from others)
 * are recognised: they are real answers naming real code, but there is no path
 * on disk behind them, so nothing downstream can open one.
 */
export function fileUriToPath(uri: string): string | null {
  if (!uri.startsWith('file://')) return null
  let rest = uri.slice('file://'.length)
  // Strip a query or fragment before decoding: neither is part of the path,
  // and a '#' inside a decoded path would afterwards be indistinguishable.
  const cut = rest.search(/[?#]/)
  if (cut !== -1) rest = rest.slice(0, cut)
  let decoded: string
  try {
    decoded = decodeURIComponent(rest)
  } catch {
    // A malformed escape is not a path. Refusing beats guessing at bytes.
    return null
  }
  // A server on Windows may emit either separator; the comparison below needs
  // one spelling.
  let path = decoded.replace(/\\/g, '/')
  path = path.replace(/\/{2,}/g, '/')
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)
  // `/c:/x` and `/C:/x` are the same drive. Fixing the case here means the
  // prefix test below does not have to know about drives at all.
  path = path.replace(/^\/([a-zA-Z]):/, (_all, drive: string) => '/' + drive.toUpperCase() + ':')
  return path
}

/** True when a path has the Windows drive-letter shape (`/C:/…`). */
function isDrivePath(path: string): boolean {
  return /^\/[A-Za-z]:(\/|$)/.test(path)
}

/**
 * The location's path relative to the workspace root, or null when it falls
 * outside — including when either URI is not a `file:` URI at all.
 *
 * The result uses forward slashes and no leading slash, which is the spelling
 * every other path in this plugin already uses: git's own.
 */
export function repoRelative(uri: string, workspaceUri: string): string | null {
  const target = fileUriToPath(uri)
  const root = fileUriToPath(workspaceUri)
  if (target === null || root === null || root === '') return null
  const base = root.endsWith('/') ? root.slice(0, -1) : root
  const inside = (a: string, b: string): boolean => a.startsWith(b + '/')
  let relative: string | null = null
  if (inside(target, base)) {
    relative = target.slice(base.length + 1)
  } else if (isDrivePath(target) && isDrivePath(base)
    && inside(target.toLowerCase(), base.toLowerCase())) {
    // Windows only, and only for the drive-path shape: see the module note.
    relative = target.slice(base.length + 1)
  }
  if (relative === null || relative === '') return null
  // Nothing well-formed produces these after the normalization above, so their
  // presence means the input was crafted rather than merely unusual.
  if (relative.split('/').some(part => part === '..' || part === '.')) return null
  return relative
}

/**
 * What a thrown query means to the drawer.
 *
 * Routed on the seam's stable `code`, never on the message: the seam documents
 * the codes precisely so callers do not parse prose that is free to change.
 *
 * `LSP_UNAVAILABLE` becomes `unclaimed` rather than `unavailable`, which is
 * the distinction the whole outcome union exists for. The seam throws it when
 * no registered provider handles the file's extension — so the operator DID
 * configure a language server, it just does not cover this file. Reporting
 * that as "nothing is installed" would be false, and any UI rule that acts on
 * "nothing is installed" would then misfire in the languages that work.
 */
export function classifyJumpError(error: unknown): JumpTarget {
  const code = (error as { code?: unknown } | null | undefined)?.code
  if (code === 'LSP_UNAVAILABLE') return jumpDeclined('unclaimed', '', '')
  return jumpDeclined('error', '', error instanceof Error ? error.message : String(error))
}

/**
 * Which of several definitions to open.
 *
 * Servers usually answer with one. When they answer with several, a definition
 * INSIDE the repository is the one a reviewer means: the question being asked
 * is "where does this come from in the code I am reading", and a declaration
 * in a dependency does not answer it. Falling back to the first location keeps
 * the out-of-repo case reportable rather than dropping it.
 */
export function pickLocation(
  locations: readonly JumpLocation[],
  workspaceUri: string,
): JumpLocation | null {
  if (locations.length === 0) return null
  for (const location of locations) {
    if (repoRelative(location.uri, workspaceUri) !== null) return location
  }
  return locations[0] ?? null
}

/**
 * The whole normalization, from the seam's answer to the drawer's payload.
 *
 * Kept as one function over plain data so the RPC method around it holds
 * nothing but the call and its error handling — every decision in here is
 * reachable from a unit test with no host, no process and no language server.
 */
export function toJumpTarget(
  locations: readonly JumpLocation[],
  workspaceUri: string,
): JumpTarget {
  const chosen = pickLocation(locations, workspaceUri)
  if (chosen === null) return jumpDeclined('none', '', '')
  const relative = repoRelative(chosen.uri, workspaceUri)
  if (relative === null) return jumpDeclined('outside', chosen.uri, '')
  const start = chosen.range.start
  // A server sending a negative or fractional line is malformed rather than
  // meaningful; clamping to the top of the file beats discarding an
  // otherwise-good path.
  const line = Number.isFinite(start.line) ? Math.max(0, Math.trunc(start.line)) : 0
  const character = Number.isFinite(start.character) ? Math.max(0, Math.trunc(start.character)) : 0
  return { outcome: 'ok', path: relative, line, character, uri: '', message: '' }
}
