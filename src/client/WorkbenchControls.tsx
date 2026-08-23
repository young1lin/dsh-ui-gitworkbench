import { useEffect, useRef, useState, type Dispatch, type ReactNode, type Ref, type SetStateAction } from 'react'

import {
  COLOR_MODES, STYLE_BLUR_MAX, STYLE_SCOPES, THEME_FAMILIES, entryFor,
  type ColorMode, type StyleEntry, type StyleScope, type StyleSettings, type ThemeFamily,
} from './themes.ts'
import type { DiscardPreview } from './discard-flow.ts'
import { samePath, splitPath } from './worktree-view.ts'
import { BUSY_DELAY_MS, BUSY_HOLD_MS, holdRemaining, quietlyDisabled } from './op-feedback.ts'
import { ChromeGlyph } from './ChromeGlyph.tsx'
import { WorktreeGlyph } from './WorktreeGlyph.tsx'
import type { WorkbenchKey } from './locales.ts'
import type { BlockAsk, GitFile, GitOpFailure, GitOpName, GitOpPayload, GitOpResult, SyncStatus, Translate, WorktreeEntry } from './git-workbench-types.ts'
import css from './GitWorkbenchPanel.module.css'

const IMAGE_MAX_EDGE = 2560
const IMAGE_QUALITY = 0.82
const IMAGE_MAX_BYTES = 3_000_000

/**
 * The one dialog in this drawer, because this is the one act it cannot undo.
 *
 * It never asks a generic "are you sure": the caller hands it a body that names
 * the file and states which consequence is about to happen — the whole-file
 * roll-back's wording derived from the host's own reading of that file, the
 * block roll-back's from the pane's rows. Cancel holds the initial focus and
 * Escape closes, because the default answer to an irreversible question is no.
 *
 * There is deliberately no "don't ask again". This is the only path in the
 * drawer with nothing behind it, and a checkbox whose whole function is to
 * switch off the last guard is a feature that eventually gets clicked.
 */
export function DiscardConfirm({ t, body, onCancel, onConfirm }: {
  t: Translate
  body: string
  onCancel: () => void
  onConfirm: () => void
}): ReactNode {
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { cancelRef.current?.focus() }, [])
  useEffect(() => {
    // Capture phase: while this question is open, Escape belongs to it alone
    // — consumed here, before it can reach the page's other Escape handlers
    // (an open picker's dismiss, the commit box's undo).
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onCancel()
    }
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('keydown', onKey, true) }
  }, [onCancel])

  return (
    <div className={css.confirmScrim} onClick={onCancel}>
      <div
        className={css.confirmBox}
        role="alertdialog"
        aria-modal="true"
        aria-label={t('discardTitle')}
        onClick={event => event.stopPropagation()}
      >
        <div className={css.confirmTitle}>{t('discardTitle')}</div>
        <div className={css.confirmBody}>{body}</div>
        <div className={css.confirmActions}>
          <button ref={cancelRef} type="button" className={css.btn} onClick={onCancel}>{t('discardCancel')}</button>
          <button type="button" className={`${css.btn} ${css.btnDanger}`} onClick={onConfirm}>{t('discardConfirm')}</button>
        </div>
      </div>
    </div>
  )
}

/**
 * The whole-file roll-back's consequence, in the host's own fresh reading of
 * the file — the difference between "goes back to its committed content" and
 * "leaves the disk and cannot come back" is the entire question the dialog
 * asks, and it is exactly what a stale row gets wrong.
 */
export function discardBodyText(t: Translate, file: GitFile, plan: DiscardPreview): string {
  if (plan.effect === 'delete') return t('discardBodyDelete', { path: file.path })
  if (plan.effect === 'unrename') return t('discardBodyUnrename', { path: file.path, previousPath: plan.previousPath ?? '' })
  return t('discardBodyRestore', { path: file.path, added: file.addedLines, deleted: file.deletedLines })
}

/**
 * The BLOCK roll-back's consequence, in the pane's own rows.
 *
 * One case outranks the tally wording: an untracked file's whole content is
 * the one block, and rolling THAT block back reverse-applies the new-file
 * patch — which deletes the file from the working tree, not rewrites it. The
 * file row's status is the gate (a tracked file whose every line changed has
 * the same block shape and only rewrites), which is why the ask's shape alone
 * is not enough.
 */
export function blockDiscardBodyText(t: Translate, ask: BlockAsk, file: GitFile | undefined): string {
  if (file !== undefined && file.status === 'untracked' && ask.wholeFile) {
    return t('blockDiscardBodyDelete', { path: ask.path })
  }
  return t('blockDiscardBody', { path: ask.path, added: ask.added, deleted: ask.deleted })
}

/**
 * A slash-separated name that gives up its HEAD, never its tail.
 *
 * Paths and branches have the same shape and the same problem: the leaf is what
 * distinguishes siblings, and ordinary `text-overflow: ellipsis` eats exactly
 * that. `…/worktrees/fixture-07` and `…/worktrees/fixture-14` become the same
 * string; so do `feature/nested/deep/parser` and `feature/nested/deep/lexer`.
 * Splitting in two and letting only the head shrink keeps the half that
 * answers "which one".
 *
 * Truncating from the other end with `direction: rtl` was the one-line version
 * and the wrong one: it reorders the backslashes in a Windows path.
 *
 * When the name has no head to give — a bare `some-very-long-branch-name` — the
 * tail ellipsises after all rather than overflowing its row; the stylesheet
 * weights the shrink so that only happens once the head is gone.
 */
