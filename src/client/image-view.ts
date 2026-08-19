/**
 * The image preview's rules: when to ask the host for bytes, how to turn the
 * answer into something an `<img>` can point at, and how to caption it.
 *
 * The gate here is deliberately weaker than the host's. The host decides what
 * an image IS, by reading the signature; this only decides what is worth
 * ASKING about, and getting that wrong costs a wasted round trip rather than a
 * wrong render. So the extension is allowed to be the hint — in the one
 * direction where a hint cannot hurt.
 *
 * Pure: no React, no DOM beyond the base64 decoder every browser and every
 * supported node ship. `tests/image-view.test.ts` loads it directly.
 *
 * @module @young1lin/dsh-ui-gitworkbench/client/image-view
 */

/**
 * Extensions worth one round trip.
 *
 * Exactly the formats the host's sniffer admits, because a name the sniffer
 * would refuse anyway is a request with a known answer. Absent on purpose:
 * `.tif` and `.heic` are images that browsers will not draw, so asking would
 * end in "could not decode" where "binary file" is the more honest reply.
 */
const IMAGE_EXTS: ReadonlySet<string> = new Set([
  'png', 'jpg', 'jpeg', 'jpe', 'gif', 'webp', 'bmp', 'dib', 'ico', 'cur', 'avif', 'svg',
])

/** Does this path's name suggest an image? A hint, never a verdict. */
export function looksLikeImagePath(path: string): boolean {
  const name = (path.split('/').pop() ?? '').toLowerCase()
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return false
  return IMAGE_EXTS.has(name.slice(dot + 1))
}

/**
 * Should the view ask the host for image bytes, given what the text side said?
 *
 * Two different reasons, so two different rules:
 *
 *   - `binary` is asked about unconditionally. It is the case that matters —
 *     the text path has already given up, so the round trip either produces a
 *     picture or reproduces the same dead end. An extensionless PNG is found
 *     here and nowhere else.
 *   - `tooLarge` is asked about only when the NAME agrees, because the text
 *     guard cuts at a smaller size than the image cap and a large file that is
 *     not an image is usually a large file of text. Asking anyway would have
 *     the host read a multi-megabyte log to conclude what its name already
 *     said.
 */
export function shouldAskForImage(
  path: string,
  sides: { readonly binary: boolean; readonly tooLarge: boolean },
): boolean {
  if (sides.binary) return true
  return sides.tooLarge && looksLikeImagePath(path)
}

/** base64 to bytes, for the Blob the `<img>` points at. */
export function decodeBase64(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  // Backed by an explicit ArrayBuffer rather than the default: a Blob part
  // must not be a view over a SharedArrayBuffer, and the default type is the
  // union of both.
  const out = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i)
  return out
}

/**
 * A byte count as a reader reads it.
 *
 * 1024-based with KB/MB labels — the convention every editor and browser
 * devtools uses, so the number agrees with the one the reader would see
 * anywhere else for the same file.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`
  const mb = kb / 1024
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`
}

/**
 * The line under the picture: what it is, how big it is on screen, how big it
 * is on disk.
 *
 * Dimensions are omitted rather than guessed when the browser reports none —
 * an SVG with no intrinsic size is the ordinary case, and `0 × 0` under a
 * picture that is plainly there reads as a bug.
 */
export function imageCaption(
  kind: string,
  bytes: number,
  size: { readonly width: number; readonly height: number } | null,
): string {
  const parts: string[] = []
  if (kind.length > 0) parts.push(kind)
  if (size !== null && size.width > 0 && size.height > 0) parts.push(`${size.width} × ${size.height}`)
  const weight = formatBytes(bytes)
  if (weight.length > 0) parts.push(weight)
  return parts.join(' · ')
}
