/**
 * The Files tab: open any file in the repository, read it, blame it, edit it.
 *
 * The Changes tab lists what git has something to say about, which is the
 * wrong list for "who wrote this line" — that question is almost always about
 * a file nobody has touched today. So this view browses the repository itself:
 * the tracked paths `repoTree` reports, plus whatever exists in the working
 * tree but not in HEAD, because a browser that cannot open the file you just
 * created reads as broken rather than as principled.
 *
 * Nothing here needed a new host RPC. `fileSides` already carries the whole
 * working-tree text (it is the editor's initial buffer in the diff pane) along
 * with the binary, size and encoding guards attached to it; `writeChecked`
 * already refuses a save whose sha moved; `blame` already answers per line.
 * This view is those three, arranged around a tree.
 *
 * Blame renders in a CodeMirror gutter rather than a column of the pane's own
 * grid, because here the file IS the editor. It is withheld while the buffer
 * is dirty: once lines have been typed the numbers no longer match the commits
 * behind them, and an annotation quietly pointing at the wrong line is worse
 * than no annotation.
 *
 * @module @young1lin/dsh-ui-gitworkbench/client/FileBrowser
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'

import css from './GitWorkbenchPanel.module.css'
import { CodeEditor } from './CodeEditor.tsx'
import { buildDirTree } from './dir-tree.ts'
import { ancestorsOf, mergePaths, rootFiles, searchRows, treeRows, type FileRow } from './file-rows.ts'
import { PathDirGlyph, PathFileGlyph } from './glyphs.tsx'
import { blameWhen, shortHash } from './blame-view.ts'
import { emptyQueryFilter, serializeLogQuery } from './log-filter-query.ts'
import { highlightWholeFile, shikiLangOf, shikiThemeOf, subscribeGrammarLoaded } from './highlight.ts'
import { HIGHLIGHT_IDLE_MS, HIGHLIGHT_LINE_CAP, useIdleValue } from './idle-value.ts'
import { detectIndent } from './indent.ts'
import {
  DISARMED, applySaveOk, applySides, armEdit, armRefusal, isDirty, markConflict,
  type EditState, type WriteResult,
} from './side-edit.ts'
import type { BlameAnswer, BlameLine, FileSides, SideLayer, Translate } from './GitWorkbenchPanel.tsx'

/** Count lines without allocating the split — the buffer can be megabytes and
 *  this runs on a timer while somebody is typing. */
function countLines(text: string): number {
  let n = 1
  for (let i = text.indexOf(String.fromCharCode(10)); i !== -1; i = text.indexOf(String.fromCharCode(10), i + 1)) n += 1
  return n
}

/** Most search hits rendered at once — a one-letter query must not paint a
 *  whole repository into the DOM. */
const SEARCH_CAP = 300

/** Indent per tree level, in em. Matches the changes tree's own step. */
const INDENT_EM = 0.85

/** Files rendered per directory before the rest become one "and N others"
 *  row. A generated directory can hold thousands, and every row is a button
 *  and two icons — the cost is DOM nodes, not the walk that produced them.
 *  The history filter's path picker has capped at this number since it
 *  shipped; the search box is the way to a file in a crowded directory. */
const FILES_PER_DIR = 100

