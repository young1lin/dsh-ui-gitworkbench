import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'

import { filterFiles } from './file-filter.ts'
import { PathDirGlyph, PathFileGlyph } from './glyphs.tsx'
import { fileCheckState, rollUp, type CheckState } from './stage-tree.ts'
import type { GitFile, GitFileStatus, Translate } from './git-workbench-types.ts'
import css from './GitWorkbenchPanel.module.css'

const STATUS_BADGE: Record<GitFileStatus, string> = {
  added: css.stAdded, untracked: css.stUntracked, modified: css.stModified,
  renamed: css.stRenamed, deleted: css.stDeleted,
}

/**
 * Filter this list: a magnifier, not the funnel above the commit list. The two
 * are deliberately different glyphs because they do different things — the
 * funnel asks git for a different set of commits, this only hides rows already
 * on screen — and the drawer shows both at once.
 */
function FilterGlyph(): ReactNode {
  return (
    <svg
      width="13" height="13" viewBox="0 0 16 16"
      fill="none" stroke="currentColor" strokeWidth="1.25"
      strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="7" cy="7" r="4" />
      <path d="M10 10l3.5 3.5" />
    </svg>
  )
}

/** Nothing folded. A constant so the filtered tree does not allocate a new Set
 *  on every render and re-run `TreeChildren`'s memo. */
const EMPTY_COLLAPSED: ReadonlySet<string> = new Set<string>()

/**
 * Roll back: the counter-clockwise arc every editor and VCS uses for undo,
 * drawn in the same New UI idiom as the node glyphs beside it — 16px grid,
 * 1px stroke, no fill — so the row does not mix an outlined file icon with a
 * solid action icon.
 */
function RollbackGlyph(): ReactNode {
  return (
    <svg
      width="14" height="14" viewBox="0 0 16 16"
      fill="none" stroke="currentColor" strokeWidth="1.25"
      strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* The arc, open at the upper left where the head goes. */}
      <path d="M3.5 6.5a5 5 0 1 0 1.9-2.2" />
      {/* The head: a corner, not a triangle — a filled arrowhead this small
          turns into a dot at 1x. */}
      <path d="M2.6 3.2v3.4h3.4" />
    </svg>
  )
}

/* ---------- file tree ---------- */

/** Horizontal step per nesting level. */
const TREE_INDENT = 14
/** The gutter every row starts at. Equals `--gs-gutter-pane`, so depth-0 ticks
 *  line up with the toolbar's own content — and everything interactive stays
 *  clear of the 10px resizer the drawer paints over its left edge. */
const TREE_BASE_INDENT = 12
/** Chevron width plus its gap. A file row adds this so its status badge starts at
 *  the directory NAME's column rather than under the directory's chevron. */
const TREE_LEAF_OFFSET = 16
/** Where a level's indent guide sits: inside the chevron, so it points at the
 *  rows it groups. */
const TREE_RAIL_OFFSET = 12
/** The tick's own width. Must match `.checkBox` — the row's content starts after
 *  it, and the indent guides are positioned from it. */
const TREE_CHECK_W = 22
/** Custom property the stylesheet reads to place one level's indent guide. */
const RAIL_VAR = '--gs-rail'

interface DirNode {
  readonly name: string
  readonly path: string
  readonly dirs: Map<string, DirNode>
  readonly files: GitFile[]
  fileCount: number
  added: number
  deleted: number
  /** Every descendant's tick, rolled up. Computed once with the other totals. */
  check: CheckState
}

function buildTree(files: readonly GitFile[]): DirNode {
  const root: DirNode = { name: '', path: '', dirs: new Map(), files: [], fileCount: 0, added: 0, deleted: 0, check: 'off' }
  for (const file of files) {
    let node = root
    const parts = file.path.split('/')
    for (let i = 0; i < parts.length - 1; i += 1) {
      const name = parts[i]
      let child = node.dirs.get(name)
      if (child === undefined) {
        child = { name, path: parts.slice(0, i + 1).join('/'), dirs: new Map(), files: [], fileCount: 0, added: 0, deleted: 0, check: 'off' }
        node.dirs.set(name, child)
      }
      node = child
    }
    node.files.push(file)
  }
  const aggregate = (node: DirNode): void => {
    node.fileCount = node.files.length
    node.added = node.files.reduce((sum, f) => sum + f.addedLines, 0)
    node.deleted = node.files.reduce((sum, f) => sum + f.deletedLines, 0)
    const ticks: CheckState[] = node.files.map(fileCheckState)
    for (const child of node.dirs.values()) {
      aggregate(child)
      node.fileCount += child.fileCount
      node.added += child.added
      node.deleted += child.deleted
      ticks.push(child.check)
    }
    node.check = rollUp(ticks)
  }
  aggregate(root)
  return compactChains(root)
}