export function Elided({ text, className, title }: {
  text: string
  className: string
  /** Set only where the row does not already carry the full text itself. */
  title?: string
}): ReactNode {
  if (text.length === 0) return null
  const { head, tail } = splitPath(text)
  return (
    <span className={`${css.elide} ${className}`} {...title === undefined ? {} : { title }}>
      {head.length > 0 ? <span className={css.elideHead}>{head}</span> : null}
      <span className={css.elideTail}>{tail}</span>
    </span>
  )
}

/**
 * Which worktree the drawer is reading — the header's first control.
 *
 * Git allows at most one worktree per branch, so the repository's worktree list
 * IS the branch list and one control covers both. This used to be a row of its
 * own under the tabs, restating the branch the header had already named one
 * line above; now it IS that name, and clicking it changes the view.
 *
 * A repository with a single worktree has nothing to choose, so it renders as
 * the same chip without the menu — the identity still has to be stated, and a
 * control that opens an empty list is worse than none.
 */
export function SourceChip({ t, worktrees, boundPath, sessionPath, statsPath, fallbackBranch, onSwitch }: {
  t: Translate
  worktrees: readonly WorktreeEntry[]
  boundPath: string | null
  sessionPath: string | undefined
  statsPath: string | undefined
  /** What to name when the worktree list does not cover the active path — the
   *  branch the stats themselves report. */
  fallbackBranch: string
  onSwitch: (next: string) => void
}): ReactNode {
  if (worktrees.length < 2) {
    return (
      <span className={css.headerBranch}>
        <WorktreeGlyph />
        <Elided text={branchLabel(fallbackBranch, t('noBranch'))} className={css.refValue} />
      </span>
    )
  }
  return (
    <WorktreePicker
      t={t} worktrees={worktrees} boundPath={boundPath}
      sessionPath={sessionPath} statsPath={statsPath}
      fallbackBranch={fallbackBranch} onSwitch={onSwitch}
    />
  )
}

/**
 * The worktree menu: the ref picker's scaffold — button, filter box, scrolling
 * list — over worktree rows, wearing the header chip's accent so it reads as
 * the subject of the drawer rather than one more grey button.
 *
 * Rows carry the tree glyph when the session is bound there and a dot when it
 * is the session's own; Enter takes the first match.
 *
 * The row gives its whole width to the branch. A dim path used to ride on the
 * right to tell same-named branches in different repositories apart, but it
 * cost half the row to earn that, and the half it took was the half that
 * mattered: `wt/fixture-03` truncated to `wt/fixtur…` beside a path whose tail
 * was repeating the name anyway. The full path stays one hover away on `title`,
 * and the header spells it out the moment a row is picked.
 */
function WorktreePicker({ t, worktrees, boundPath, sessionPath, statsPath, fallbackBranch, onSwitch }: {
  t: Translate
  worktrees: readonly WorktreeEntry[]
  boundPath: string | null
  sessionPath: string | undefined
  statsPath: string | undefined
  fallbackBranch: string
  onSwitch: (next: string) => void
}): ReactNode {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useDismissable(open, setOpen)

  const needle = query.trim().toLowerCase()
  const matched = needle.length === 0 ? worktrees : worktrees.filter(entry =>
    entry.branch.toLowerCase().includes(needle) || entry.path.toLowerCase().includes(needle))
  const first = matched[0]
  const current = worktrees.find(entry => samePath(entry.path, statsPath))

  const choose = (entry: WorktreeEntry): void => {
    onSwitch(entry.path)
    setOpen(false)
    setQuery('')
  }

  return (
    <div className={css.refPicker} ref={rootRef}>
      <button
        type="button"
        className={`${css.refButton} ${css.headerPicker}`}
        aria-expanded={open}
        aria-label={t('sourceLabel')}
        title={current?.path ?? statsPath}
        onClick={() => setOpen(isOpen => !isOpen)}
      >
        <WorktreeGlyph />
        <Elided text={branchLabel(current?.branch ?? fallbackBranch, t('noBranch'))} className={css.refValue} />
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
          <div className={css.refList} role="listbox" aria-label={t('sourceLabel')}>
            {matched.map(entry => {
              const active = samePath(entry.path, statsPath)
              return (
                <button
                  key={entry.path}
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={active ? `${css.refRow} ${css.refRowActive}` : css.refRow}
                  title={entry.path}
                  onClick={() => choose(entry)}
                >
                  {samePath(boundPath, entry.path) ? <WorktreeGlyph /> : <span className={css.refRowSpacer} />}
                  <Elided text={branchLabel(entry.branch, t('noBranch'))} className={css.refRowName} />
                  {samePath(sessionPath, entry.path) ? <span className={css.wtCurrent}>●</span> : null}
                </button>
              )
            })}
            {matched.length === 0 ? <div className={css.refEmpty}>{t('refNone')}</div> : null}
          </div>
          <div className={css.refFoot}>{t('refCount', { shown: matched.length, total: worktrees.length })}</div>
        </div>
      ) : null}
    </div>
  )
}

