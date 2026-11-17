import type { UserTextRule } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ReferenceView, FileReference } from '../reference-contract.ts'
import type { CodeExcerpt } from './code-excerpt.ts'
import { referencePaths } from './file-reference.ts'

export interface WorkbenchReference {
  version: 1; repository: string; path: string; absolutePath: string; view: ReferenceView; deleted: boolean
  previousPath?: string; file?: FileReference; displayedSnapshot?: Omit<CodeExcerpt, 'text'>; code?: string
}
export type WorkbenchLink = { reference: WorkbenchReference } | { legacyPath: string }
declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface UserTextDataMap { 'git-workbench': WorkbenchLink }
}

export function serializeWorkbenchReference(value: WorkbenchReference): string {
  return `\n\`\`\`git-workbench\n${JSON.stringify(value, null, 2)}\n\`\`\`\n`
}
export function parseWorkbenchReference(text: string): WorkbenchReference | null {
  try {
    const value = JSON.parse(text) as WorkbenchReference
    if (value.version !== 1 || typeof value.repository !== 'string' || typeof value.path !== 'string'
      || typeof value.deleted !== 'boolean' || typeof value.view !== 'object' || !value.view) return null
    const absolute = referencePaths(value.repository, value.path).absolute
    if (value.absolutePath !== absolute) return null
    if (value.previousPath !== undefined) referencePaths(value.repository, value.previousPath)
    const view = value.view
    const sha = (input: unknown): boolean => typeof input === 'string' && /^[0-9a-f]{40,64}$/i.test(input)
    if (view.kind !== 'working' && !(view.kind === 'commit' && sha(view.commit))
      && !(view.kind === 'compare' && sha(view.base) && sha(view.head))) return null
    if (value.code !== undefined && typeof value.code !== 'string') return null
    if (value.displayedSnapshot !== undefined && (!value.displayedSnapshot
      || !['selection', 'hunk'].includes(value.displayedSnapshot.kind) || !['old', 'new', 'unified'].includes(value.displayedSnapshot.side)
      || typeof value.code !== 'string')) return null
    const snapshot = value.displayedSnapshot
    if (snapshot) {
      const natural = (input: unknown): input is number => typeof input === 'number' && Number.isSafeInteger(input) && input >= 0
      for (const key of ['startLine', 'endLine', 'startColumn', 'endColumn'] as const) {
        if (snapshot[key] !== undefined && (!natural(snapshot[key]) || snapshot[key] === 0)) return null
      }
      for (const key of ['oldRange', 'newRange'] as const) {
        const range = snapshot[key]
        if (range !== undefined && (!Array.isArray(range) || range.length !== 2 || !range.every(natural))) return null
      }
      if (snapshot.diffLines !== undefined && (!Array.isArray(snapshot.diffLines)
        || !snapshot.diffLines.every(row => row && natural(row.old) && natural(row.new) && typeof row.kind === 'string'))) return null
    }
    return value
  } catch { return null }
}

/** Persisted JSON keeps links meaningful after reload, on another client, and after edits. */
export const workbenchReferenceRule: UserTextRule<'git-workbench'> = {
  id: 'git-workbench', order: 20,
  match(text, from) {
    const legacy = legacyWorkbenchReferenceRule.match(text, from, { read: () => undefined })
    const blocks = /^```git-workbench\r?\n([\s\S]*?)\r?\n```(?=\r?\n|$)/gm
    blocks.lastIndex = from
    for (let match = blocks.exec(text); match; match = blocks.exec(text)) {
      const reference = parseWorkbenchReference(match[1]!)
      if (reference) return legacy && legacy.start < match.index ? legacy
        : { id: 'git-workbench', start: match.index, end: match.index + match[0].length, data: { reference } }
    }
    return legacy
  },
}

/** Earlier versions emitted absolute @file tokens without a revision or provenance. */
export const legacyWorkbenchReferenceRule: UserTextRule<'git-workbench'> = {
  id: 'git-workbench', order: 20,
  match(text, from) {
    const tokens = /(?<!\S)(@"[^"\n]+"|@[^\s]+)/gu
    tokens.lastIndex = from
    for (let match = tokens.exec(text); match; match = tokens.exec(text)) {
      const raw = match[0].startsWith('@"') ? match[0] : match[0].replace(/[.,;:!?，。；：！？]+$/u, '')
      const path = raw.slice(1).replace(/^"|"$/gu, '')
      if (!/^(?:[a-z]:[\\/]|\/)/i.test(path) || /[\\/]$/.test(path)) continue
      return { id: 'git-workbench', start: match.index, end: match.index + raw.length, data: { legacyPath: path } }
    }
    return undefined
  },
}
