import type { ReactNode } from 'react'
import css from './GitWorkbenchPanel.module.css'

/**
 * Tree glyph: a root with two working copies hanging off it.
 *
 * This was git's fork glyph — the three-dot branch symbol — which named the
 * wrong thing. A worktree is not a branch; the picker beside it is already full
 * of branch names, and the two ideas need to stay tellable apart at 12px. A
 * hierarchy reads as "one repository, several directories", which is what a
 * worktree list is.
 */
export function WorktreeGlyph(): ReactNode {
  return (
    <svg className={css.cardGlyph} width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      {/* Trunk down from the root, and the two limbs it puts out. */}
      <path d="M2.25 2.75h1.5v10.5h-1.5zM3 6.75h7.25v1.5H3zM3 11.75h7.25v1.5H3z" />
      {/* The root, then the worktrees. */}
      <circle cx="3" cy="2.75" r="1.75" />
      <circle cx="12" cy="7.5" r="1.75" />
      <circle cx="12" cy="12.5" r="1.75" />
    </svg>
  )
}
