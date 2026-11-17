/** JSON-safe identity of the file and Git view the user actually selected. */
export type ReferenceView =
  | { readonly kind: 'working' }
  | { readonly kind: 'commit'; readonly commit: string }
  | { readonly kind: 'compare'; readonly base: string; readonly head: string }

export interface ReferenceRequest {
  readonly repoRoot?: string
  readonly path: string
  readonly deleted: boolean
  readonly previousPath?: string
  readonly view: ReferenceView
}

export interface FileReference {
  readonly repoRoot: string
  readonly path: string
  readonly absolutePath: string
  readonly kind: 'file' | 'git'
  readonly deleted: boolean
  readonly revision: string | null
  readonly revisionPath: string
  readonly blob: string | null
  readonly change: string | null
  readonly previousPath?: string
}

/** Immutable endpoints of the displayed diff; base is the actual merge base. */
export interface ReferenceRange {
  readonly base: string
  readonly head: string
}
