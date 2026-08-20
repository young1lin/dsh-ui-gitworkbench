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
