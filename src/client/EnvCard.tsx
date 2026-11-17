import type { ReactNode } from 'react'
import type { Translate, WorkbenchStats } from './git-workbench-types.ts'
import { badgeRepeatsBranch } from './worktree-view.ts'
import { branchLabel, Elided } from './WorkbenchControls.tsx'
import { WorktreeGlyph } from './WorktreeGlyph.tsx'
import css from './GitWorkbenchPanel.module.css'

interface EnvCardProps { stats: WorkbenchStats; t: Translate; wtName: string | null; title: string; onClick: () => void }

export function EnvCard({ stats, t, wtName, title, onClick }: EnvCardProps): ReactNode {
  /* dsh derives the branch from the worktree's name, so for anything it created
     the badge was a second printing of the chip beside it — `wt/fixture-03`
     next to `fixture-03`. The glyph still says "this session is in a worktree";
     only the repeated word goes. Where the two names are independent (a
     worktree made outside dsh) the badge is the only thing naming the
     directory, so it stays — and its presence then means something. */
  const repeats = wtName !== null && badgeRepeatsBranch(stats.branch, wtName)
  return (
    <button type="button" className={css.card} title={title} onClick={onClick}>
      <span className={css.cardBranch}>
        {repeats ? <WorktreeGlyph /> : null}
        <Elided text={branchLabel(stats.branch, t('noBranch'))} className={css.cardBranchName} />
      </span>
      {wtName !== null && !repeats ? <span className={css.cardWt}><WorktreeGlyph />{wtName}</span> : null}
      {stats.detached ? <span className={css.cardDetached}>detached</span> : null}
      {stats.ahead > 0 ? <span className={css.cardAhead} title={t('aheadTitle', { count: stats.ahead })}>↑{stats.ahead}</span> : null}
      {stats.behind > 0 ? <span className={css.cardBehind} title={t('behindTitle', { count: stats.behind })}>↓{stats.behind}</span> : null}
      {stats.files.length > 0 ? (
        <>
          <span className={css.cardSep} />
          <span className={css.cardAdded}>+{stats.addedLines}</span>
          <span className={css.cardDeleted}>−{stats.deletedLines}</span>
          <span className={css.cardFiles}>{t('files', { count: stats.files.length })}</span>
        </>
      ) : null}
    </button>
  )
}
