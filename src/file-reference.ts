import { stat } from 'node:fs/promises'
import { resolveInside } from './path-lock.js'
import type { FileReference, ReferenceRange, ReferenceRequest } from './reference-contract.js'

type GitRead = (args: readonly string[]) => Promise<{ stdout: string; exitCode: number }>
const HASH = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i

/** Freeze both tips before diffing, including the unrelated-history fallback. */
export async function freezeComparison(git: GitRead, base: string, head: string): Promise<ReferenceRange & { tipBase: string }> {
  const [left, right] = await Promise.all([
    git(['rev-parse', '--verify', `${base}^{commit}`]),
    git(['rev-parse', '--verify', `${head}^{commit}`]),
  ])
  const tipBase = left.stdout.trim()
  const tipHead = right.stdout.trim()
  if (left.exitCode !== 0 || right.exitCode !== 0 || !HASH.test(tipBase) || !HASH.test(tipHead)) throw new Error('comparison revision unavailable')
  const merge = await git(['merge-base', tipBase, tipHead])
  const common = merge.stdout.trim()
  if (merge.exitCode !== 1 && (merge.exitCode !== 0 || !HASH.test(common))) throw new Error('merge base unavailable')
  return { base: merge.exitCode === 1 ? tipBase : common, head: tipHead, tipBase }
}

/** Resolve one selected file without reading its contents or walking the tree. */
export async function resolveFileReference(root: string, request: ReferenceRequest, git: GitRead): Promise<FileReference> {
  const rootKey = (value: string): string => {
    const path = value.replace(/\\/g, '/').replace(/\/$/, '')
    return process.platform === 'win32' ? path.toLowerCase() : path
  }
  if (request.repoRoot !== undefined && rootKey(request.repoRoot) !== rootKey(root)) throw new Error('repository root changed')
  const absolutePath = resolveInside(root, request.path).replace(/\\/g, '/')
  if (request.previousPath !== undefined) resolveInside(root, request.previousPath)
  const readHash = async (spec: string): Promise<string | null> => {
    const result = await git(['rev-parse', '--verify', spec])
    const hash = result.stdout.trim()
    return result.exitCode === 0 && HASH.test(hash) ? hash : null
  }
  const base = { repoRoot: root.replace(/\\/g, '/'), path: request.path, absolutePath,
    deleted: request.deleted, ...request.previousPath === undefined ? {} : { previousPath: request.previousPath } }
  if (request.view.kind === 'working' && !request.deleted) {
    if (!(await stat(absolutePath)).isFile()) throw new Error('not a file')
    return { ...base, kind: 'file', revision: null, revisionPath: request.path, blob: null, change: null }
  }
  let revision: string | null
  let change: string | null
  if (request.view.kind === 'working') {
    revision = await readHash('HEAD^{commit}')
    change = null
  } else if (request.view.kind === 'commit') {
    if (!/^[0-9a-f]{4,64}$/i.test(request.view.commit)) throw new Error('not a commit hash')
    change = await readHash(`${request.view.commit}^{commit}`)
    if (change === null) throw new Error('commit unavailable')
    revision = request.deleted ? await readHash(`${change}^1`) : change
  } else {
    // Symbolic refs can move after the comparison was painted. Only accept
    // the frozen endpoints returned alongside that exact displayed result.
    if (!HASH.test(request.view.base) || !HASH.test(request.view.head)) throw new Error('comparison needs frozen revisions')
    revision = request.deleted ? request.view.base : request.view.head
    change = `${request.view.base}..${request.view.head}`
  }
  const path = request.deleted ? request.previousPath ?? request.path : request.path
  let blob = revision === null ? null : await readHash(`${revision}:${path}`)
  if (blob === null && request.view.kind === 'working') {
    // A staged addition deleted from disk has no HEAD version. Freeze its
    // index object, rather than inventing a HEAD path or a live file mention.
    revision = null
    blob = await readHash(`:${path}`)
  }
  if (blob === null && request.view.kind !== 'working') throw new Error('file version unavailable')
  if (blob !== null) {
    const type = await git(['cat-file', '-t', blob])
    if (type.exitCode !== 0 || type.stdout.trim() !== 'blob') throw new Error('not a file blob')
  }
  return { ...base, kind: 'git', revision, revisionPath: path, blob, change }
}
