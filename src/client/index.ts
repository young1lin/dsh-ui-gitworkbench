/**
 * Browser half of @young1lin/dsh-ui-gitworkbench.
 *
 * Contributes one entry to the `conversation.session.header.actions` list slot:
 * a compact git-workbench chip. Clicking it opens a right-side drawer with the
 * file list and per-file diff. The data is fetched from the host's
 * `gitWorkbench/stats` Remote method through the generic connection RPC channel;
 * `gitWorkbench/sessionWorktree` reports the session's worktree binding so the
 * chip can badge it and the drawer can switch between bound/main sources;
 * `gitWorkbench/styleGet` and `styleSet` carry the per-project and global drawer
 * styling, which lives on the host rather than in this browser.
 *
 * The fetch callback is handed to the component through the slot registration's
 * `inject` face (the dsh pattern: business callbacks cross from apply-scope to
 * component via the inject factory, never through a global ctx).
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-runtime' // informational inject edge (loading order)
import type {} from '@deepseek-ai/dsh-client-ui-slots' // SlotMap is reused, not extended
import {
  GitWorkbenchPanel,
  type DiscardAnswer, type DiscardPreview, type GitCommit, type GitOpName, type GitOpPayload, type GitOpResult,
  type WorkbenchStats, type SyncStatus, type WorktreeStatus,
  type FileSides, type SideLayer,
} from './GitWorkbenchPanel.tsx'
import type { StyleEntry, StyleScope, StyleSettings } from './themes.ts'
import type { LogFilter } from '../log-filter.ts'
import type { AuthorEntry } from '../shortlog.ts'
import { en, zh } from './locales.ts'

/**
 * This plugin's dictionary namespace. It is outside dsh's `LocaleNamespaceMap`
 * merge table (out-of-tree plugin), so registration uses the single-locale
 * untyped `register` overload provided for that case.
 */
const NS = 'gitworkbench'

/** Required client services: sessions store + slot registry + connection RPC + locale. */
export const inject = ['sessions', 'slots', 'connection', 'locale']