/**
 * Settings: colour mode, palette, background image and custom CSS.
 *
 * Mode defaults to `system`, which follows dsh (`body[data-ds-dark-theme]`);
 * light and dark pin the drawer even when the host is the other scheme. The
 * palette is a pure token swap — every drawer colour resolves through the same
 * names, so nothing but the values differ between families.
 *
 * The background and the stylesheet are per-scope, and the scope switch is the
 * only control in here that changes what an edit WRITES rather than what it
 * looks like, so it sits at the top of that section rather than beside a field.
 *
 * This was a companion card portalled into the overlay to the LEFT of the
 * drawer, so a palette could be previewed against the diff without covering it.
 * It is a popover now, hung under its own gear: a card floating out in the page
 * beside the drawer read as a second window rather than as this drawer's
 * settings, and it was the one menu here that did not behave like the rest.
 * The preview still works — the popover covers the top of the diff, not all of
 * it, and the drawer repaints live underneath.
 */
export function SettingsMenu({ t, mode, family, onMode, onFamily, settings, onStyle }: {
  t: Translate
  mode: ColorMode
  family: ThemeFamily
  onMode: (next: ColorMode) => void
  onFamily: (next: ThemeFamily) => void
  settings: StyleSettings
  onStyle: (scope: StyleScope, entry: StyleEntry, persist: boolean) => Promise<{ ok: boolean; error?: string }>
}): ReactNode {
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState<StyleScope>('project')
  /** Editor buffer for the stylesheet, so typing does not restyle on every key. */
  const [draft, setDraft] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const rootRef = useDismissable(open, setOpen)
  const imageFileRef = useRef<HTMLInputElement>(null)
  const cssFileRef = useRef<HTMLInputElement>(null)

  // The buffer belongs to one scope; switching scope must show that scope's
  // stylesheet rather than carry the other one's text across.
  useEffect(() => { setDraft(null); setNote('') }, [scope])

  // The default scope is `project`, chosen before the host has said whether
  // there IS one. Outside a repository it has nothing to key by, so the menu
  // falls back rather than pointing every control at a scope that refuses
  // every write.
  useEffect(() => {
    if (settings.repoRoot === null) setScope('global')
  }, [settings.repoRoot])

  const entry = entryFor(settings, scope)
  const cssText = draft ?? entry.css

  /**
   * Apply a change to the scope being edited.
   * @param patch - the fields that changed.
   * @param persist - whether to store it; false previews without a file write.
   */
  const write = (patch: Partial<StyleEntry>, persist = true): void => {
    setNote('')
    void onStyle(scope, { ...entry, ...patch }, persist).then(result => {
      if (!result.ok) setNote(result.error ?? t('styleFailed'))
    })
  }

  /**
   * Resample a chosen image and store it.
   *
   * Downscaling in the browser is what keeps this practical: a phone photograph
   * is 4-6MB, far past what is worth carrying on every drawer open, and none of
   * that detail survives a blur anyway.
   * @param file - the picked file.
   */
  const takeImage = async (file: File): Promise<void> => {
    setNote(t('bgWorking'))
    try {
      const bitmap = await createImageBitmap(file)
      const scale = Math.min(1, IMAGE_MAX_EDGE / Math.max(bitmap.width, bitmap.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(bitmap.width * scale)
      canvas.height = Math.round(bitmap.height * scale)
      const context = canvas.getContext('2d')
      if (context === null) { setNote(t('bgFailed')); return }
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      bitmap.close()
      const url = canvas.toDataURL('image/jpeg', IMAGE_QUALITY)
      if (url.length > IMAGE_MAX_BYTES) { setNote(t('bgTooBig')); return }
      setNote('')
      write({ image: url })
    } catch {
      // A file the decoder refuses (corrupt, or an image codec this browser
      // lacks) is a user mistake, not a fault worth propagating.
      setNote(t('bgFailed'))
    }
  }

  const modeLabel: Record<ColorMode, string> = {
    system: t('modeSystem'), light: t('modeLight'), dark: t('modeDark'),
  }
  const modeChip: Record<ColorMode, string> = {
    system: css.chipSystem, light: css.chipLight, dark: css.chipDark,
  }
  const scopeLabel: Record<StyleScope, string> = {
    project: t('scopeProject'), global: t('scopeGlobal'),
  }
  const projectAvailable = settings.repoRoot !== null

  return (
    <div className={css.theme} ref={rootRef}>
      <button
        type="button"
        className={`${css.btn} ${css.btnIcon}`}
        aria-expanded={open}
        aria-label={t('settings')} title={t('settings')}
        onClick={() => setOpen(value => !value)}
      ><ChromeGlyph of="settings" /></button>
      {open ? (
        <div className={`${css.refPop} ${css.settingsPop}`} data-gs-part="settings">
          {/* The popover positions and clips; this is the padded body that
              scrolls inside it. Collapsing the two put every section flush
              against the card's edge. */}
          <div className={css.themeRail} data-gs-part="theme-rail">
          <div className={css.themeGroup}>
            <span className={css.themeLabel}>{t('themeMode')}</span>
            <div className={css.segmented} role="group" aria-label={t('themeMode')}>
              {COLOR_MODES.map(option => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={mode === option}
                  className={mode === option ? `${css.segment} ${css.segmentActive}` : css.segment}
                  onClick={() => onMode(option)}
                >
                  <span className={`${css.segmentChip} ${modeChip[option]}`} aria-hidden="true" />
                  {modeLabel[option]}
                </button>
              ))}
            </div>
          </div>

          <div className={css.themeGroup}>
            <span className={css.themeLabel}>{t('themePalette')}</span>
            {THEME_FAMILIES.map(option => (
              <button
                key={option.id}
                type="button"
                aria-pressed={family === option.id}
                className={family === option.id ? `${css.paletteRow} ${css.paletteRowActive}` : css.paletteRow}
                onClick={() => onFamily(option.id)}
              >
                <span className={css.swatch} aria-hidden="true">
                  {option.swatch.map(color => <span key={color} style={{ background: color }} />)}
                </span>
                {option.label}
              </button>
            ))}
          </div>

          <div className={css.themeGroup}>
            <span className={css.themeLabel}>{t('themeScope')}</span>
            <div className={css.scopeRow} role="group" aria-label={t('themeScope')}>
              {STYLE_SCOPES.map(option => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={scope === option}
                  disabled={option === 'project' && !projectAvailable}
                  className={scope === option ? `${css.scopeBtn} ${css.scopeBtnActive}` : css.scopeBtn}
                  onClick={() => setScope(option)}
                >{scopeLabel[option]}</button>
              ))}
            </div>
            <span className={css.scopeHint}>
              {scope === 'global' ? t('scopeGlobalHint')
                : projectAvailable ? settings.repoRoot
                  : t('scopeNoRepo')}
            </span>
          </div>

          <div className={css.themeGroup}>
            <span className={css.themeLabel}>{t('themeBackground')}</span>
            <div
              className={entry.image.length > 0 ? css.bgPreview : `${css.bgPreview} ${css.bgEmpty}`}
              style={entry.image.length > 0 ? { backgroundImage: `url("${entry.image}")` } : undefined}
            >{entry.image.length > 0 ? null : t('bgNone')}</div>
            <div className={css.themeRowSplit}>
              <button type="button" className={css.miniBtn} onClick={() => imageFileRef.current?.click()}>{t('bgChoose')}</button>
              {entry.image.length > 0
                ? <button type="button" className={css.miniBtn} onClick={() => write({ image: '' })}>{t('bgClear')}</button>
                : null}
            </div>
            <input
              ref={imageFileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={event => {
                const file = event.target.files?.[0]
                // Clearing the input is what lets the same file be picked twice
                // after a failure; a change event fires only on a NEW value.
                event.target.value = ''
                if (file !== undefined) void takeImage(file)
              }}
            />
            {entry.image.length > 0 ? (
              <>
                <label className={css.sliderRow}>
                  {t('bgBlur')}
                  <input
                    type="range" min={0} max={STYLE_BLUR_MAX} step={1} value={entry.blur}
                    onChange={event => write({ blur: Number(event.target.value) }, false)}
                    onPointerUp={() => write({})}
                    onKeyUp={() => write({})}
                  />
                  <span className={css.sliderValue}>{entry.blur}px</span>
                </label>
                <label className={css.sliderRow}>
                  {t('bgVeil')}
                  <input
                    type="range" min={0} max={100} step={1} value={entry.veil}
                    onChange={event => write({ veil: Number(event.target.value) }, false)}
                    onPointerUp={() => write({})}
                    onKeyUp={() => write({})}
                  />
                  <span className={css.sliderValue}>{entry.veil}%</span>
                </label>
              </>
            ) : null}
          </div>

          <div className={css.themeGroup}>
            <span className={css.themeLabel}>{t('themeCss')}</span>
            <textarea
              className={css.cssArea}
              spellCheck={false}
              placeholder={t('cssPlaceholder')}
              value={cssText}
              onChange={event => setDraft(event.target.value)}
            />
            <div className={css.themeRowSplit}>
              <button type="button" className={css.miniBtn} onClick={() => cssFileRef.current?.click()}>{t('cssImport')}</button>
              <button
                type="button"
                className={`${css.miniBtn} ${css.miniBtnPrimary}`}
                disabled={draft === null}
                onClick={() => { write({ css: cssText }); setDraft(null) }}
              >{t('cssApply')}</button>
            </div>
            <input
              ref={cssFileRef}
              type="file"
              accept=".css,text/css"
              hidden
              onChange={event => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file !== undefined) void file.text().then(text => setDraft(text))
              }}
            />
            {draft === null ? null : <span className={css.themeDirty}>{t('cssUnapplied')}</span>}
          </div>

            {note.length > 0 ? <span className={css.themeNote}>{note}</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

/**
 * Close a popover on the two gestures every user already expects: a click
 * outside it, and Escape. Both arrive on `document` rather than on the
 * popover's own subtree, so neither can be a handler on the element.
 * @param open - whether the popover is showing; nothing is bound while closed.
 * @param setOpen - the state setter, stable, so the effect binds once per open.
 * @returns the ref to put on the element that counts as "inside".
 */
function useDismissable(open: boolean, setOpen: Dispatch<SetStateAction<boolean>>): Ref<HTMLDivElement> {
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') setOpen(false) }
    // Bound on the next tick: the click that opened the popover is still
    // travelling, and would otherwise close it again immediately.
    const id = window.setTimeout(() => document.addEventListener('mousedown', onDown), 0)
    document.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(id)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, setOpen])
  return rootRef
}

/**
 * Ref picker built for a repository with hundreds of branches.
 *
 * A chip row cannot do this job — it grows without bound and gives every branch
 * the same weight — and a native select is no better once the list is long
 * enough to scroll past what anyone will read. This is the control git tooling
 * converges on instead: one button showing the current ref, opening a filter box
 * over a scrolling list.
 *
 * Two things make it useful before a character is typed. Branches arrive
 * most-recently-committed first, so the handful actually being worked on are at
 * the top; and those that have a worktree are grouped above the rest, because a
 * checked-out branch is the likeliest thing to want. Enter takes the first
 * match, so a distinctive substring plus Enter reaches any branch in the list.
 */
/** Sentinel ref meaning "walk every ref" — same string the host special-cases
 *  into `--all`. A real ref cannot begin with a dash, so it collides with
 *  nothing; defined separately on both halves (client bundles import no host
 *  values), tied by this comment and the probe. */
const ALL_REFS = '--all'

export function RefPicker({ t, label, value, branches, worktreeBranches, truncated, onPick, allLabel }: {
  t: Translate
  label: string
  value: string
  branches: readonly string[]
  /** Branches that have a worktree — grouped first and marked. */
  worktreeBranches: readonly string[]
  /** Whether the host cut the branch list short. */
  truncated: boolean
  onPick: (ref: string) => void
  /** When set, an "all branches" entry is offered above the list and shown for
   *  the {@link ALL_REFS} sentinel — the history picker's answer to "search
   *  must not require knowing which branch holds the commit". */
  allLabel?: string
}): ReactNode {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useDismissable(open, setOpen)

  const needle = query.trim().toLowerCase()
  const matched = needle.length === 0 ? branches : branches.filter(ref => ref.toLowerCase().includes(needle))
  const checkedOut = matched.filter(ref => worktreeBranches.includes(ref))
  const rest = matched.filter(ref => !worktreeBranches.includes(ref))
  const first = checkedOut[0] ?? rest[0]

  const choose = (ref: string): void => {
    onPick(ref)
    setOpen(false)
    setQuery('')
  }

  const row = (ref: string, inWorktree: boolean): ReactNode => (
    <button
      key={ref}
      type="button"
      role="option"
      aria-selected={ref === value}
      className={ref === value ? `${css.refRow} ${css.refRowActive}` : css.refRow}
      title={ref}
      onClick={() => choose(ref)}
    >
      {inWorktree ? <WorktreeGlyph /> : <span className={css.refRowSpacer} />}
      <Elided text={ref} className={css.refRowName} />
    </button>
  )

  return (
    <div className={css.refPicker} ref={rootRef}>
      <span className={css.refLabel}>{label}</span>
      <button
        type="button"
        className={css.refButton}
        aria-expanded={open}
        title={value.length > 0 ? value : undefined}
        onClick={() => setOpen(isOpen => !isOpen)}
      >
        <Elided text={value === ALL_REFS && allLabel !== undefined ? allLabel : (value.length > 0 ? value : '—')} className={css.refValue} />
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
          <div className={css.refList} role="listbox" aria-label={label}>
            {allLabel !== undefined && (needle.length === 0 || allLabel.toLowerCase().includes(needle)) ? (
              <button
                type="button"
                role="option"
                aria-selected={value === ALL_REFS}
                className={value === ALL_REFS ? `${css.refRow} ${css.refRowActive}` : css.refRow}
                title={allLabel}
                onClick={() => choose(ALL_REFS)}
              >
                <span className={css.refRowSpacer} />
                <Elided text={allLabel} className={css.refRowName} />
              </button>
            ) : null}
            {checkedOut.length > 0 && rest.length > 0 ? <div className={css.refGroup}>{t('refWorktrees')}</div> : null}
            {checkedOut.map(ref => row(ref, true))}
            {checkedOut.length > 0 && rest.length > 0 ? <div className={css.refGroup}>{t('refBranches')}</div> : null}
            {rest.map(ref => row(ref, false))}
            {matched.length === 0 && !(allLabel !== undefined && needle.length > 0 && allLabel.toLowerCase().includes(needle)) ? <div className={css.refEmpty}>{t('refNone')}</div> : null}
          </div>
          <div className={css.refFoot}>
            {t('refCount', { shown: matched.length, total: branches.length })}
            {truncated ? ` · ${t('refTruncated')}` : ''}
          </div>
        </div>
      ) : null}
    </div>
  )
}

