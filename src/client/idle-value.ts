/**
 * A value that lags its source until the source stops changing.
 *
 * Syntax highlighting is the reason this exists. Recomputing it per keystroke
 * costs 42ms on a thousand-line file and scales linearly, so a fast typist
 * spends the whole session behind the main thread. CodeMirror maps its
 * existing decorations through document changes, so the colours already ride
 * along with the text while this waits — the repaint only has to be prompt
 * enough that the reader never notices the last few characters were plain.
 *
 * Not a pure function, so no unit test: it is six lines of standard React and
 * its behaviour is a timer. The rules it implements are stated above.
 *
 * @module @young1lin/dsh-ui-gitworkbench/client/idle-value
 */

import { useEffect, useState } from 'react'

/**
 * @param value - the live value.
 * @param ms - how long the value must hold still before it is adopted.
 * @returns the last value that stayed put for `ms`.
 */
export function useIdleValue<T>(value: T, ms: number): T {
  const [held, setHeld] = useState(value)
  useEffect(() => {
    if (Object.is(held, value)) return
    const timer = setTimeout(() => { setHeld(value) }, ms)
    return () => { clearTimeout(timer) }
  }, [value, ms, held])
  return held
}

/** How long typing must pause before the highlight is recomputed. Long enough
 *  that a burst of typing costs one repaint, short enough that the pause after
 *  a word is already over by the time the eye gets back to the line. */
export const HIGHLIGHT_IDLE_MS = 180

/**
 * Lines past which a file is shown uncoloured.
 *
 * Shiki costs about 0.3ms a line, and that is the whole-file pass alone — the
 * floor, not an implementation detail we can tune away. Measured: 155ms at 500
 * lines, 620ms at 2000, 1537ms at 5000. Debouncing keeps a burst of typing to
 * one repaint, but it cannot make one repaint cheap, and a 1.5-second freeze
 * every time the reader pauses is worse than plain text.
 *
 * So above this the file renders without colour and says so. The honest fix is
 * to highlight only the viewport, which needs the tokens to be computed where
 * the scroll position is known rather than in the pane; this cap is what holds
 * until then.
 */
export const HIGHLIGHT_LINE_CAP = 2_000