export function apply(ctx: ClientContext): void {
  // `connection` is a root service; reach it off the root context the apply runs under.
  const connection = (ctx as unknown as { connection: { rpc: { call: (channel: string, endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown> } } }).connection
  const locale = (ctx as unknown as {
    locale: { register: (ns: string, id: string, dict: Record<string, string>) => () => void }
  }).locale

  // One effect per locale: each register call returns its own disposer, and the
  // runtime rejects re-registering a locale a namespace already has (so a reload
  // that failed to dispose fails loudly rather than silently keeping stale copy).
  ctx.effect(() => locale.register(NS, 'zh', zh), 'dsh-ui-gitworkbench: zh dictionary')
  ctx.effect(() => locale.register(NS, 'en', en), 'dsh-ui-gitworkbench: en dictionary')

  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register(
    {
      name: 'conversation.session.header.actions',
      id: 'git-workbench',
      // After the job-list action (order 20); a low-key stats chip.
      order: 30,
      // Declaring the namespace is what puts the framework's `t` in the
      // component's props — it follows the user's language preference.
      locale: NS,
      inject: () => ({
        // Bound RPC caller the component invokes on mount + poll. Plain args under SRC.
        fetchStats: async (worktreePath: string | undefined, signal: AbortSignal): Promise<WorkbenchStats | null> => {
          const result = await connection.rpc.call(
            '/api',
            'gitWorkbench/stats',
            worktreePath === undefined ? { args: {} } : { args: { worktreePath } },
            signal,
          ) as { ok: true; value: WorkbenchStats } | { ok: false; error: { message?: string } }
          return result.ok ? result.value : null
        },
        // On-demand single-file diff. With `commit` it is that commit's change to the
        // file; without it, the working tree (tracked: git diff HEAD --; untracked: synthesized).
        fetchFileDiff: async (worktreePath: string | undefined, path: string, commit: string | undefined, signal: AbortSignal): Promise<string> => {
          const result = await connection.rpc.call(
            '/api',
            'gitWorkbench/fileDiff',
            { args: { worktreePath: worktreePath ?? '', path, ...commit === undefined ? {} : { commit } } },
            signal,
          ) as { ok: true; value: { diff: string } } | { ok: false; error: { message?: string } }
          return result.ok ? result.value.diff : ''
        },
        // One commit's change set, in the same shape as `stats` — the drawer's tree and
        // diff panes render it through the same code path as the working tree.
        fetchCommitStats: async (worktreePath: string | undefined, hash: string, signal: AbortSignal): Promise<WorkbenchStats | null> => {
          const result = await connection.rpc.call(
            '/api',
            'gitWorkbench/commitStats',
            { args: { worktreePath: worktreePath ?? '', hash } },
            signal,
          ) as { ok: true; value: WorkbenchStats } | { ok: false; error: { message?: string } }
          return result.ok ? result.value : null
        },
        // One layer of one file for the side-by-side diff pane: that layer's
        // full-context diff, the right-hand text, and the shas block mutations
        // will check against. Null (an older host half, a failed call) makes
        // the pane fall back to the unified view rather than go blank.
        fetchFileSides: async (worktreePath: string | undefined, path: string, layer: SideLayer, signal: AbortSignal): Promise<FileSides | null> => {
          const result = await connection.rpc.call(
            '/api',
            'gitWorkbench/fileSides',
            { args: { worktreePath: worktreePath ?? '', path, layer } },
            signal,
          ) as { ok: true; value: FileSides } | { ok: false; error: { message?: string } }
          return result.ok ? result.value : null
        },
        // One page of the commit log past what `stats` bundles, so the history
        // list can grow instead of stopping at the first page. The filter is
        // compiled into git log arguments host-side (IDEA-style pushdown).
        fetchCommits: async (worktreePath: string | undefined, ref: string, skip: number, limit: number, filter: LogFilter, signal: AbortSignal): Promise<{ commits: GitCommit[]; hasMore: boolean } | null> => {
          const result = await connection.rpc.call(
            '/api',
            'gitWorkbench/commits',
            { args: { worktreePath: worktreePath ?? '', ref, skip, limit, filter } },
            signal,
          ) as { ok: true; value: { commits: GitCommit[]; hasMore: boolean; error?: string } } | { ok: false; error: { message?: string } }
          return result.ok ? result.value : null
        },
        // Author roster for the ref the history walks, busiest first.
        fetchAuthors: async (worktreePath: string | undefined, ref: string, signal: AbortSignal): Promise<{ authors: AuthorEntry[]; truncated: boolean } | null> => {
          const result = await connection.rpc.call(
            '/api',
            'gitWorkbench/authors',
            { args: { worktreePath: worktreePath ?? '', ref } },
            signal,
          ) as { ok: true; value: { authors: AuthorEntry[]; truncated: boolean } } | { ok: false; error: { message?: string } }
          return result.ok ? result.value : null
        },
        // Every path on HEAD — the path picker's raw material.
        fetchRepoTree: async (worktreePath: string | undefined, signal: AbortSignal): Promise<{ paths: string[]; truncated: boolean } | null> => {
          const result = await connection.rpc.call(
            '/api',
            'gitWorkbench/repoTree',
            { args: { worktreePath: worktreePath ?? '' } },
            signal,
          ) as { ok: true; value: { paths: string[]; truncated: boolean } } | { ok: false; error: { message?: string } }
          return result.ok ? result.value : null
        },
        // Two refs compared as `base...head`, in the same shape as every other
        // view, so the drawer's tree and diff panes render it unchanged.
        fetchCompare: async (worktreePath: string | undefined, base: string, head: string, signal: AbortSignal): Promise<WorkbenchStats | null> => {
          const result = await connection.rpc.call(
            '/api',
            'gitWorkbench/compareRefs',
            { args: { worktreePath: worktreePath ?? '', base, head } },
            signal,
          ) as { ok: true; value: WorkbenchStats } | { ok: false; error: { message?: string } }
          return result.ok ? result.value : null
        },
        // The session's binding plus EVERY worktree of the surrounding repository.
        // Polled in step with the stats, so the chip tracks the agent's enter/exit
        // calls and the drawer's source list tracks worktrees added outside dsh.
        fetchWorktreeStatus: async (sessionId: string, repoPath: string | undefined, signal: AbortSignal): Promise<WorktreeStatus | null> => {
          const result = await connection.rpc.call(
            '/api',
            'gitWorkbench/worktreeStatus',
            { args: { sessionId, repoPath: repoPath ?? '' } },
            signal,
          ) as { ok: true; value: WorktreeStatus } | { ok: false; error: { message?: string } }
          return result.ok ? result.value : null
        },
        // The session's binding and nothing else. This one reads the bindings
        // JSON and spawns no git, which is what lets the chip keep watching for
        // an agent's `worktree_enter` with the drawer shut — where the full
        // status call (rev-parse + worktree list + branch list) would be a git
        // spawn per session header per tick. A disagreement here is what
        // triggers one `worktreeStatus` to repaint everything.
        fetchSessionBinding: async (sessionId: string, signal: AbortSignal): Promise<{ worktreePath: string | null; name: string | null } | null> => {
          const result = await connection.rpc.call(
            '/api',
            'gitWorkbench/sessionWorktree',
            { args: { sessionId } },
            signal,
          ) as { ok: true; value: { worktreePath: string | null; name: string | null } } | { ok: false; error: { message?: string } }
          return result.ok ? result.value : null
        },
        // Drawer styling for this directory: the project's scope and the global
        // one, unresolved — the menu edits each separately, so it needs both.
        fetchStyle: async (worktreePath: string | undefined, signal: AbortSignal): Promise<StyleSettings | null> => {
          const result = await connection.rpc.call(
            '/api',
            'gitWorkbench/styleGet',
            { args: { worktreePath: worktreePath ?? '' } },
            signal,
          ) as { ok: true; value: StyleSettings } | { ok: false; error: { message?: string } }
          return result.ok ? result.value : null
        },
        // Replace one scope's styling. The host validates and clamps everything
        // in the entry, so a rejected value comes back as ok:false with a reason.
        saveStyle: async (worktreePath: string | undefined, scope: StyleScope, entry: StyleEntry, signal: AbortSignal): Promise<{ ok: boolean; error?: string }> => {
          const result = await connection.rpc.call(
            '/api',
            'gitWorkbench/styleSet',
            { args: { worktreePath: worktreePath ?? '', scope, entry } },
            signal,
          // Flat rather than a discriminated union: this package compiles with
          // `strictNullChecks` off, which cannot narrow one, and this is the only
          // caller that reads the transport's own error rather than ignoring it.
          ) as { ok: boolean; value?: { ok: boolean; error?: string }; error?: { message?: string } }
          if (result.ok && result.value !== undefined) return result.value
          return { ok: false, error: result.error?.message ?? 'rpc failed' }
        },

        // ---- write operations ----
        //
        // Each returns the host's own GitOpResult. A transport failure is folded
        // into the same shape rather than thrown: the drawer shows one banner for
        // "the operation failed", and it should not matter to that banner whether
        // git refused or the socket did.
        fetchSync: async (worktreePath: string | undefined, signal: AbortSignal): Promise<SyncStatus | null> => {
          const result = await connection.rpc.call(
            '/api',
            'gitWorkbench/syncStatus',
            { args: { worktreePath: worktreePath ?? '' } },
            signal,
          ) as { ok: true; value: SyncStatus } | { ok: false; error: { message?: string } }
          return result.ok ? result.value : null
        },
        // Read-only, and the only reason it is a separate call rather than a
        // field on the file row: the confirmation must state what discarding
        // this file would do NOW, not what the last poll saw. A row that says
        // "modified" while git has since had the file staged, edited or removed
        // is the difference between "goes back to its committed content" and
        // "leaves the disk and cannot come back" — which is the entire question
        // the dialog exists to ask.
        fetchDiscardPlan: async (worktreePath: string | undefined, path: string, signal: AbortSignal): Promise<DiscardAnswer> => {
          // A throw here used to be nobody's: the click had already put the
          // drawer into "asking the host", and an unhandled rejection left it
          // there with no dialog and no way back except closing the drawer.
          try {
            const result = await connection.rpc.call(
              '/api',
              'gitWorkbench/discardPlan',
              { args: { worktreePath: worktreePath ?? '', path } },
              signal,
            ) as { ok: boolean; value?: DiscardPreview; error?: { message?: string } }
            if (result.ok && result.value !== undefined) return { kind: 'plan', plan: result.value }
            return { kind: 'failed', error: result.error?.message ?? '' }
          } catch (error) {
            return { kind: 'failed', error: error instanceof Error ? error.message : String(error) }
          }
        },
        runGitOp: async (op: GitOpName, worktreePath: string | undefined, payload: GitOpPayload, signal: AbortSignal): Promise<GitOpResult> => {
          const result = await connection.rpc.call(
            '/api',
            `gitWorkbench/${op}`,
            { args: { worktreePath: worktreePath ?? '', ...payload } },
            signal,
          ) as { ok: boolean; value?: GitOpResult; error?: { message?: string } }
          if (result.ok && result.value !== undefined) return result.value
          return { ok: false, failure: 'unknown', error: result.error?.message ?? 'rpc failed' }
        },
      }),
    },
    GitWorkbenchPanel,
  ))
}
