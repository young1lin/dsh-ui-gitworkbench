/**
 * Per-project and global drawer styling: a background image and custom CSS.
 *
 * These live on the host rather than in the browser for two reasons. A project
 * setting belongs to the project, so it must survive a different browser or a
 * cleared origin; and a background image is far larger than a localStorage
 * origin quota is willing to hold.
 *
 * The file is a durable boundary: everything read back is validated here, and
 * anything unrecognized is dropped rather than propagated. The image in
 * particular is interpolated into a CSS `url()` by the client, so it is held to
 * a base64 `data:` URL with no character that could close the function and
 * continue the stylesheet.
 */
import { join } from 'node:path'

/** One scope's styling. Absent fields are impossible: every entry is complete. */
export interface StyleEntry {
  /** Custom CSS injected into the page verbatim; empty for none. */
  readonly css: string
  /** Background image as a base64 `data:` URL; empty for none. */
  readonly image: string
  /** Background blur radius in px. */
  readonly blur: number
  /** How much of the palette's own surface colour covers the image, in percent. */
  readonly veil: number
}

export interface StyleFile {
  readonly v: 1
  readonly global: StyleEntry
  /** Keyed by repository root, forward-slashed. */
  readonly projects: Record<string, StyleEntry>
}

/** No image, no CSS, and the defaults the sliders open on. */
export const DEFAULT_STYLE: StyleEntry = { css: '', image: '', blur: 18, veil: 78 }

/** Largest accepted image data URL. A 2560px JPEG lands far below this; the cap
 *  exists so a hand-edited file cannot make every drawer open drag megabytes. */
export const STYLE_IMAGE_MAX = 3_000_000

/** Largest accepted custom stylesheet. */
export const STYLE_CSS_MAX = 200_000

/** Largest accepted blur radius, in px. */
export const STYLE_BLUR_MAX = 60

/**
 * Images this plugin will render.
 *
 * Deliberately narrow: the client interpolates the value into `url("…")`, and a
 * base64 alphabet cannot contain a quote, a parenthesis, a backslash or a
 * semicolon, so a stored value can never close the function and append rules of
 * its own. It is also exactly what a canvas `toDataURL` produces, so nothing a
 * user can select through the picker is rejected.
 */
const IMAGE_PATTERN = /^data:image\/(?:png|jpeg|webp|gif|avif);base64,[A-Za-z0-9+/]+={0,2}$/

/**
 * @param home - the user's home directory.
 * @returns the style file's path, forward-slashed.
 */
export function stylePath(home: string): string {
  return join(home, '.dsh', 'gitworkbench-style.json').replace(/\\/g, '/')
}

/**
 * @param value - a number from a file or an RPC argument.
 * @param min - lower bound.
 * @param max - upper bound.
 * @param fallback - used when the value is not a finite number.
 * @returns the value clamped into range.
 */
function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(value, min), max)
}

/**
 * Narrow an arbitrary value to a complete, in-range style entry.
 * @param value - parsed JSON or an RPC argument.
 * @returns a valid entry; every rejected field falls back to its default.
 */
export function sanitizeEntry(value: unknown): StyleEntry {
  if (typeof value !== 'object' || value === null) return DEFAULT_STYLE
  const record = value as Record<string, unknown>
  const css = typeof record['css'] === 'string' && record['css'].length <= STYLE_CSS_MAX ? record['css'] : ''
  const raw = record['image']
  const image = typeof raw === 'string' && raw.length <= STYLE_IMAGE_MAX && IMAGE_PATTERN.test(raw) ? raw : ''
  return {
    css,
    image,
    blur: clampNumber(record['blur'], 0, STYLE_BLUR_MAX, DEFAULT_STYLE.blur),
    veil: clampNumber(record['veil'], 0, 100, DEFAULT_STYLE.veil),
  }
}

/**
 * @returns a style file with nothing configured.
 */
export function emptyStyleFile(): StyleFile {
  return { v: 1, global: DEFAULT_STYLE, projects: {} }
}

/**
 * @param entry - a style entry.
 * @returns whether it configures anything at all; an entry that does not is not
 *   worth storing, and storing it would shadow the global scope with nothing.
 */
export function isBlankEntry(entry: StyleEntry): boolean {
  return entry.css.length === 0 && entry.image.length === 0
}

/**
 * Parse the style file, dropping anything malformed.
 * @param raw - the file's text.
 * @returns a valid style file; a corrupt one reads as empty rather than failing.
 */
export function parseStyle(raw: string): StyleFile {
  try {
    const parsed = JSON.parse(raw) as { v?: unknown; global?: unknown; projects?: unknown }
    if (parsed?.v !== 1) return emptyStyleFile()
    const projects: Record<string, StyleEntry> = {}
    if (typeof parsed.projects === 'object' && parsed.projects !== null) {
      for (const [root, entry] of Object.entries(parsed.projects as Record<string, unknown>)) {
        if (root.length > 0) projects[root] = sanitizeEntry(entry)
      }
    }
    return { v: 1, global: sanitizeEntry(parsed.global), projects }
  } catch {
    // A half-written or hand-edited file must not take the drawer down with it.
    return emptyStyleFile()
  }
}

/**
 * @param readText - reads a file's text.
 * @param path - the style file's path.
 * @returns the stored styles, or an empty file when absent or unreadable.
 */
export async function loadStyle(readText: (path: string) => Promise<string>, path: string): Promise<StyleFile> {
  try { return parseStyle(await readText(path)) } catch { return emptyStyleFile() }
}
