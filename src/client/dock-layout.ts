export type WorkbenchTab = 'changes' | 'history' | 'compare' | 'files'
export type DockPage = 'commits' | 'files' | 'code'
export type DockPages = Readonly<Record<WorkbenchTab, DockPage>>

export const DOCK_PAGES: DockPages = { changes: 'code', history: 'commits', compare: 'files', files: 'files' }

/** Navigation hides retained panes; only an actual file/version change leaves edits. */
export function dockNavigate(pages: DockPages, tab: WorkbenchTab, page: DockPage): DockPages {
  if (page === 'commits' && tab !== 'history' || pages[tab] === page) return pages
  return { ...pages, [tab]: page }
}

/** The split log stays visible, so its landing page can show the first diff. */
export function dockVisiblePage(tab: WorkbenchTab, page: DockPage, hasFile: boolean, splitHistory: boolean): DockPage {
  const detail = tab === 'history' && splitHistory && page === 'commits' ? 'code' : page
  return detail === 'code' && !hasFile ? 'files' : detail
}

export function adjacentFiles(files: readonly { path: string }[], active: string | null): { previous: string | null; next: string | null } {
  const at = files.findIndex(file => file.path === active)
  return at < 0 ? { previous: null, next: null } : { previous: files[at - 1]?.path ?? null, next: files[at + 1]?.path ?? null }
}