/**
 * Compare tab controls: the two refs, in reading order.
 *
 * Both sides list the same refs — comparing a branch against itself is possible
 * to express and simply reports nothing, which is clearer than hiding it.
 */
export function CompareBar({ t, branches, worktreeBranches, truncated, baseRef, headRef, onBaseRef, onHeadRef }: {
  t: Translate
  branches: readonly string[]
  worktreeBranches: readonly string[]
  truncated: boolean
  baseRef: string
  headRef: string
  onBaseRef: (ref: string) => void
  onHeadRef: (ref: string) => void
}): ReactNode {
  if (branches.length === 0) return <div className={css.compareBar}>{t('noBranches')}</div>
  return (
    <div className={css.compareBar}>
      <RefPicker
        t={t} label={t('compareBase')} value={baseRef}
        branches={branches} worktreeBranches={worktreeBranches} truncated={truncated}
        onPick={onBaseRef}
      />
      <span className={css.compareArrow}>→</span>
      <RefPicker
        t={t} label={t('compareHead')} value={headRef}
        branches={branches} worktreeBranches={worktreeBranches} truncated={truncated}
        onPick={onHeadRef}
      />
    </div>
  )
}

/* ---------- write operations ---------- */

/**
 * Failures whose sentence is the whole story. Everything else shows git's own
 * text underneath, because the classification is a hint about what to do next
 * and the raw message is the evidence for it — when the hint is `unknown` it is
 * the only thing left that helps at all.
 *
 * These two are excluded because their detail is never informative and is often
 * actively misleading: git says nothing useful about an empty index, so what
 * lands in stderr is whatever a hook wrapper happened to print. A user reading
 * "nothing staged" followed by a lefthook config warning learns only that
 * something else is broken, which is not true.
 */
