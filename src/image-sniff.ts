/**
 * Is this file actually an image, and which kind?
 *
 * The extension is a hint, never the answer: `.png` is a filename, not a
 * format, and a repository full of generated assets has mislabelled files in
 * it. So the bytes decide — every format below is identified by the signature
 * its own specification mandates in the first few bytes.
 *
 * The obvious alternative is the `file-type` package, which is the mature
 * packaging of exactly this idea. It is not used here for three reasons: it
 * is four transitive dependencies in a package that is published to npm, it
 * identifies two hundred types where this needs eight, and — the deciding one
 * — it could not make the render any safer than it already is. Sniffing is
 * the FIRST of two gates; the second is the browser's own image decoder, and
 * that one is authoritative in a way no table can be. If the trade ever turns,
 * `sniffImage` is the only function to replace.
 *
 * Membership in the table is decided by one rule: browsers render it in an
 * `<img>` element. That is why TIFF and HEIC are absent — recognising them
 * would only let the view promise a picture it cannot draw, and "binary file"
 * is the more honest answer for a format the reader's browser will refuse.
 *
 * SVG is the one member with no magic number, because it is XML rather than a
 * container. It is admitted anyway: rendering happens through `<img>`, which
 * the HTML specification defines as a non-scripted context — script elements,
 * event handlers and external references inside the document do not run and do
 * not load. That property, not a sanitiser, is what makes it safe.
 *
 * Pure: no node, no fs, no git. `tests/image-sniff.test.ts` loads it directly.
 *
 * @module @young1lin/dsh-ui-gitworkbench/image-sniff
 */

/** A file the sniffer recognised. */
export interface SniffedImage {
  /** MIME type, as the `<img>` blob should be labelled. */
  readonly mime: string
  /** Short human label for the caption: 'PNG', 'WebP', … */
  readonly kind: string
}

/**
 * Largest image handed to the browser, in bytes.
 *
 * This is a WIRE budget, not a rendering one. The bytes cross the RPC channel
 * base64-encoded, which costs a third again on top, so a cap of four megabytes
 * is a payload of five and a third — already the largest single message the
 * drawer sends. Screenshots and icons, which is what repositories actually
 * hold, sit two orders of magnitude below it.
 */
export const IMAGE_BYTE_CAP = 4_000_000

/** How many leading bytes any signature below needs. */
const SNIFF_BYTES = 64

/** How much of a text file is read looking for an SVG root element.
 *
 *  Larger than any magic number needs because the prologue in front of that
 *  root is unbounded in principle: an XML declaration, a DOCTYPE with an
 *  internal subset of declarations, and any number of comments all come
 *  first, and real files use all three. */
const SVG_PROLOGUE_BYTES = 4096

/** Do `bytes` begin with these byte values at `at`? */
function at(bytes: Uint8Array, offset: number, signature: readonly number[]): boolean {
  if (bytes.length < offset + signature.length) return false
  for (let i = 0; i < signature.length; i += 1) {
    if (bytes[offset + i] !== signature[i]) return false
  }
  return true
}

/** The bytes of an ASCII marker, so the tables read as the specs write them. */
function ascii(text: string): readonly number[] {
  return [...text].map(ch => ch.charCodeAt(0))
}

/** Little-endian uint32 at `offset`, or -1 when the buffer is too short. */
function u32le(bytes: Uint8Array, offset: number): number {
  if (bytes.length < offset + 4) return -1
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0
}

/** DIB header sizes BMP has ever defined. A `BM` prefix alone is two bytes of
 *  evidence, which any text beginning "BM" would satisfy; the header size is
 *  what makes the match a bitmap. */
const BMP_HEADERS: readonly number[] = [12, 16, 40, 52, 56, 64, 108, 124]

/** ISO base-media brands that carry a still image a browser will draw. */
const AVIF_BRANDS: readonly string[] = ['avif', 'avis']

/**
 * Identify one file from its leading bytes.
 *
 * @param bytes - the file's content, or at least its first {@link SNIFF_BYTES}.
 * @returns what it is, or null for anything not in the table.
 */
