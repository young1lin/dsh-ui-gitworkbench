/**
 * The diff pane's answer for a binary file: the picture, when it is one.
 *
 * "Binary file" was the pane's whole reply for anything git would not diff as
 * text, in every view — which for a repository's icons and screenshots is
 * true and useless, and the Files tab stopped saying it in 0.1.6. This is the
 * same preview wired to the three views that still said it: the working tree
 * (Changes), a commit (History) and a ref range (Compare). Where the bytes
 * live differs per view and per status — `image-source.ts` holds that table —
 * and the rendering is `ImageView`'s, unchanged, so the picture a reader sees
 * in History is the picture they would see in Files.
 *
 * The sentence survives for what is not a picture: the host's sniffer, not
 * the extension, decides, exactly as in the Files tab.
 *
 * @module @young1lin/dsh-ui-gitworkbench/client/BinaryFilePane
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react'

import css from './GitWorkbenchPanel.module.css'
import { ImageView, type Picture } from './ImageView.tsx'
import { decodeBase64, formatBytes } from './image-view.ts'
import { imageSourceKey, type ImageSource } from './image-source.ts'
import { IMAGE_BYTE_CAP } from '../image-sniff.ts'
import type { FileImage } from './git-workbench-types.ts'
import type { Translate } from './GitWorkbenchPanel.tsx'

export function BinaryFilePane({ t, statsPath, path, source, gen, fetchFileImage, fetchRevImage }: {
  t: Translate
  statsPath: string | undefined
  path: string
  /** Where this view keeps the file's bytes; null when it cannot say yet. */
  source: ImageSource | null
  /** The drawer's refresh generation: a refresh re-reads the bytes. */
  gen: number
  fetchFileImage: (worktreePath: string | undefined, path: string, signal: AbortSignal) => Promise<FileImage | null>
  fetchRevImage: (worktreePath: string | undefined, rev: string, path: string, signal: AbortSignal) => Promise<FileImage | null>
}): ReactNode {
  // Tagged with what was asked, so a slow answer for the previous file — or
  // the previous commit's copy of this one — never lands on screen as the
  // current one.
  const key = source === null ? null : `${path}\x1f${imageSourceKey(source)}\x1f${gen}`
  const [shot, setShot] = useState<{ key: string; answer: FileImage | null } | null>(null)

  useEffect(() => {
    if (key === null || source === null) return
    const ctrl = new AbortController()
    let alive = true
    const ask = source.kind === 'worktree'
      ? fetchFileImage(statsPath, path, ctrl.signal)
      : fetchRevImage(statsPath, source.rev, path, ctrl.signal)
    ask
      .then(answer => { if (alive) setShot({ key, answer }) })
      // A host half older than this client has no such method; the sentence
      // the pane always had then stands.
      .catch(() => { if (alive) setShot({ key, answer: null }) })
    return () => { alive = false; ctrl.abort() }
  }, [key, source, statsPath, path, fetchFileImage, fetchRevImage])

  const answer = shot !== null && shot.key === key ? shot.answer : null
  const asking = key !== null && (shot === null || shot.key !== key)
  /** Decoded once per answer: a decode is a pass over four megabytes at the cap. */
  const picture: Picture | null = useMemo(
    () => answer !== null && answer.ok
      ? { bytes: decodeBase64(answer.base64), mime: answer.mime, kind: answer.kind }
      : null,
    [answer],
  )

  if (picture !== null) return <ImageView picture={picture} path={path} t={t} />
  if (asking) return <div className={css.empty}>{t('loading')}</div>
  if (answer !== null && answer.reason === 'tooLarge') {
    return <div className={css.empty}>{t('imageTooLarge', { size: formatBytes(answer.bytes), cap: formatBytes(IMAGE_BYTE_CAP) })}</div>
  }
  return <div className={css.empty}>{t('binaryFile')}</div>
}