const SELF_EXPLANATORY: ReadonlySet<GitOpFailure> = new Set(['nothing-to-commit', 'no-upstream'])

/** What to tell the user about a finished operation. */
export function opMessage(t: Translate, op: GitOpName, result: GitOpResult): string {
  if (result.ok) return t(`op.ok.${op}`)
  const failure = result.failure ?? 'unknown'
  const reason = t(`op.fail.${failure}`)
  if (SELF_EXPLANATORY.has(failure)) return reason
  const detail = (result.error ?? '').trim()
  return detail.length > 0 ? `${reason}\n${detail}` : reason
}

/**
 * Glyphs for the three network actions, on Primer's 16px grid.
 *
 * They sit BESIDE the labels rather than replacing them. The complaint that
 * started this was that Fetch/Pull/Push do not say what they do — icon-only
 * would answer it by removing the half that is unambiguous. What an icon adds
 * is recognition at a glance: down is work arriving, up is work leaving, and
 * the ring is the one that only reads a remote without changing anything here.
 */
const SYNC_GLYPH = {
  // Circular arrows: VS Code's and IDEA's shared sign for "refresh what I know
  // about the remote". Nothing in the working tree moves.
  fetch: 'M8 2.5a5.5 5.5 0 0 0-4.9 3 .75.75 0 0 1-1.34-.68A7 7 0 0 1 13.5 5.2V3.75a.75.75 0 0 1 1.5 0v3.5a.75.75 0 0 1-.75.75h-3.5a.75.75 0 0 1 0-1.5h1.86A5.5 5.5 0 0 0 8 2.5Zm-6.25 6a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5a.75.75 0 0 1 .75-.75Zm.75 1.5h3.5a.75.75 0 0 1 0 1.5H4.14A5.5 5.5 0 0 0 12.9 10.5a.75.75 0 0 1 1.34.68A7 7 0 0 1 2.5 10.8v-.05a.75.75 0 0 1 0-.75Z',
  // Down into a floor line: commits arriving from the remote onto this branch.
  pull: 'M8 1.75a.75.75 0 0 1 .75.75v6.44l2.22-2.22a.75.75 0 1 1 1.06 1.06l-3.5 3.5a.75.75 0 0 1-1.06 0l-3.5-3.5a.75.75 0 0 1 1.06-1.06l2.22 2.22V2.5A.75.75 0 0 1 8 1.75ZM2.75 12.5h10.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5Z',
  // Up off a floor line: the same arrow mirrored, because the pair only reads
  // as a direction if it is the same arrow.
  push: 'M7.47 1.97a.75.75 0 0 1 1.06 0l3.5 3.5a.75.75 0 0 1-1.06 1.06L8.75 4.31v6.44a.75.75 0 0 1-1.5 0V4.31L5.03 6.53a.75.75 0 0 1-1.06-1.06l3.5-3.5ZM2.75 12.5h10.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5Z',
} as const

