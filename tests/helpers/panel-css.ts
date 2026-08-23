import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const LOCAL_IMPORT = /^\s*@import\s+(['"])(\.{1,2}\/[^'"]+)\1\s*;\s*$/gm

export const PANEL_CSS_ENTRY = fileURLToPath(new URL('../../src/client/GitWorkbenchPanel.module.css', import.meta.url))

/** Read the logical CSS Module exactly as the client build does: local source
 * modules are concatenated before CSS Modules hashes any class names. */
export function readPanelCss(): { readonly source: string; readonly files: readonly string[] } {
  const files: string[] = []
  const inline = (file: string, stack: Set<string>): string => {
    if (stack.has(file)) throw new Error(`circular CSS import: ${[...stack, file].join(' -> ')}`)
    stack.add(file)
    files.push(file)
    try {
      const source = readFileSync(file, 'utf8')
      let output = ''
      let cursor = 0
      for (const match of source.matchAll(LOCAL_IMPORT)) {
        const start = match.index ?? 0
        output += source.slice(cursor, start)
        output += inline(resolve(dirname(file), match[2]!), stack)
        cursor = start + match[0].length
      }
      return output + source.slice(cursor)
    } finally {
      stack.delete(file)
    }
  }
  return { source: inline(PANEL_CSS_ENTRY, new Set()), files }
}

export function panelCssSource(): string {
  return readPanelCss().source
}
