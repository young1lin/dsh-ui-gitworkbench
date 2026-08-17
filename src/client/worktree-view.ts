/**
 * Worktree facts the drawer header renders, as plain functions.
 *
 * These live outside GitWorkbenchPanel.tsx so they can be tested: importing the
 * panel pulls a CSS module and React, which a node test environment cannot
 * load. The parameter types are structural for the same reason — naming
 * `WorktreeEntry` would import the panel back in.
 */

/** Separator-agnostic form: forward slashes, no trailing separator. */
function normalize(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '')
}

/**
 * Whether two paths name the same place.
 *
 * `git worktree list` reports forward slashes while the session cwd arrives
 * with the platform's own, so a raw comparison reads every Windows worktree as
 * a different directory from itself. A missing side is never equal to anything
 * — the drawer asks this to decide which row is active, and "unknown" must not
 * light one up.
 */
export function samePath(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return false
  return normalize(a) === normalize(b)
}

/**
 * Which worktree the panel is reading.
 *
 * The pin is drawer-local by construction, not by remembering to clear it: with
 * the drawer shut there is no way to see which worktree is pinned, change it,
 * or even know one is. State nobody can perceive or reach should not be able to
 * change what they see.
 *
 * Letting it survive a close is what produced a session card reading `main`
 * with a `fixture-03` worktree badge beside it — the branch came from the
 * pinned repository and the badge from the session's binding, so one row was
 * quietly describing two different places. Reopening always discarded the pin
 * anyway, so nothing was being preserved for anyone.
 *
 * @param open - whether the drawer is showing.
 * @param sourcePath - the worktree pinned in the drawer, or null to follow the session.
 * @param sessionPath - the session's own worktree: its binding, else its cwd.
 * @returns the path every fetch and the header card should be about.
 */
export function viewedPath(
  open: boolean,
  sourcePath: string | null,
  sessionPath: string | undefined,
): string | undefined {
  return open ? sourcePath ?? sessionPath : sessionPath
}

/**
 * Whether the cheap closed-drawer binding probe should be on a timer.
 *
 * With the drawer shut, nothing re-read the session's binding: the fetch that
 * carries it is keyed on the session id, the session cwd and `open`, and
 * `worktree_enter` changes none of those — dsh's `session.header.cwd` is
 * immutable, so the binding is the plugin's own state and the sessions store
 * never mentions it. The 3-15s poll that would have caught it starts at
 * `if (!open) return`. So the chip went on saying `main` after the agent had
 * entered a worktree, and only opening the drawer — the one act that flips
 * `open` — brought it up to date.
 *
 * The gate is narrow on purpose. A binding can only move from inside a turn
 * (`worktree_enter` and `worktree_exit` are agent tools), so an idle session has
 * nothing to watch; and this panel is mounted in EVERY session header, so a
 * timer that runs while nothing can change is a per-header cost for no answer.
 *
 * @param open - whether the drawer is showing; open has its own poll.
 * @param agentRunning - whether the session's agent has a turn in flight.
 */
export function probesClosedBinding(open: boolean, agentRunning: boolean | undefined): boolean {
  return !open && agentRunning === true
}

/**
 * Whether a binding probe disagrees with the binding the chip is showing.
 *
 * The probe is `gitWorkbench/sessionWorktree`, which reads the bindings JSON and
 * spawns no git at all — that is what makes it affordable on a timer. It cannot
 * replace the status fetch (no worktree list, no branches, so no picker and no
 * badge), so it is used as a change DETECTOR: while the answer holds, the poll
 * costs one file read; the moment it moves, one full `worktreeStatus` refetch
 * repaints everything at once.
 *
 * Paths are compared through {@link samePath} rather than raw. Both sides come
 * from the same file today, but a raw `!==` here would turn one separator
 * difference into a `worktree list` + `branch` pair every three seconds behind
 * a chip that was already correct.
 *
 * @param probe - what the bindings file says now; null fields mean unbound.
 * @param shown - the binding the panel currently renders, or null when unbound.
 */
