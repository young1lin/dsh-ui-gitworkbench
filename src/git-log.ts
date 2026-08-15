/**
 * Commit-log records from `git log` / `git show`.
 *
 * Subject (`%s`) is the first line; body (`%b`) is everything after the blank
 * line. Records are delimited by ASCII RS (`%x1e`) so a body may contain
 * newlines without breaking the parse. Fields inside a record are US (`%x1f`).
 *
 * `body` is always a string (empty when the commit has none). RPC payloads
 * cannot carry `undefined`.
 */

export interface GitCommit {
  readonly hash: string
  readonly subject: string
  readonly when: string
  readonly body: string
  /**
   * Abbreviated parent hashes, in git's order — first parent first. This is the
   * DAG: the commit graph is drawn from nothing else. Empty for a root commit.
   */
  readonly parents: readonly string[]
  /**
   * Branch and tag names pointing at this commit, already stripped of git's
   * `HEAD -> ` and `tag: ` prefixes. Empty for the overwhelming majority.
   */
  readonly refs: readonly string[]
}

/**
 * Pretty format: RS, hash, when, subject, parents, refs, body.
 *
 * `body` stays last because it is the only field that may contain newlines;
 * anything after it would have to survive them. Parents (`%p`) and refs (`%D`)
 * are single-line by construction.
 */
export const LOG_FORMAT = '%x1e%h%x1f%cr%x1f%s%x1f%p%x1f%D%x1f%b'

/**
 * Split `%D` into plain ref names.
 *
 * git writes decorations as a comma-joined list where HEAD is an arrow pair
 * (`HEAD -> main`) and tags carry a `tag: ` prefix. Both are rendered as the
 * bare name; which kind of ref it is does not change what the row shows.
 * @param decoration - the `%D` field, possibly empty.
 */
function parseRefs(decoration: string): string[] {
  const out: string[] = []
  for (const raw of decoration.split(',')) {
    let name = raw.trim()
    if (name.length === 0) continue
    // `HEAD -> main` names the branch HEAD is on; keep the branch.
    const arrow = name.indexOf('->')
    if (arrow !== -1) name = name.slice(arrow + 2).trim()
    if (name.startsWith('tag:')) name = name.slice(4).trim()
    // A remote's HEAD is a symbolic ref: it always points where that remote's
    // default branch already points, so it is a second label for a commit that
    // is guaranteed to carry the first. In a log row it is pure noise.
    if (name === 'origin/HEAD' || name.endsWith('/HEAD')) continue
    if (name.length > 0) out.push(name)
  }
  return out
}

/**
 * Parse a `LOG_FORMAT` stream into commits.
 * @param stdout - git's stdout.
 */
export function parseLog(stdout: string): GitCommit[] {
  const out: GitCommit[] = []
  for (const record of stdout.split('\x1e')) {
    if (record.length === 0) continue
    const parts = record.split('\x1f')
    if (parts.length < 3) continue
    const hash = parts[0]!.trim()
    const when = parts[1] ?? ''
    const subject = (parts[2] ?? '').replace(/\n+$/g, '')
    const parents = (parts[3] ?? '').trim().split(/\s+/).filter(part => part.length > 0)
    const refs = parseRefs(parts[4] ?? '')
    const body = (parts[5] ?? '').replace(/^\n+/, '').replace(/\n+$/g, '')
    if (hash.length > 0) out.push({ hash, subject, when, body, parents, refs })
  }
  return out
}

/**
 * The text a "copy message" action puts on the clipboard: subject, then a
 * blank line, then the body when there is one.
 * @param commit - parsed commit.
 */
export function commitMessageText(commit: GitCommit): string {
  return commit.body.length > 0 ? `${commit.subject}\n\n${commit.body}` : commit.subject
}