export function sniffImage(bytes: Uint8Array): SniffedImage | null {
  if (bytes.length === 0) return null

  // PNG: the eight-byte signature from the specification, chosen there
  // precisely so that no other format collides with it.
  if (at(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { mime: 'image/png', kind: 'PNG' }
  }
  // JPEG: SOI marker, then the first marker of the next segment.
  if (at(bytes, 0, [0xff, 0xd8, 0xff])) {
    return { mime: 'image/jpeg', kind: 'JPEG' }
  }
  if (at(bytes, 0, ascii('GIF87a')) || at(bytes, 0, ascii('GIF89a'))) {
    return { mime: 'image/gif', kind: 'GIF' }
  }
  // WebP is a RIFF container; the four bytes after the length field are what
  // separate it from a WAV or an AVI.
  if (at(bytes, 0, ascii('RIFF')) && at(bytes, 8, ascii('WEBP'))) {
    return { mime: 'image/webp', kind: 'WebP' }
  }
  // ISO base media: `ftyp` box, then the brand. Also matches HEIC and MP4,
  // which is why only the still-image AVIF brands are admitted.
  if (at(bytes, 4, ascii('ftyp')) && AVIF_BRANDS.some(brand => at(bytes, 8, ascii(brand)))) {
    return { mime: 'image/avif', kind: 'AVIF' }
  }
  if (at(bytes, 0, ascii('BM')) && BMP_HEADERS.includes(u32le(bytes, 14))) {
    return { mime: 'image/bmp', kind: 'BMP' }
  }
  // ICO: reserved zero, type 1 (icon) or 2 (cursor), then a non-zero count of
  // images. The count is the check that a run of zero bytes cannot pass.
  if (at(bytes, 0, [0x00, 0x00, 0x01, 0x00]) && (bytes[4] | (bytes[5] << 8)) > 0) {
    return { mime: 'image/x-icon', kind: 'ICO' }
  }
  if (looksLikeSvg(bytes)) {
    return { mime: 'image/svg+xml', kind: 'SVG' }
  }
  return null
}

/**
 * Does this text begin an SVG document?
 *
 * Structural rather than a substring search: the prologue XML allows before a
 * root element is skipped, and then the root element itself must be `svg`. A
 * file that merely CONTAINS `<svg` somewhere — an HTML page with an inline
 * icon, a TypeScript file with a template literal — is not one.
 */
function looksLikeSvg(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, SVG_PROLOGUE_BYTES)
  // A NUL rules out text before any parsing: the same test the diff side uses
  // to call a file binary.
  if (head.includes(0)) return false
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(head)
  } catch {
    // A truncated multi-byte character at the cut is not a decode failure of
    // the FILE, so retry lenient; a genuinely non-UTF-8 file yields U+FFFD,
    // which no prologue below accepts.
    text = new TextDecoder('utf-8').decode(head)
  }
  // Strip a byte-order mark, which is legal before an XML declaration.
  let rest = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  for (;;) {
    rest = rest.replace(/^\s+/, '')
    if (rest.startsWith('<?')) {
      const end = rest.indexOf('?>')
      // Prologue cut off by the sniff window: undecidable, so not an image.
      if (end === -1) return false
      rest = rest.slice(end + 2)
      continue
    }
    if (rest.startsWith('<!--')) {
      const end = rest.indexOf('-->')
      if (end === -1) return false
      rest = rest.slice(end + 3)
      continue
    }
    if (rest.startsWith('<!')) {
      // A DOCTYPE may carry an internal subset in brackets, and the
      // declarations inside it end with '>' characters of their own —
      // scanning to the first one lands in the middle of the subset and the
      // root element is never reached. Real files do this: matplotlib ships
      // an SVG whose DOCTYPE declares an ATTLIST, and it was the one file in
      // a hundred and twenty-five thousand that this missed.
      const bracket = rest.indexOf('[')
      const end = rest.indexOf('>')
      if (end === -1) return false
      if (bracket === -1 || bracket > end) {
        rest = rest.slice(end + 1)
        continue
      }
      const closed = rest.indexOf(']', bracket)
      if (closed === -1) return false
      const after = rest.indexOf('>', closed)
      if (after === -1) return false
      rest = rest.slice(after + 1)
      continue
    }
    break
  }
  // The root element, and only `svg`: the character after the name must end
  // it, so `<svgfoo>` is not a match.
  if (!rest.startsWith('<svg')) return false
  const after = rest.charAt(4)
  return after === '' || after === '>' || after === '/' || /\s/.test(after)
}