function SyncGlyph({ of }: { of: keyof typeof SYNC_GLYPH }): ReactNode {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d={SYNC_GLYPH[of]} />
    </svg>
  )
}



const PULL_MODES = ['ff-only', 'rebase', 'merge'] as const
type PullMode = typeof PULL_MODES[number]

/** Each strategy's label key, so the trigger and the menu cannot disagree. */
const PULL_MODE_KEY: Record<PullMode, WorkbenchKey> = {
  'ff-only': 'pullFf',
  rebase: 'pullRebase',
  merge: 'pullMerge',
}

/**
 * Pull strategy, in the drawer's own menu idiom.
 *
 * This was a native `<select>`, justified as "a three-way choice used rarely".
 * The cost was not the frequency: a native popup paints in the OS palette, so
 * it was the one control in the drawer that ignored `data-gs-theme` — system
 * blue over Solarized, square corners in a row of pills. Reusing the ref
 * picker's button and popover makes it the same idiom as the drawer's other
 * menu rather than a second one.
 */
function SyncModePicker({ t, value, disabled, quiet, onPick }: {
  t: Translate
  value: PullMode
  disabled: boolean
  /** Disabled only by an operation too young to report: refuse, but do not dim. */
  quiet: boolean
  onPick: (mode: PullMode) => void
}): ReactNode {
  const [open, setOpen] = useState(false)
  const rootRef = useDismissable(open, setOpen)

  return (
    <div className={css.refPicker} ref={rootRef}>
      <button
        type="button"
        className={css.refButton}
        aria-expanded={open}
        aria-label={t('pullModeLabel')}
        disabled={disabled}
        data-quiet={quiet ? '' : undefined}
        onClick={() => setOpen(isOpen => !isOpen)}
      >
        <span className={`${css.elide} ${css.refValue}`}><span className={css.elideTail}>{t(PULL_MODE_KEY[value])}</span></span>
        <span className={css.refCaret}>▾</span>
      </button>
      {open ? (
        <div className={`${css.refPop} ${css.menuPop}`} role="listbox" aria-label={t('pullModeLabel')}>
          {PULL_MODES.map(pullMode => (
            <button
              key={pullMode}
              type="button"
              role="option"
              aria-selected={pullMode === value}
              className={pullMode === value ? `${css.refRow} ${css.refRowActive}` : css.refRow}
              onClick={() => { onPick(pullMode); setOpen(false) }}
            >{t(PULL_MODE_KEY[pullMode])}</button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/**
 * Whether an in-flight operation has run long enough to be worth showing.
 *
 * True only after `active` has held for `delay`, and then for at least `hold`
 * however quickly it ends — so a fast operation never paints, and a slow one
 * never blinks. See `op-feedback.ts` for why the appearance is paced and the
 * guard is not.
 */
function useSustained(active: boolean, delay = BUSY_DELAY_MS, hold = BUSY_HOLD_MS): boolean {
  const [shown, setShown] = useState(false)
  const shownAt = useRef(0)
  useEffect(() => {
    if (active === shown) return undefined
    const wait = active ? delay : holdRemaining(shownAt.current, Date.now(), hold)
    const id = setTimeout(() => {
      if (active) shownAt.current = Date.now()
      setShown(active)
    }, wait)
    return () => { clearTimeout(id) }
  }, [active, shown, delay, hold])
  return shown
}

/**
 * Fetch / pull / push, with the divergence they act on.
 *
 * Hidden entirely when the repository has no remote: three buttons that can only
 * fail are worse than no buttons. Pull carries its own strategy picker rather
 * than reading `pull.rebase`, so the button's label is what actually runs.
 *
 * The three used to be one grey pill each, distinguished by their word and a
 * 13px glyph — indistinguishable at a glance because they carried the same
 * amount of information, which was none. The counts have moved off the
 * divergence pills and INTO the two buttons that act on them, so the control
 * that can do something about the drift is also the one that reports it. Fetch
 * stays quiet in every state: it writes nothing, so it never has news.
 */
export function SyncBar({ t, sync, busy, onOp }: {
  t: Translate
  sync: SyncStatus
  busy: GitOpName | null
  onOp: (op: GitOpName, payload?: GitOpPayload) => void
}): ReactNode {
  const [mode, setMode] = useState<PullMode>('ff-only')
  const running = busy !== null
  const noUpstream = sync.upstream === null
  // Every tick stages through git, so this bar was fading out and back on each
  // one. The buttons still refuse the click from the first frame; only saying
  // so waits until there is something worth saying.
  const sustained = useSustained(running)
  const quiet = quietlyDisabled(running, sustained, false)

  /** Push is the branch's first — the one case where it is the whole point of
   *  the bar, so it is the one case that gets the solid fill. */
  const pushClass = noUpstream ? `${css.btn} ${css.btnPrimary}`
    : sync.ahead > 0 ? `${css.btn} ${css.btnAhead}`
      : css.btn

  return (
    <div className={css.syncBar} role="group" aria-label={t('syncLabel')}>
      <span className={css.syncUpstream} title={sync.upstream ?? undefined}>
        {noUpstream ? t('noUpstream') : sync.upstream}
      </span>
      {sync.behind === 0 && sync.ahead === 0 && !noUpstream
        ? <span className={css.syncLevel}>{t('upToDate')}</span>
        : null}

      <span className={css.syncSpacer} />

      <button
        type="button" className={css.btn} disabled={running} data-quiet={quiet ? '' : undefined}
        onClick={() => onOp('fetch')}
      ><SyncGlyph of="fetch" />{busy === 'fetch' ? t('opRunning') : t('fetch')}</button>

      {/* The strategy is Pull's own argument, so it is welded to Pull. Loose
          between Fetch and Pull it read as a third peer action. */}
      <span className={css.pullGroup}>
        <SyncModePicker t={t} value={mode} disabled={running} quiet={quiet} onPick={setMode} />
        <button
          type="button"
          className={sync.behind > 0 ? `${css.btn} ${css.btnBehind}` : css.btn}
          disabled={running || noUpstream}
          // No upstream is a reason of Pull's own, so that dim stays put.
          data-quiet={quietlyDisabled(running, sustained, noUpstream) ? '' : undefined}
          title={noUpstream ? t('noUpstreamHint') : undefined}
          onClick={() => onOp('pull', { mode })}
        >
          <SyncGlyph of="pull" />
          {busy === 'pull' ? t('opRunning') : t('pull')}
          {sync.behind > 0 ? <span className={css.btnCount}>{sync.behind}</span> : null}
        </button>
      </span>

      <button
        type="button" className={pushClass} disabled={running} data-quiet={quiet ? '' : undefined}
        // The first push of a branch has no upstream yet — that is the case
        // `--set-upstream` exists for, so it must not be disabled here.
        title={noUpstream ? t('pushSetUpstream') : undefined}
        onClick={() => onOp('push')}
      >
        <SyncGlyph of="push" />
        {busy === 'push' ? t('opRunning') : noUpstream ? t('publish') : t('push')}
        {sync.ahead > 0 && !noUpstream ? <span className={css.btnCount}>{sync.ahead}</span> : null}
      </button>
    </div>
  )
}

/**
 * The commit box: a message, and what it would commit.
 *
 * Commit is disabled with nothing staged rather than quietly falling back to
 * committing the whole worktree. The drawer shows a staging area, and a button
 * that ignores it would make that display a lie.
 */
export function CommitBox({ t, files, busy, onOp, message, onMessage, amend, onAmend }: {
  t: Translate
  files: readonly GitFile[]
  busy: GitOpName | null
  onOp: (op: GitOpName, payload?: GitOpPayload) => Promise<GitOpResult>
  /** Lifted to the panel: this box unmounts on a tab switch, the draft must not. */
  message: string
  onMessage: (next: string) => void
  amend: boolean
  onAmend: (next: boolean) => void
}): ReactNode {
  const setMessage = onMessage
  const setAmend = onAmend
  const stagedCount = files.filter(file => file.staged === true).length
  const running = busy !== null
  // Amending re-uses the previous commit, so it is the one case where an empty
  // index is still a legitimate commit (a message-only reword).
  const needsStaged = stagedCount === 0 && !amend
  const needsMessage = message.trim().length === 0
  const canCommit = !needsMessage && !needsStaged && !running
  // A disabled button that does not say why reads as broken; the staging half of
  // that is stated permanently by the lead line above, so only the message case
  // needs the title.
  const blocked = needsMessage ? t('commitNeedMessage') : undefined

  const commit = (): void => {
    if (!canCommit) return
    void onOp('commit', { message, amend }).then(result => {
      // Keep the message on failure: it is the user's text, and retyping a
      // commit message because the index was empty is a bad way to learn that.
      if (result.ok) { setMessage(''); setAmend(false) }
    })
  }

  return (
    <div className={css.commitBox}>
      {/* The one instruction the tick model needs, stated once where the action
          lives. A blocker that appears only when the index is empty reads as an
          error and arrives after the confusion it explains. */}
      <p className={css.commitLead} data-gs-part="commit-lead">{t('commitLead')}</p>
      <textarea
        className={css.commitMessage}
        value={message}
        rows={2}
        placeholder={t('commitPlaceholder')}
        aria-label={t('commitPlaceholder')}
        disabled={running}
        onChange={event => setMessage(event.target.value)}
        onKeyDown={event => {
          // Ctrl/Cmd+Enter commits, the shortcut every git client shares. Plain
          // Enter stays a newline: a commit body is normal and losing it to a
          // stray keystroke is not recoverable from the UI.
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); commit() }
        }}
      />
      <div className={css.commitRow}>
        <label className={css.commitAmend}>
          <input
            type="checkbox" checked={amend} disabled={running}
            onChange={event => setAmend(event.target.checked)}
          />
          {t('amend')}
        </label>
        <span className={css.commitStaged}>{t('stagedCount', { count: stagedCount })}</span>
        <button
          type="button"
          className={css.commitBtn}
          disabled={!canCommit}
          title={running ? undefined : blocked}
          onClick={commit}
        >{busy === 'commit' ? t('opRunning') : t('commit')}</button>
      </div>
    </div>
  )
}

/**
 * A branch name, or the stand-in when there is none.
 *
 * This used to also cut the name to 21 characters and append an ellipsis, which
 * is how `feature/nested/deep/some-fix` reached the header as
 * `feature/nested/deep/s…` — the truncation was in JS, so it happened at the
 * same 21 characters whether the drawer was 400px or maximised, and it cut off
 * the only end that says which branch this is. Width is the stylesheet's
 * question; {@link Elided} answers it, from the correct end, only when there is
 * genuinely not enough room.
 *
 * @param branch - branch name, empty when the repo has none yet.
 * @param empty - already-translated stand-in for the empty case.
 */
export function branchLabel(branch: string, empty: string): string {
  return branch.length === 0 ? empty : branch
}
