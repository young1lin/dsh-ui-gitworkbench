/**
 * The picture, once the host has confirmed the bytes are one.
 *
 * Rendering goes through `<img>` pointed at a blob URL, and that choice is
 * doing two jobs at once.
 *
 * It is the SAFETY boundary. The HTML specification defines the document
 * inside an `<img>` as a non-scripted context: script elements do not run,
 * event-handler attributes do not fire, external references do not load. That
 * is what lets an SVG — which is an XML document and can contain all three —
 * be shown here without a sanitiser standing in front of it. Inlining the same
 * markup into the page would give up every one of those guarantees, so it is
 * never done, however convenient it would be for styling.
 *
 * It is also the second half of the VERIFICATION. The host's signature check
 * says the bytes claim to be a PNG; the browser's decoder is the only thing
 * that can say they really are one. A file that passes the first gate and
 * fails the second lands on `onError`, and the view says so plainly rather
 * than leaving an empty frame that reads as a slow load.
 *
 * A blob URL rather than a `data:` URI because the DOM then holds a short
 * string instead of a megabytes-long attribute — and because a blob URL can be
 * revoked, which is what keeps switching between fifty screenshots from
 * retaining all fifty.
 *
 * @module @young1lin/dsh-ui-gitworkbench/client/ImageView
 */

import { useEffect, useState, type ReactNode } from 'react'

import css from './GitWorkbenchPanel.module.css'
import { imageCaption } from './image-view.ts'
import type { Translate } from './GitWorkbenchPanel.tsx'

/** A verified picture, from wherever its bytes came from: the host's own read
 *  for a binary file, or the text already in hand for an SVG. */
export interface Picture {
  readonly bytes: Uint8Array<ArrayBuffer>
  /** MIME type to label the blob with. */
  readonly mime: string
  /** Short label for the caption — 'PNG', 'SVG'. */
  readonly kind: string
}

/** What the browser measured once it had decoded the file. */
interface Natural {
  readonly width: number
  readonly height: number
}

export function ImageView({ picture, path, t }: {
  picture: Picture
  /** Repo-relative path, used as the alt text: a screen reader hearing the
   *  file's own name is told more than it would be by "image". */
  path: string
  t: Translate
}): ReactNode {
  const [url, setUrl] = useState<string | null>(null)
  const [natural, setNatural] = useState<Natural | null>(null)
  /** The browser refused the bytes the host accepted. */
  const [broken, setBroken] = useState(false)
  /** Showing pixel-for-pixel rather than scaled down to fit the pane. */
  const [actual, setActual] = useState(false)

  const { bytes, mime } = picture
  useEffect(() => {
    setNatural(null)
    setBroken(false)
    setActual(false)
    let made: string | null = null
    try {
      made = URL.createObjectURL(new Blob([bytes], { type: mime }))
    } catch {
      // Nothing to point at, so the frame below says so instead of hanging
      // on a load event that will never fire.
      setBroken(true)
    }
    setUrl(made)
    // Revoked on the way out, not merely dropped: an unrevoked blob URL pins
    // its bytes for the lifetime of the document, so browsing a directory of
    // screenshots would retain every one of them.
    return () => { if (made !== null) URL.revokeObjectURL(made) }
  }, [bytes, mime])

  if (broken || url === null) {
    return <div className={css.empty}>{t('imageBroken')}</div>
  }
  return (
    <div className={css.imgPane}>
      <div className={css.imgStage} data-actual={actual ? '' : undefined}>
        <img
          className={css.imgShot}
          src={url}
          alt={path}
          onLoad={event => {
            setNatural({
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight,
            })
          }}
          onError={() => { setBroken(true) }}
        />
      </div>
      <div className={css.imgCaption}>
        <span>{imageCaption(picture.kind, picture.bytes.length, natural)}</span>
        {/* Offered only when the two views would differ. A toggle that does
            nothing visible is a toggle the reader presses twice and then
            distrusts. */}
        {natural !== null && natural.width > 0 ? (
          <button
            type="button"
            className={css.blockBtn}
            aria-pressed={actual}
            onClick={() => { setActual(on => !on) }}
          >{t(actual ? 'imageFit' : 'imageActual')}</button>
        ) : null}
      </div>
    </div>
  )
}
