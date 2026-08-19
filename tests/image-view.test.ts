import { describe, expect, it } from 'vitest'

import {
  decodeBase64, formatBytes, imageCaption, looksLikeImagePath, shouldAskForImage,
} from '../src/client/image-view.ts'

describe('looksLikeImagePath', () => {
  it('recognises the names the host sniffer would accept', () => {
    for (const name of ['a.png', 'a.jpg', 'a.jpeg', 'a.gif', 'a.webp', 'a.bmp', 'a.ico', 'a.avif', 'a.svg']) {
      expect(looksLikeImagePath(name), name).toBe(true)
    }
  })

  it('is case-insensitive and reads only the last segment', () => {
    expect(looksLikeImagePath('docs/Screenshot.PNG')).toBe(true)
    // A directory called `png` must not make every file inside it an image.
    expect(looksLikeImagePath('png/notes.md')).toBe(false)
  })

  it('says no to formats a browser will not draw', () => {
    // Asking would end in "could not decode", where "binary file" is the more
    // honest answer.
    expect(looksLikeImagePath('scan.tif')).toBe(false)
    expect(looksLikeImagePath('photo.heic')).toBe(false)
    expect(looksLikeImagePath('clip.mp4')).toBe(false)
  })

  it('says no to a source file that happens to hold svg markup', () => {
    // Load-bearing for the SVG preview, which sniffs text the editor already
    // has. Sweeping 125k real files found 148 .svelte components that begin
    // with a literal <svg> element — markup ABOUT an icon, opened to read the
    // code. The signature alone cannot tell those apart; the name can.
    expect(looksLikeImagePath('icons/Camera.svelte')).toBe(false)
    expect(looksLikeImagePath('icons/Camera.vue')).toBe(false)
    expect(looksLikeImagePath('icons/Camera.tsx')).toBe(false)
    expect(looksLikeImagePath('page.html')).toBe(false)
  })

  it('says no to a name with no extension at all', () => {
    expect(looksLikeImagePath('Makefile')).toBe(false)
    expect(looksLikeImagePath('.gitignore')).toBe(false)
    expect(looksLikeImagePath('')).toBe(false)
  })
})

describe('shouldAskForImage', () => {
  const sides = (over: Partial<{ binary: boolean; tooLarge: boolean }> = {}) => ({
    binary: false, tooLarge: false, ...over,
  })

  it('always asks about a binary file, whatever it is called', () => {
    // The text path has already given up, so the round trip either produces a
    // picture or reproduces the same dead end — and an extensionless PNG is
    // found here and nowhere else.
    expect(shouldAskForImage('assets/logo.png', sides({ binary: true }))).toBe(true)
    expect(shouldAskForImage('assets/logo', sides({ binary: true }))).toBe(true)
    expect(shouldAskForImage('build/app.wasm', sides({ binary: true }))).toBe(true)
  })

  it('asks about an oversized file only when the name agrees', () => {
    // The text guard cuts smaller than the image cap, so a big picture arrives
    // here as tooLarge rather than binary — but a big file that is NOT an
    // image is usually a big file of text, and reading it would cost megabytes
    // to conclude what its name already said.
    expect(shouldAskForImage('docs/hero.png', sides({ tooLarge: true }))).toBe(true)
    expect(shouldAskForImage('logs/run.json', sides({ tooLarge: true }))).toBe(false)
  })

  it('never asks about a file the text side can show', () => {
    expect(shouldAskForImage('src/a.ts', sides())).toBe(false)
    // Even one that is named like an image: if it reads as text, it IS text,
    // and showing the reader its source is the useful answer.
    expect(shouldAskForImage('icons/arrow.svg', sides())).toBe(false)
  })
})

describe('decodeBase64', () => {
  it('round-trips the bytes a PNG signature is made of', () => {
    const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const encoded = Buffer.from(signature).toString('base64')
    expect([...decodeBase64(encoded)]).toEqual([...signature])
  })

  it('handles the empty payload and the high byte', () => {
    expect(decodeBase64('').length).toBe(0)
    expect([...decodeBase64(Buffer.from([0xff, 0x00, 0x80]).toString('base64'))]).toEqual([0xff, 0x00, 0x80])
  })
})

describe('formatBytes', () => {
  it('uses the unit a reader would see anywhere else for the same file', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(251_904)).toBe('246 KB')
    expect(formatBytes(1_572_864)).toBe('1.5 MB')
    expect(formatBytes(12 * 1024 * 1024)).toBe('12 MB')
  })

  it('answers empty for a number that is not a size', () => {
    expect(formatBytes(-1)).toBe('')
    expect(formatBytes(Number.NaN)).toBe('')
  })
})

describe('imageCaption', () => {
  it('reads as one line of facts', () => {
    expect(imageCaption('PNG', 251_904, { width: 1920, height: 1080 })).toBe('PNG · 1920 × 1080 · 246 KB')
  })

  it('omits dimensions the browser did not report', () => {
    // An SVG with no intrinsic size is the ordinary case, and `0 × 0` under a
    // picture that is plainly there reads as a bug.
    expect(imageCaption('SVG', 1024, null)).toBe('SVG · 1.0 KB')
    expect(imageCaption('SVG', 1024, { width: 0, height: 0 })).toBe('SVG · 1.0 KB')
  })

  it('drops a part it has nothing for rather than leaving a gap', () => {
    expect(imageCaption('', 1024, null)).toBe('1.0 KB')
    expect(imageCaption('PNG', -1, null)).toBe('PNG')
  })
})
