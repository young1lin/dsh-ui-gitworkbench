import { describe, expect, it } from 'vitest'
import { finalNewlineChange, inlineBlockAt, originalFromPatch } from '../src/client/inline-diff.ts'

describe('patch basis and saved hunk coordinates', () => {
  it('distinguishes a genuine missing final newline from CRLF-only differences', () => {
    expect(finalNewlineChange('</mapper>\n', '</mapper>')).toBe('finalNewlineRemoved')
    expect(finalNewlineChange('</mapper>', '</mapper>\r\n')).toBe('finalNewlineAdded')
    expect(finalNewlineChange('</mapper>\n', '</mapper>\r\n')).toBeNull()
  })
  it('retains the old side final-newline contract and unchanged files', () => {
    const patch = 'diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n'
    expect(originalFromPatch(patch, 'new\n')).toBe('old')
    expect(originalFromPatch(patch.replace('-old\n\\ No newline at end of file\n', '-old\n'), 'new\n')).toBe('old\n')
    expect(originalFromPatch('', 'unchanged\n')).toBe('unchanged\n')
  })
  it('maps a caret to saved hunk starts, including a deletion at the first line', () => {
    expect(inlineBlockAt([], 5)).toBeNull()
    expect(inlineBlockAt([1, 12, 50], 0)).toBe(0)
    expect(inlineBlockAt([1, 12, 50], 13)).toBe(1)
    expect(inlineBlockAt([1, 12, 50], 999)).toBe(2)
  })
})