/**
 * Merge every directory that holds nothing but one subdirectory into that child.
 *
 * `docs/superpowers/specs/design.md` otherwise costs three rows and three indent
 * levels to reach one file, and none of those three rows carries a choice — each
 * has exactly one way down. Merging them into a single `docs/superpowers/specs`
 * row is what VS Code calls compact folders, and it makes indentation depth mean
 * "where the tree branches" rather than "how long the path is".
 *
 * The merged node keeps the DEEPEST path, so it stays the one the collapse set
 * and the reveal-the-active-file walk already address.
 * @param node - directory whose descendants are compacted.
 * @returns the node with compacted children.
 */
function compactChains(node: DirNode): DirNode {
  const dirs = new Map<string, DirNode>()
  for (const child of node.dirs.values()) {
    let merged = compactChains(child)
    while (merged.files.length === 0 && merged.dirs.size === 1) {
      const only = merged.dirs.values().next().value as DirNode
      merged = { ...only, name: `${merged.name}/${only.name}` }
    }
    dirs.set(merged.name, merged)
  }
  return { ...node, dirs }
}

interface FileTreeProps {
  t: Translate
  /** Whether the view has nothing to show yet — already resolved by the caller
   *  via {@link showsPending}, NOT the raw in-flight flag. This pane used to
   *  re-derive it from `loading && files.length === 0`, and that second copy of
   *  the rule is precisely what the header then got wrong. */
  loading?: boolean
  /** What the list holds, prepended to the count — the working-tree view says
   *  which worktree it is reading; commit views are already named by history. */
  lead?: string
  files: readonly GitFile[]
  active: string | null
  onSelect: (path: string) => void
  /** Undefined until the user interacts: then it shows defaults. Lifted to the
   *  panel so background polls (new `files` identity) and drawer close/reopen
   *  never reset the user's expansion choices. */
  collapsed: Set<string> | undefined
  onCollapsedChange: (next: Set<string>) => void
  /** Add or remove files from the commit set. Undefined outside the working-tree
   *  view, where what a commit contains was decided long ago. */
  onCheck?: (files: readonly GitFile[], state: CheckState) => void
  /** Roll one file back to HEAD; working-tree view only. */
  onDiscard?: (file: GitFile) => void
  /** Rendered under the tree in the working-tree view only. */
  footer?: ReactNode
  /** Names what this list is OF — the working tree, or one commit, or one
   *  comparison. The filter clears when it changes: a query typed against a
   *  140-file commit would otherwise carry over to the next commit and hide
   *  most of it, with nothing on screen saying why. */
  scopeKey: string
}