export function FileBrowser({
  t, palette, statsPath, extraPaths, gen, treeStyle, treeRef, divider,
  fetchRepoTree, fetchFileSides, writeChecked, fetchBlame, onSaved, onDirtyChange, onShowHistory,
}: {
  t: Translate
  palette: string
  statsPath: string | undefined
  /** Working-tree paths that are not in HEAD — untracked files, which
   *  `git ls-tree` cannot know about. Deleted files are filtered out by the
   *  caller: opening one would only fail. */
  extraPaths: readonly string[]
  /** Refresh generation; a new one re-reads the tree and the open file. */
  gen: number
  treeStyle: CSSProperties | undefined
  treeRef: { current: HTMLDivElement | null }
  /** The drawer's own drag handle, passed in rather than imported, so this
   *  module does not import a value out of the panel that imports it. */
  divider: ReactNode
  fetchRepoTree: (worktreePath: string | undefined, signal: AbortSignal) => Promise<{ paths: string[]; truncated: boolean } | null>
  fetchFileSides: (worktreePath: string | undefined, path: string, layer: SideLayer, signal: AbortSignal) => Promise<FileSides | null>
  writeChecked: (worktreePath: string | undefined, path: string, text: string, expectedSha: string, signal: AbortSignal) => Promise<WriteResult | null>
  fetchBlame: (worktreePath: string | undefined, path: string, signal: AbortSignal) => Promise<BlameAnswer | null>
  /** After a successful save: the drawer re-reads, since the file moved. */
  onSaved: () => void
  /** The unsaved-edits flag the drawer guards its own gestures on. */
  onDirtyChange: (dirty: boolean) => void
  /** Hand a filter query to the History tab and switch to it. */
  onShowHistory: (query: string) => void
}): ReactNode {
  const [paths, setPaths] = useState<readonly string[]>([])
  const [truncated, setTruncated] = useState(false)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const [open, setOpen] = useState<string | null>(null)
  const [sides, setSides] = useState<FileSides | null>(null)
  const [loading, setLoading] = useState(false)
  const [edit, setEdit] = useState<EditState>(DISARMED)
  const [saving, setSaving] = useState(false)
  const [saveFailed, setSaveFailed] = useState<string | null>(null)
  const [blameOn, setBlameOn] = useState(false)
  const [blame, setBlame] = useState<BlameAnswer | null>(null)
  // "Asked and got nothing" must not render as "not asked": a toggle that
  // lights up and then shows an empty gutter reads as broken.
  const [blameFailed, setBlameFailed] = useState(false)
  /** A file click held back by unsaved edits, waiting on the reader's answer. */
  const [pending, setPending] = useState<string | null>(null)
  /** The line whose commit the reader asked to see, 1-based. */
  const [picked, setPicked] = useState<number | null>(null)
  const [refetch, setRefetch] = useState(0)
  /** Which file the buffer currently belongs to, so a refetch can be told
   *  apart from a genuine open. */
  const openRef = useRef<string | null>(null)
  // A grammar loads asynchronously the first time a language is seen; this
  // counter re-renders the highlight once it lands.
  const [, setGrammarTick] = useState(0)

  const dirty = isDirty(edit)

  useEffect(() => subscribeGrammarLoaded(() => { setGrammarTick(n => n + 1) }), [])
  useEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])

  // The repository's paths.
  useEffect(() => {
    const ctrl = new AbortController()
    let alive = true
    void fetchRepoTree(statsPath, ctrl.signal)
      .then(tree => {
        if (!alive || tree === null) return
        setPaths(tree.paths)
        setTruncated(tree.truncated)
      })
      .catch(() => { /* an old host half: the tree stays empty and says so */ })
    return () => { alive = false; ctrl.abort() }
  }, [fetchRepoTree, statsPath, gen])

  // The open file's text. `unstaged` is the layer whose target is the file on
  // disk — the only one this view is about.
  useEffect(() => {
    if (open === null) { setSides(null); setEdit(DISARMED); return }
    const ctrl = new AbortController()
    let alive = true
    setLoading(true)
    void fetchFileSides(statsPath, open, 'unstaged', ctrl.signal)
      .then(answer => {
        if (!alive) return
        setSides(answer)
        if (answer === null) { setEdit(DISARMED); return }
        // A NEW file adopts the payload outright; a refetch of the SAME file
        // — the drawer's poll, a worktree switch, the refetch a refused save
        // triggers — goes through applySides, which keeps a dirty buffer and
        // only records that the file moved underneath. Without that split,
        // every poll silently threw away whatever had been typed since the
        // last one. Armed straight away because this view IS an editor and
        // there is no gesture to arm with; armEdit still refuses a payload
        // it must not hold.
        const fresh = openRef.current !== open
        openRef.current = open
        setEdit(prev => fresh ? armEdit(DISARMED, answer) : applySides(prev, answer))
      })
      .catch(() => { if (alive) { setSides(null); setEdit(DISARMED) } })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false; ctrl.abort() }
  }, [open, fetchFileSides, statsPath, gen, refetch])

  useEffect(() => {
    if (!blameOn || open === null) { setBlame(null); setBlameFailed(false); return }
    const ctrl = new AbortController()
    let alive = true
    setBlameFailed(false)
    void fetchBlame(statsPath, open, ctrl.signal)
      .then(answer => {
        if (!alive) return
        setBlame(answer)
        setBlameFailed(answer === null)
      })
      .catch(() => { if (alive) { setBlame(null); setBlameFailed(true) } })
    return () => { alive = false; ctrl.abort() }
  }, [blameOn, open, fetchBlame, statsPath, gen])

  const all = useMemo(() => mergePaths(paths, extraPaths), [paths, extraPaths])
  const tree = useMemo(() => buildDirTree(all), [all])
  const roots = useMemo(() => rootFiles(all), [all])
  const rows = useMemo(
    () => query.trim().length > 0
      ? searchRows(all, query, SEARCH_CAP)
      : treeRows(tree, roots, expanded, FILES_PER_DIR),
    [query, all, tree, roots, expanded],
  )

  useEffect(() => { setPicked(null) }, [open, blameOn])

  // Switching worktrees re-reads the tree, and the file that was open may not
  // exist in the new one — an editor over a file that is not there would show
  // an empty buffer as if the file were empty. Dropped only once the new list
  // has actually arrived, and never out from under unsaved edits: those are
  // guarded one level up, where the source switch is asked about.
  const known = useMemo(() => new Set(all), [all])
  useEffect(() => {
    if (open === null || dirty || known.size === 0) return
    if (!known.has(open)) { setOpen(null); setSides(null); setEdit(DISARMED) }
  }, [known, open, dirty])

  const refusal = sides === null ? null : armRefusal(sides)
  const readOnly = refusal !== null
  /** The commit behind the picked line, or null when nothing is picked and
   *  when the blame does not reach that far. */
  const pickedEntry: BlameLine | null =
    picked === null || blame === null ? null : blame.lines[picked - 1] ?? null
  const showBlame = blameOn && !dirty
  const buffer = edit.buffer

  // Highlighting lags the buffer: a repaint is a Shiki pass over the whole
  // file, and paying that per keystroke is what makes a large file unusable.
  // CodeMirror maps the decorations it already has through each change, so
  // the colours ride along with the text until this catches up.
  const painted = useIdleValue(buffer, HIGHLIGHT_IDLE_MS)
  const tooBigToPaint = useMemo(() => countLines(painted) > HIGHLIGHT_LINE_CAP, [painted])
  const syntax = useMemo(
    () => tooBigToPaint
      ? undefined
      : highlightWholeFile(painted.split('\n'), shikiLangOf(open ?? ''), shikiThemeOf(palette)),
    [tooBigToPaint, painted, open, palette],
  )
  const indent = useMemo(() => detectIndent(edit.baseText), [edit.baseText])

  /** Open a file, revealing it in the tree — and asking first if the buffer
   *  holds edits, because opening another file drops them. */
  const openFile = (path: string): void => {
    if (path === open) return
    if (dirty) { setPending(path); return }
    setSaveFailed(null)
    setExpanded(prev => {
      const next = new Set(prev)
      for (const dir of ancestorsOf(path)) next.add(dir)
      return next
    })
    setOpen(path)
  }

  const toggleDir = (path: string): void => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const idRef = useRef(0)
  useEffect(() => { idRef.current += 1 }, [open])

  const save = async (): Promise<void> => {
    if (sides === null || !dirty || saving || readOnly) return
    const savedText = edit.buffer
    const session = idRef.current
    setSaving(true)
    try {
      const result = await writeChecked(statsPath, open ?? '', savedText, edit.baseSha, new AbortController().signal)
      const stillHere = idRef.current === session
      if (result === null) {
        if (stillHere) setSaveFailed(t('saveUnavailable'))
      } else if (result.ok) {
        if (stillHere) {
          setSaveFailed(null)
          setEdit(prev => applySaveOk(prev, savedText, result.sha ?? ''))
        }
        onSaved()
      } else if (result.failure === 'stale') {
        // The file moved under the buffer. The buffer stands; the reader
        // decides, and the refetch below makes the fresh text available.
        if (stillHere) {
          setEdit(prev => markConflict(prev))
          setSaveFailed(t('staleBody'))
          setRefetch(n => n + 1)
        }
      } else if (stillHere) {
        setSaveFailed(`${t('saveFailed')}${(result.error ?? '').trim().length > 0 ? `: ${(result.error ?? '').trim()}` : ''}`)
      }
    } finally {
      setSaving(false)
    }
  }

  const rowKey = (row: FileRow): string => `${row.kind}:${row.path}`

  return (
    <>
      <div ref={treeRef} className={css.fbTree} style={treeStyle} data-gs-part="fileTree">
        <input
          type="search"
          className={css.fbSearch}
          value={query}
          placeholder={t('fileSearchPlaceholder')}
          aria-label={t('fileSearchPlaceholder')}
          onChange={event => { setQuery(event.target.value) }}
        />
        {truncated ? <div className={css.fbNote}>{t('filesTruncated')}</div> : null}
        {rows.length === 0 ? (
          <div className={css.empty}>{all.length === 0 ? t('filesEmpty') : t('filesNoMatch')}</div>
        ) : (
          <ul className={css.fbList}>
            {rows.map(row => (
              <li key={rowKey(row)}>
                {row.kind === 'more' ? (
                  <span
                    className={css.fbMore}
                    style={{ paddingLeft: `${0.4 + row.depth * INDENT_EM}em` }}
                  >{t('filesMore', { count: row.hidden ?? 0 })}</span>
                ) : (
                <button
                  type="button"
                  title={row.path}
                  aria-expanded={row.kind === 'dir' ? row.open : undefined}
                  className={row.kind === 'file' && row.path === open
                    ? `${css.fbRow} ${css.fbRowActive}`
                    : css.fbRow}
                  style={{ paddingLeft: `${0.4 + row.depth * INDENT_EM}em` }}
                  onClick={() => { row.kind === 'dir' ? toggleDir(row.path) : openFile(row.path) }}
                >
                  {row.kind === 'dir' ? (
                    <>
                      <span className={`${css.chevron} ${row.open ? css.chevronOpen : ''}`}>▸</span>
                      <PathDirGlyph />
                    </>
                  ) : (
                    <>
                      <span className={css.chevron} aria-hidden="true" />
                      <PathFileGlyph path={row.path} />
                    </>
                  )}
                  <span className={row.kind === 'dir' ? css.fbDirName : css.fbFileName}>{row.name}</span>
                </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {divider}
      <div className={css.fbMain} data-gs-part="fileView">
        {open === null ? (
          <div className={css.empty}>{t('filesPick')}</div>
        ) : (
          <>
            <div className={css.fbHeader}>
              <span className={css.fbPath} title={open}>{open}</span>
              <span className={css.sideActions}>
                {!readOnly && sides !== null && !sides.binary && !sides.tooLarge ? (
                  <>
                    <button
                      type="button"
                      className={`${css.blockBtn}${dirty ? ` ${css.sideSaveReady}` : ''}`}
                      disabled={!dirty || saving}
                      onClick={() => { void save() }}
                    >{t('fileSave')}</button>
                    <button
                      type="button"
                      className={css.blockBtn}
                      disabled={!dirty || saving}
                      onClick={() => { setSaveFailed(null); setEdit(prev => ({ ...prev, buffer: prev.baseText })) }}
                    >{t('fileRevert')}</button>
                  </>
                ) : null}
                <button
                  type="button"
                  aria-pressed={blameOn}
                  title={t('blameHint')}
                  className={blameOn ? `${css.blockBtn} ${css.sideSaveReady}` : css.blockBtn}
                  onClick={() => { setBlameOn(on => !on) }}
                >{t('blameToggle')}</button>
              </span>
            </div>
            {pending !== null ? (
              <div className={css.sideNotice}>
                {t('filesUnsavedAsk')}
                <span className={css.sideActions}>
                  <button
                    type="button"
                    className={css.blockBtn}
                    onClick={() => {
                      const next = pending
                      setPending(null)
                      setEdit(DISARMED)
                      setSaveFailed(null)
                      setExpanded(prev => {
                        const set = new Set(prev)
                        for (const dir of ancestorsOf(next)) set.add(dir)
                        return set
                      })
                      setOpen(next)
                    }}
                  >{t('filesDiscardOpen')}</button>
                  <button
                    type="button"
                    className={css.blockBtn}
                    onClick={() => { setPending(null) }}
                  >{t('discardCancel')}</button>
                </span>
              </div>
            ) : null}
            {refusal !== null ? (
              <div className={css.sideNotice}>{t(refusal === 'encoding' ? 'fileReadOnlyEncoding' : 'fileReadOnlyCrlf')}</div>
            ) : null}
            {saveFailed !== null ? <div className={css.sideNotice}>{saveFailed}</div> : null}
            {tooBigToPaint ? <div className={css.sideNotice}>{t('paintTooLarge')}</div> : null}
            {blameOn && dirty ? <div className={css.sideNotice}>{t('blameWhileEditing')}</div> : null}
            {showBlame && (blameFailed || (blame !== null && blame.error !== undefined))
              ? <div className={css.sideNotice}>{t('blameFailed')}</div> : null}
            {showBlame && blame !== null && blame.truncated
              ? <div className={css.sideNotice}>{t('blameTruncated')}</div> : null}
            {/* The strip is present for as long as blame is, so the space does
                not jump as lines are picked — and while nothing is picked it
                says that picking is a thing, which is the whole affordance:
                the gutter is names, and nothing about a name looks clickable. */}
            {showBlame ? (
              <div className={css.fbCommit}>
                {pickedEntry === null ? (
                  <span className={css.fbCommitHint}>{t('blamePick')}</span>
                ) : (
                  <>
                <span className={css.fbCommitLine}>{t('blameLine', { line: picked ?? 0 })}</span>
                {pickedEntry.uncommitted ? (
                  <span className={css.fbCommitWho}>{t('blameUncommitted')}</span>
                ) : (
                  <>
                    <span className={css.fbCommitWho}>{pickedEntry.author}</span>
                    <span className={css.fbCommitWhen}>{blameWhen(pickedEntry.time)}</span>
                    <code className={css.fbCommitHash}>{shortHash(pickedEntry.hash)}</code>
                    <span className={css.fbCommitWhat} title={pickedEntry.summary}>{pickedEntry.summary}</span>
                    {/* The question a name in the gutter raises is rarely
                        about this one line — it is "what else did they do to
                        this file". The History tab already answers that, with
                        a filter grammar that takes both halves, so the strip
                        hands it the query rather than growing a second commit
                        list of its own. */}
                    <button
                      type="button"
                      className={css.blockBtn}
                      onClick={() => {
                        onShowHistory(serializeLogQuery({
                          ...emptyQueryFilter(),
                          users: [pickedEntry.author],
                          paths: [open],
                        }))
                      }}
                    >{t('blameInHistory')}</button>
                  </>
                )}
                <button
                  type="button"
                  className={css.blockBtn}
                  onClick={() => { setPicked(null) }}
                >{t('close')}</button>
                  </>
                )}
              </div>
            ) : null}
            <div className={css.fbBody}>
              {loading && sides === null ? <div className={css.empty}>{t('loading')}</div>
                : sides === null ? <div className={css.empty}>{t('saveUnavailable')}</div>
                : sides.binary ? <div className={css.empty}>{t('binaryFile')}</div>
                : sides.tooLarge ? <div className={css.empty}>{t('diffTooLarge')}</div>
                : (
                  <CodeEditor
                    key={open}
                    value={edit.buffer}
                    original={edit.baseText}
                    onChange={next => { setEdit(prev => ({ ...prev, buffer: next })) }}
                    syntax={syntax}
                    indent={indent}
                    ariaLabel={open}
                    onSave={() => { void save() }}
                    blame={showBlame && blame !== null ? blame.lines : null}
                    onBlameClick={line => { setPicked(line) }}
                    notCommitted={t('blameUncommitted')}
                    readOnly={readOnly}
                  />
                )}
            </div>
          </>
        )}
      </div>
    </>
  )
}
