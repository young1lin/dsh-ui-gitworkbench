import { stat } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'

export interface NativeFileLocation { readonly repository: string; readonly path: string; readonly absolutePath: string; readonly deleted: boolean }

/** Discover only ancestors of the explicit native target, including removed paths. */
export async function locateNativeFile(path: string, repoRoot: (directory: string) => Promise<string | null>): Promise<NativeFileLocation | null> {
  if (typeof path !== 'string' || !isAbsolute(path) || /[\u0000-\u001f]/.test(path)) return null
  const absolute = resolve(path)
  let deleted = false
  try { if (!(await stat(absolute)).isFile()) return null }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; deleted = true }
  let directory = dirname(absolute)
  for (;;) {
    try { if ((await stat(directory)).isDirectory()) break }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const parent = dirname(directory)
    if (parent === directory) return null
    directory = parent
  }
  const repository = await repoRoot(directory)
  if (!repository) return null
  const rel = relative(repository, absolute).replace(/\\/g, '/')
  if (!rel || rel === '..' || rel.startsWith('../') || isAbsolute(rel)) return null
  return { repository: repository.replace(/\\/g, '/'), path: rel, absolutePath: absolute.replace(/\\/g, '/'), deleted }
}