export function FileTree({ t, loading, lead, files, active, onSelect, collapsed, onCollapsedChange, onCheck, onDiscard, footer, scopeKey }: FileTreeProps): ReactNode {
  /**
   * The filter over this list. Local, because it describes a way of LOOKING at
   * the pane rather than anything the drawer stores: closing and reopening on
   * an unfiltered list is what someone expects, and a query kept in the panel
   * would have to be cleared from four places instead of one.
   */
  const [query, setQuery] = useState('')
  const [filterOpen, setFilterOpen] = useState(false)
  const filterRef = useRef<HTMLInputElement>(null)
  useEffect(() => { setQuery(''); setFilterOpen(false) }, [scopeKey])

  const shownFiles = useMemo(() => filterFiles(files, query), [files, query])
  const filtering = shownFiles !== files
  const tree = useMemo(() => buildTree(shownFiles), [shownFiles])
  /** Default: a dir collapses when it holds more than 12 files anywhere below it. */
  const effective = collapsed ?? defaultCollapsed(tree)

  // Reveal the active file by expanding its ancestor chain — ONLY when the
  // selection itself changes. Listening to `collapsed` here would instantly
  // revert manual folds of any directory containing the active file.
  useEffect(() => {
    if (active === null) return
    const parts = active.split('/')
    let touched = false
    const next = new Set(collapsed ?? defaultCollapsed(tree))
    for (let i = 1; i < parts.length; i += 1) {
      const dir = parts.slice(0, i).join('/')
      if (next.delete(dir)) touched = true
    }
    if (touched) onCollapsedChange(next)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- reveal is a selection-change event, not an invariant over `collapsed`
  }, [active])

  const setAll = (open: boolean): void => {
    onCollapsedChange(open ? new Set() : allDirs(tree))
  }

  const toggleOne = (path: string): void => {
    const next = new Set(effective)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    onCollapsedChange(next)
  }

  const stageLabels = { stage: t('stage'), unstage: t('unstage') }

  return (
    <div className={css.treeWrap}>
      <div className={css.treeTools}>
        {/* The root tick replaces the Stage all / Unstage all pair: it says the
            same two things in the column the rows already read down, and gives
            the toolbar back the room those two buttons needed. The toolbar's own
            pane gutter is its indent, so it lines up with the depth-0 rows. */}
        <div className={css.treeLead}>
          {onCheck !== undefined ? (
            <CheckBox
              state={tree.check}
              label={tree.check === 'on' ? t('unstageAll') : t('stageAll')}
              indent={0}
              // `shownFiles`, not `files`: a tick IS a git call, and the root
              // one must stage exactly the rows it sits above. Reaching past a
              // filter into files the pane is hiding is how "stage all" ends up
              // meaning something the reader never saw.
              onToggle={() => onCheck(shownFiles, tree.check)}
            />
          ) : null}
          <span className={css.treeLabel}>
            {loading === true
              ? t('loading')
              : `${lead !== undefined ? `${lead} · ` : ''}${filtering
                ? t('filesFiltered', { shown: shownFiles.length, count: files.length })
                : t('files', { count: files.length })}`}
          </span>
        </div>
        <div className={css.treeActions} data-gs-part="tree-actions">
          {/* Filtering is about the list, so it sits with the list's own two
              controls rather than in the drawer chrome — and it stays lit while
              a query is set, because a pane showing 6 of 140 files with no
              visible reason is the one way this feature can mislead. */}
          <button
            type="button"
            className={filterOpen || filtering ? `${css.treeIcon} ${css.treeIconOn}` : css.treeIcon}
            data-gs-part="filter-files"
            title={t('filterFiles')} aria-label={t('filterFiles')}
            aria-pressed={filterOpen}
            onClick={() => {
              // Closing is also clearing. A hidden box still holding a query
              // would leave the pane filtered with its only explanation
              // folded away.
              if (filterOpen) { setQuery(''); setFilterOpen(false); return }
              setFilterOpen(true)
              window.setTimeout(() => filterRef.current?.focus(), 0)
            }}
          ><FilterGlyph /></button>
          {/* Icon-only, with the label on `title`/`aria-label`: the glyph is the
              same one the rows carry, so each button previews its own result. */}
          <button
            type="button" className={css.treeIcon} data-gs-part="expand-all"
            title={t('expandAll')} aria-label={t('expandAll')}
            onClick={() => setAll(true)}
          ><span className={`${css.treeIconGlyph} ${css.treeIconDown}`}>▸</span></button>
          <button
            type="button" className={css.treeIcon} data-gs-part="collapse-all"
            title={t('collapseAll')} aria-label={t('collapseAll')}
            onClick={() => setAll(false)}
          ><span className={css.treeIconGlyph}>▸</span></button>
        </div>
      </div>
      {filterOpen ? (
        <div className={css.treeFilter}>
          <input
            ref={filterRef}
            className={css.treeFilterInput}
            type="text"
            value={query}
            placeholder={t('filterFilesPlaceholder')}
            aria-label={t('filterFiles')}
            spellCheck={false}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => {
              if (event.key !== 'Escape') return
              // Escape belongs to the box while it has something to undo;
              // only an already-empty box lets it through to close the drawer.
              if (query.length > 0) { event.stopPropagation(); setQuery(''); return }
              event.stopPropagation()
              setFilterOpen(false)
            }}
          />
          {query.length > 0 ? (
            <button
              type="button" className={css.treeFilterClear}
              title={t('filterFilesClear')} aria-label={t('filterFilesClear')}
              onClick={() => { setQuery(''); filterRef.current?.focus() }}
            >×</button>
          ) : null}
        </div>
      ) : null}
      {loading === true ? (
        <div className={css.treeEmpty} data-gs-part="tree-loading">{t('loading')}</div>
      ) : filtering && shownFiles.length === 0 ? (
        <div className={css.treeEmpty} data-gs-part="tree-no-match">{t('filterNoMatch')}</div>
      ) : (
        <ul className={css.tree}>
          {/* A filtered tree ignores the fold state entirely: the reader asked
              for these files, and leaving them behind a directory they
              collapsed twenty minutes ago reads as "no matches". */}
          <TreeChildren
            node={tree} depth={0} active={active} collapsed={filtering ? EMPTY_COLLAPSED : effective}
            onToggle={toggleOne} onSelect={onSelect} onCheck={onCheck} onDiscard={onDiscard} stageLabels={stageLabels} discardLabel={t('discardAction')}
          />
        </ul>
      )}
      {footer}
    </div>
  )
}