export function bindingChanged(
  probe: { readonly worktreePath: string | null; readonly name: string | null },
  shown: { readonly worktreePath: string; readonly name: string } | null,
): boolean {
  const probed = probe?.worktreePath ?? null
  const rendered = shown?.worktreePath ?? null
  // Enter and exit both land here: one side has a path and the other does not.
  if (probed === null || rendered === null) return probed !== rendered
  if (!samePath(probed, rendered)) return true
  // Same directory, different name — a re-enter can reuse the path, and the
  // name is what the badge prints.
  return (probe.name ?? '') !== (shown?.name ?? '')
}

/**
 * Whether a view should say "pending" rather than show what it has.
 *
 * There are two different loads behind one flag. A worktree SWITCH empties the
 * file list first, so there is genuinely nothing to state and a confident
 * `+0 −1` would be wrong. An ordinary REFRESH — which every tick performs, via
 * `git add` and a refetch — runs over data that is still on screen and still
 * correct; the numbers are about to be replaced by nearly identical ones.
 *
 * Blanking on the raw flag treated those the same, so every tick swapped the
 * header totals for a `—` and back. Measured at 400ms, which is precisely the
 * duration that reads as a flicker rather than as a load.
 *
 * The file tree already had this rule inline. Duplicating it in the header is
 * how the header got it wrong, so it lives here now and both read it.
 *
 * @param loading - whether a fetch for this view is in flight.
 * @param fileCount - how many files the view is currently able to show.
 */
export function showsPending(loading: boolean, fileCount: number): boolean {
  return loading && fileCount === 0
}

/**
 * Whether a worktree's badge would only repeat the branch chip beside it.
 *
 * The plugin derives one from the other: a worktree it entered has the
 * binding's name as its branch VERBATIM (and legacy bindings from the
 * `wt/<name>` era derive it just as directly) — so for those, the session
 * card would print the same word twice, once as the branch chip and once as
 * the badge. A worktree made outside the plugin has no such relation, and
 * there the badge is the only thing naming the directory.
 *
 * @param branch - the branch checked out there.
 * @param name - the worktree's name, as the binding records it.
 */
export function badgeRepeatsBranch(branch: string, name: string): boolean {
  return branch.length > 0 && (branch === name || branch === `wt/${name}`)
}

/**
 * Split a name into a shrinkable head and the last segment.
 *
 * Ref names are path-shaped too (`feature/nested/deep/some-fix`, and git spells
 * them `refs/heads/...` underneath), so branches elide by the same rule as
 * directories: the leaf is what distinguishes siblings, so the leaf is what
 * survives.
 *
 * The header shows the whole path but has to give way to the totals beside it,
 * and truncating from the right would eat exactly the segment that tells two
 * worktrees apart. So the head ellipsises and the tail never does.
 *
 * Separators are preserved as they arrived: the path is shown to a human who
 * recognises their own machine's spelling, not fed back to git.
 *
 * @param path - an absolute or relative path, possibly with a trailing separator.
 * @returns the directory part including its trailing separator, and the last segment.
 */
export function splitPath(path: string): { head: string; tail: string } {
  const trimmed = path.replace(/[/\\]+$/, '')
  if (trimmed.length === 0) return { head: '', tail: path }
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (cut < 0) return { head: '', tail: trimmed }
  return { head: trimmed.slice(0, cut + 1), tail: trimmed.slice(cut + 1) }
}

/**
 * The branch checked out at a worktree, from the list already in hand.
 *
 * This is what lets a source switch repaint the header immediately. The stats
 * fetch that follows takes a `git status` and a numstat — seconds on a large
 * repository — and until it lands the panel used to claim `(no branch)`, which
 * is not a slower answer but a wrong one.
 *
 * @returns the branch, or an empty string when the path is unknown or the
 *   worktree is detached — both of which genuinely have no branch to name.
 */
export function branchOfWorktree(
  path: string | null | undefined,
  worktrees: readonly { readonly path: string; readonly branch: string }[],
): string {
  return worktrees.find(entry => samePath(entry.path, path))?.branch ?? ''
}
