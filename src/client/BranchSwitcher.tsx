import { useState, type ReactNode } from 'react'

import { switchRows, type SwitchRow } from './branch-switch.ts'
import { Elided, useDismissable } from './WorkbenchControls.tsx'
import { WorktreeGlyph } from './WorktreeGlyph.tsx'
import type { Translate, WorktreeEntry } from './git-workbench-types.ts'
import css from './GitWorkbenchPanel.module.css'

/**
 * Git's fork glyph — the three-dot branch symbol (Octicons `git-branch`, MIT).
 * The worktree chip gave this shape up because it named the wrong thing there;
 * here the thing IS a branch.
 */
function BranchGlyph(): ReactNode {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 0a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Zm8.25-.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z" />
    </svg>
  )
}

/**
 * The branch switcher: `git switch` from the header, for the main worktree.
 *
 * It sits beside the worktree chip and is deliberately NOT part of it. The
 * chip changes what the drawer looks at; this changes what the tree IS. The
 * two verbs in one menu would be one wrong row apart, so this control has its
 * own name, its own list, and the plain button colour — an action next to the
 * subject, not a second subject.
 *
 * The panel renders it only when the viewed path is the main worktree. A
 * linked worktree's branch is the agent's to move, and the host refuses the
 * call there regardless; hiding the control is what says so before a click.
 *
 * Rows say before the click what git would say after: the current branch is
 * marked, a branch another worktree holds is disabled with that path on
 * `title`, and remote-only branches form a second group that creates a local
 * tracking branch when picked. Enter takes the first row that can be picked.
 * The rules live in `branch-switch.ts`, where they are tested.
 */
export function BranchSwitcher({ t, branches, remoteBranches, truncated, worktrees, current, busy, onPick }: {
  t: Translate
  branches: readonly string[]
  remoteBranches: readonly string[]
  /** Whether the host cut either list short. */
  truncated: boolean
  worktrees: readonly WorktreeEntry[]
  /** The viewed tree's branch; empty when HEAD is detached. */
  current: string
  busy: boolean
  onPick: (row: SwitchRow) => void
}): ReactNode {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useDismissable(open, setOpen)

  const rows = switchRows(branches, remoteBranches, worktrees, current, query)
  const pickable = (row: SwitchRow): boolean => !row.current && row.checkedOutAt === null
  const first = rows.find(pickable)
  const locals = rows.filter(row => row.track === null)
  const remotes = rows.filter(row => row.track !== null)

  const choose = (row: SwitchRow): void => {
    setOpen(false)
    setQuery('')
    if (pickable(row)) onPick(row)
  }

  const item = (row: SwitchRow): ReactNode => (
    <button
      key={row.name}
      type="button"
      role="option"
      aria-selected={row.current}
      className={row.current ? `${css.refRow} ${css.refRowActive}` : css.refRow}
      disabled={row.checkedOutAt !== null}
      title={row.checkedOutAt !== null ? t('switchHeldAt', { path: row.checkedOutAt }) : row.current ? t('switchCurrent') : row.name}
      onClick={() => choose(row)}
    >
      {row.checkedOutAt !== null ? <WorktreeGlyph /> : <span className={css.refRowSpacer} />}
      <Elided text={row.name} className={css.refRowName} />
      {row.current ? <span className={css.wtCurrent}>●</span> : null}
    </button>
  )

  return (
    <div className={css.refPicker} ref={rootRef}>
      <button
        type="button"
        className={css.refButton}
        aria-expanded={open}
        aria-label={t('switchBranch')}
        title={t('switchBranch')}
        disabled={busy}
        onClick={() => setOpen(isOpen => !isOpen)}
      >
        <BranchGlyph />
        <span className={css.refValue}>{t('switchBranch')}</span>
        <span className={css.refCaret}>▾</span>
      </button>
      {open ? (
        <div className={css.refPop}>
          <input
            className={css.refSearch}
            autoFocus
            value={query}
            placeholder={t('refSearch')}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter' && first !== undefined) choose(first) }}
          />
          <div className={css.refList} role="listbox" aria-label={t('switchBranch')}>
            {locals.length > 0 && remotes.length > 0 ? <div className={css.refGroup}>{t('switchLocal')}</div> : null}
            {locals.map(item)}
            {remotes.length > 0 ? <div className={css.refGroup}>{t('switchRemote')}</div> : null}
            {remotes.map(item)}
            {rows.length === 0 ? <div className={css.refEmpty}>{t('refNone')}</div> : null}
          </div>
          <div className={css.refFoot}>
            {t('refCount', { shown: rows.length, total: branches.length + remoteBranches.length })}
            {truncated ? ` · ${t('refTruncated')}` : ''}
          </div>
        </div>
      ) : null}
    </div>
  )
}