function defaultCollapsed(root: DirNode): Set<string> {
  const out = new Set<string>()
  const walk = (node: DirNode): void => {
    for (const child of node.dirs.values()) {
      if (child.fileCount > 12) out.add(child.path)
      walk(child)
    }
  }
  walk(root)
  return out
}

function allDirs(node: DirNode): Set<string> {
  const out = new Set<string>()
  const walk = (n: DirNode): void => {
    for (const child of n.dirs.values()) { out.add(child.path); walk(child) }
  }
  walk(node)
  return out
}

/**
 * One tick. A sibling of the row it belongs to rather than a child of it: a
 * button inside a button is invalid HTML, and the two clicks mean different
 * things — this one changes the commit set, the row opens the diff.
 *
 * The tick carries its row's own indent and stands at the node it includes,
 * IDEA-style, rather than in a column pinned to the pane edge. A pinned column
 * reads at a glance, but it detaches each tick from its node — and its first
 * 10px sat underneath the drawer's edge resizer, so a click on the left half of
 * a depth-0 tick dragged the drawer instead of staging anything.
 */
function CheckBox({ state, label, indent, onToggle }: {
  state: CheckState
  label: string
  /** The row's left edge, carried here so the tick stands at its own node. */
  indent: number
  onToggle: () => void
}): ReactNode {
  const mark = state === 'on' ? css.checkMarkOn : state === 'partial' ? css.checkMarkPartial : ''
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={state === 'partial' ? 'mixed' : state === 'on'}
      className={css.checkBox}
      style={{ marginLeft: indent }}
      title={label}
      aria-label={label}
      onClick={onToggle}
    >
      <span className={`${css.checkMark} ${mark}`} aria-hidden="true">
        {state === 'on' ? '✓' : state === 'partial' ? '–' : ''}
      </span>
    </button>
  )
}

/** Every file at or under a node, for a tick that acts on a whole directory. */
function filesUnder(node: DirNode): GitFile[] {
  const out = [...node.files]
  for (const child of node.dirs.values()) out.push(...filesUnder(child))
  return out
}

interface TreeChildrenProps {
  node: DirNode
  depth: number
  active: string | null
  /** Read-only: a filtered tree is handed a shared empty set rather than a copy. */
  collapsed: ReadonlySet<string>
  onToggle: (path: string) => void
  onSelect: (path: string) => void
  /** Add or remove files from the commit set. Undefined outside the working-tree
   *  view, where what a commit contains was decided long ago. */
  onCheck?: (files: readonly GitFile[], state: CheckState) => void
  /** Roll one file back to HEAD. Undefined outside the working-tree view for
   *  the same reason `onCheck` is: a commit's files are history, and there is
   *  nothing there to roll back. Directories never offer it — the irreversible
   *  action does not get a gesture that takes a subtree with it. */
  onDiscard?: (file: GitFile) => void
  /** Pre-translated, so the row does not have to carry `t` for two strings. */
  stageLabels: { stage: string; unstage: string }
  /** Label for the roll-back action, pre-translated like `stageLabels`. */
  discardLabel?: string
}

