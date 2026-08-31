/**
 * Making the carriage return visible in diff views.
 *
 * A diff line's text carries the CR byte through verbatim (`fileSides` serves
 * git's own bytes), and a browser draws nothing for it: two cells whose only
 * difference is a line ending render as byte-identical text, so a whole-file
 * CRLF rewrite reads as a wall of changed lines with no visible change in
 * any of them. The fix is not to strip the CR — the byte must survive into
 * every patch the block actions emit — but to draw a glyph at each CR while
 * RENDERING, the way `git diff` spells it as `^M`.
 *
 * The glyph is U+240D (SYMBOL FOR CARRIAGE RETURN), the standard picture of
 * the control character, so a marked line reads as "ends in CR" rather than
 * as a stray character in the code.
 *
 * Pure: no React, no CSS, no git. `tests/cr-mark.test.ts` loads it directly.
 *
 * @module @young1lin/dsh-ui-gitworkbench/cr-mark
 */

/** Built rather than escaped so this source file survives any tool that
 * normalises text-mode line endings on its way to disk. */
export const CR = String.fromCharCode(13)

/** What a carriage return is drawn as. */
export const CR_GLYPH = '\u240d'

/**
 * Split text at every carriage return, so a renderer can interleave one
 * {@link CR_GLYPH} span between consecutive parts.
 *
 * @param text - one cell's text, as the diff model carries it.
 * @returns the parts between CRs; a text with no CR comes back as itself in
 *          one piece (length 1), which is the caller's cheap early-out.
 */
export function splitOnCr(text: string): readonly string[] {
  if (!text.includes(CR)) return [text]
  return text.split(CR)
}
