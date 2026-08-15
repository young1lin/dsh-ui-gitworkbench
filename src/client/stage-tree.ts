/**
 * Tick state for the commit tree.
 *
 * IDEA presents a commit as a set of ticks rather than as a staging area, and
 * the drawer follows it: a tick IS `git add`, applied immediately, so what the
 * box shows and what `git status` reports can never drift apart. Nothing here
 * decides that policy — this module only answers what a tick looks like and
 * what clicking one should do, which is the part with rules worth testing.
 *
 * The one thing IDEA's model cannot say, and this one can, is a file that is
 * staged AND edited again: part of it would go into the commit and part would
 * not. That is not "ticked", and calling it ticked would make the box lie about
 * what it is about to commit. It is the same indeterminate state a directory
 * has when only some of its files are ticked, and it resolves the same way.
 */

export type CheckState = 'on' | 'off' | 'partial'

/** The index/worktree pair from git's porcelain XY columns. */
export interface StageFlags {
  readonly staged?: boolean
  readonly unstaged?: boolean
}

/**
 * One file's tick.
 * @param file - the file's stage flags; both may be true at once.
 */
export function fileCheckState(file: StageFlags): CheckState {
  if (file.staged !== true) return 'off'
  return file.unstaged === true ? 'partial' : 'on'
}

/**
 * Roll descendant ticks up to the directory that holds them.
 *
 * Mixed children are indeterminate however lopsided the mix: one ticked file
 * among two hundred is still "some of this directory", and rounding it to off
 * would hide a file from the commit set the user is looking at.
 * @param states - every descendant's tick, files and subdirectories alike.
 */
export function rollUp(states: Iterable<CheckState>): CheckState {
  let seenOn = false
  let seenOff = false
  for (const state of states) {
    if (state === 'partial') return 'partial'
    if (state === 'on') seenOn = true
    else seenOff = true
    if (seenOn && seenOff) return 'partial'
  }
  return seenOn ? 'on' : 'off'
}

/** What a tick does to the index. */
export type TickAction = 'stage' | 'unstage'

/** One queued click: a path, and what the click asked to do with it. */
export interface Tick {
  readonly path: string
  readonly action: TickAction
}

/**
 * What clicking a tick in this state means.
 *
 * Indeterminate stages rather than unstages: a half-ticked box invites you to
 * finish it, and the destructive reading (throw away what is already staged)
 * is not what a click on a checkbox should ever do.
 * @param state - the tick's current state.
 */
export function nextAction(state: CheckState): TickAction {
  return state === 'on' ? 'unstage' : 'stage'
}

/**
 * The paths an action actually has to touch.
 *
 * Staging skips what is already fully staged and unstaging skips what was never
 * staged, so ticking a directory of two hundred files sends git only the ones
 * that change — and an action with nothing to do sends nothing at all.
 * @param files - the files under the tick that was clicked.
 * @param action - from {@link nextAction}.
 */
export function pathsFor<T extends StageFlags & { readonly path: string }>(
  files: readonly T[],
  action: TickAction,
): string[] {
  return files
    .filter(file => action === 'stage' ? file.unstaged === true : file.staged === true)
    .map(file => file.path)
}

/**
 * The stage flags a tick leaves behind the moment it is clicked, rather than
 * the moment git confirms it.
 * @param action - from {@link nextAction}.
 */
export function tickedFlags(action: TickAction): { staged: boolean; unstaged: boolean } {
  return action === 'stage' ? { staged: true, unstaged: false } : { staged: false, unstaged: true }
}

/**
 * The fetched files with the ticks still awaiting git laid over them.
 *
 * The overlay is what makes a tick feel instant: it answers "what did I just
 * click" instead of waiting for the refetch to answer it. Entries the payload
 * does not list are left alone — the payload is the authority on what exists,
 * and a tick for a path it does not carry is settled, not painted onto nothing.
 *
 * Returns the very same array when the overlay changes nothing: the tree
 * re-renders on this value, and a fresh array every poll would throw its
 * memoisation away.
 * @param files - the files the newest payload reported.
 * @param pending - ticks clicked since the payload last confirmed one.
 */
export function withPendingTicks<T extends StageFlags & { readonly path: string }>(
  files: readonly T[],
  pending: ReadonlyMap<string, TickAction>,
): readonly T[] {
  if (pending.size === 0) return files
  let touched = false
  const shown = files.map(file => {
    const action = pending.get(file.path)
    if (action === undefined) return file
    touched = true
    return { ...file, ...tickedFlags(action) }
  })
  return touched ? shown : files
}

/**
 * Which pending ticks the newest payload has confirmed, and which may be
 * dropped from the overlay.
 *
 * A stage is settled once the payload shows the file staged — a newer edit on
 * top does not undo the add, and demanding full-flag agreement would freeze
 * the overlay over a file the agent is still editing, hiding the very edit the
 * payload came to report. An unstage settles once the index no longer holds
 * the file. A path the payload no longer lists at all was committed or
 * reverted elsewhere, and counts as settled too, or its tick would stick
 * forever.
 * @param files - the files the newest payload reported.
 * @param pending - ticks clicked since the payload last confirmed one.
 */
export function settledTicks<T extends StageFlags & { readonly path: string }>(
  files: readonly T[],
  pending: ReadonlyMap<string, TickAction>,
): ReadonlyMap<string, TickAction> {
  const flagsByPath = new Map(files.map(file => [file.path, file]))
  const settled = new Map<string, TickAction>()
  for (const [path, action] of pending) {
    const file = flagsByPath.get(path)
    const staged = file?.staged === true
    if (file === undefined || (action === 'stage' ? staged : !staged)) settled.set(path, action)
  }
  return settled
}

/**
 * The next git call the queue owes: every tick that shares the first entry's
 * action, gathered however late it arrived.
 *
 * One action per call, always — `git add` and `git restore --staged` in one
 * invocation is not a command git accepts. Batched by action rather than by
 * contiguity, so a tick that arrived between two of the same kind does not
 * split them into two spawns.
 * @param queue - clicked ticks not yet handed to git.
 * @returns the batch to run, or null when the queue is empty.
 */
export function nextBatch(queue: readonly Tick[]): { action: TickAction; paths: string[] } | null {
  const first = queue[0]
  if (first === undefined) return null
  const paths: string[] = []
  for (const tick of queue) {
    if (tick.action === first.action) paths.push(tick.path)
  }
  return { action: first.action, paths }
}