function TreeChildren({ node, depth, active, collapsed, onToggle, onSelect, onCheck, onDiscard, stageLabels, discardLabel }: TreeChildrenProps): ReactNode {
  const dirNodes = [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name))
  const fileNodes = [...node.files].sort((a, b) => basePart(a.path).localeCompare(basePart(b.path)))
  const checkColumn = onCheck !== undefined ? TREE_CHECK_W : 0
  // With ticks, the tick carries this indent and the button starts at 0; without
  // them (history, compare) the button carries it, as it always did.
  const indent = TREE_BASE_INDENT + depth * TREE_INDENT
  return (
    <>
      {dirNodes.map(dir => {
        const open = !collapsed.has(dir.path)
        const containsActive = active !== null && active.startsWith(`${dir.path}/`)
        return (
          <li key={dir.path} className={css.treeDirLi}>
            <div className={css.treeRow}>
              {onCheck !== undefined ? (
                <CheckBox
                  state={dir.check}
                  label={dir.check === 'on' ? stageLabels.unstage : stageLabels.stage}
                  indent={indent}
                  onToggle={() => onCheck(filesUnder(dir), dir.check)}
                />
              ) : null}
              <button
                type="button"
                className={`${css.treeDir} ${containsActive ? css.treeDirActive : ''}`}
                style={{ paddingLeft: onCheck !== undefined ? 0 : indent }}
                onClick={() => onToggle(dir.path)}
                title={dir.path}
              >
                <span className={`${css.chevron} ${open ? css.chevronOpen : ''}`}>▸</span>
                <PathDirGlyph />
                <span className={css.treeDirName}>{dir.name}</span>
                <span className={css.treeDirCount}>{dir.fileCount}</span>
                <span className={css.treeDirCounts}>
                  {dir.added > 0 ? <span className={css.fileCountAdd}>+{dir.added}</span> : null}
                  {dir.deleted > 0 ? <span className={css.fileCountDel}>−{dir.deleted}</span> : null}
                </span>
              </button>
            </div>
            {open ? (
              <ul
                className={css.treeSub}
                // The rail hangs off the parent's chevron, which sits after the
                // row's tick — so the tick's width is part of the offset.
                style={{ [RAIL_VAR]: `${checkColumn + TREE_BASE_INDENT + depth * TREE_INDENT + TREE_RAIL_OFFSET}px` } as CSSProperties}
              >
                <TreeChildren node={dir} depth={depth + 1} active={active} collapsed={collapsed} onToggle={onToggle} onSelect={onSelect} onCheck={onCheck} onDiscard={onDiscard} stageLabels={stageLabels} discardLabel={discardLabel} />
              </ul>
            ) : null}
          </li>
        )
      })}
      {fileNodes.map(file => {
        const check = fileCheckState(file)
        return (
          <li key={file.path} className={css.fileLi}>
            {onCheck !== undefined ? (
              <CheckBox
                state={check}
                label={check === 'on' ? stageLabels.unstage : stageLabels.stage}
                indent={indent}
                onToggle={() => onCheck([file], check)}
              />
            ) : null}
            <button
              type="button"
              className={active === file.path ? `${css.file} ${css.fileActive}` : css.file}
              style={{ paddingLeft: (onCheck !== undefined ? 0 : indent) + TREE_LEAF_OFFSET }}
              onClick={() => onSelect(file.path)}
              title={file.previousPath !== undefined ? `${file.previousPath} → ${file.path}` : file.path}
            >
              {/* Icon then name, status on the right with the line counts.
                  The badge used to lead, which put two glyphs side by side the
                  moment the row gained a file icon; both IDEA and VS Code read
                  left-to-right as "what this is, then what happened to it",
                  and the badge still lands in an aligned column — `.filePath`
                  is the only flexible child. */}
              <PathFileGlyph path={file.path} />
              <span className={css.filePath}>{basePart(file.path)}</span>
              {file.binary ? <span className={css.fileBinary}>BIN</span> : (
                <span className={css.fileCounts}>
                  <span className={css.fileCountAdd}>{file.addedLines > 0 ? `+${file.addedLines}` : ''}</span>{' '}
                  <span className={css.fileCountDel}>{file.deletedLines > 0 ? `−${file.deletedLines}` : ''}</span>
                </span>
              )}
              <span className={`${css.fileStatus} ${STATUS_BADGE[file.status]}`}>{statusGlyph(file.status)}</span>
            </button>
            {onDiscard !== undefined ? (
              /* Outside the row button, not inside it: a button in a button is
                 invalid, and clicking roll-back must not also select the file. */
              <button
                type="button"
                className={css.fileDiscard}
                title={discardLabel}
                aria-label={`${discardLabel ?? ''} ${file.path}`}
                onClick={event => { event.stopPropagation(); onDiscard(file) }}
              ><RollbackGlyph /></button>
            ) : null}
          </li>
        )
      })}
    </>
  )
}

function statusGlyph(status: GitFileStatus): string {
  switch (status) {
    case 'added': return 'A'
    case 'untracked': return 'U'
    case 'modified': return 'M'
    case 'renamed': return 'R'
    case 'deleted': return 'D'
  }
}

function basePart(path: string): string {
  const cut = path.lastIndexOf('/')
  return cut >= 0 ? path.slice(cut + 1) : path
}
