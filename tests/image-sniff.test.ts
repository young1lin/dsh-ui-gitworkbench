import { describe, expect, it } from 'vitest'

import { IMAGE_BYTE_CAP, sniffImage } from '../src/image-sniff.ts'

/** Bytes from a mix of numbers and ASCII runs, the way the specs write them. */
const bytes = (...parts: readonly (number | string)[]): Uint8Array => {
  const out: number[] = []
  for (const part of parts) {
    if (typeof part === 'number') out.push(part)
    else for (const ch of part) out.push(ch.charCodeAt(0))
  }
  return new Uint8Array(out)
}

const text = (value: string): Uint8Array => new TextEncoder().encode(value)

/** A little-endian uint32, for the header-size fields the tables check. */
const u32 = (n: number): readonly number[] => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]

const PNG = bytes(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a, 'IHDR')
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 'JFIF')
const BMP = bytes('BM', ...u32(70), ...u32(0), ...u32(54), ...u32(40))

describe('sniffImage', () => {
  it('recognises the formats a browser can draw', () => {
    expect(sniffImage(PNG)).toEqual({ mime: 'image/png', kind: 'PNG' })
    expect(sniffImage(JPEG)).toEqual({ mime: 'image/jpeg', kind: 'JPEG' })
    expect(sniffImage(bytes('GIF89a', 0x01, 0x00))).toEqual({ mime: 'image/gif', kind: 'GIF' })
    expect(sniffImage(bytes('GIF87a', 0x01, 0x00))?.kind).toBe('GIF')
    expect(sniffImage(bytes('RIFF', ...u32(100), 'WEBPVP8 '))).toEqual({ mime: 'image/webp', kind: 'WebP' })
    expect(sniffImage(bytes(...u32(32), 'ftypavif', 'avifmif1'))).toEqual({ mime: 'image/avif', kind: 'AVIF' })
    expect(sniffImage(BMP)).toEqual({ mime: 'image/bmp', kind: 'BMP' })
    expect(sniffImage(bytes(0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x10, 0x10))).toEqual({ mime: 'image/x-icon', kind: 'ICO' })
  })

  it('answers null for anything not in the table', () => {
    // The membership rule is "a browser draws it in an <img>". TIFF and HEIC
    // are real image formats and still belong here: recognising them would
    // only let the view promise a picture it cannot draw.
    expect(sniffImage(bytes(0x49, 0x49, 0x2a, 0x00))).toBeNull()
    expect(sniffImage(bytes(...u32(32), 'ftypheic', 'heicmif1'))).toBeNull()
    expect(sniffImage(text('#!/bin/sh\necho hello\n'))).toBeNull()
    expect(sniffImage(new Uint8Array(0))).toBeNull()
  })

  it('does not take a two-byte coincidence for a bitmap', () => {
    // 'BM' is two bytes of evidence, which any text beginning with those
    // letters satisfies. The DIB header size is what makes the match.
    expect(sniffImage(text('BMW parts list\n'))).toBeNull()
    expect(sniffImage(bytes('BM', ...u32(70), ...u32(0), ...u32(54), ...u32(41)))).toBeNull()
  })

  it('does not take another RIFF container for a WebP', () => {
    expect(sniffImage(bytes('RIFF', ...u32(100), 'WAVEfmt '))).toBeNull()
    expect(sniffImage(bytes('RIFF', ...u32(100), 'AVI LIST'))).toBeNull()
  })

  it('does not take a video for a still image', () => {
    // `ftyp` alone matches MP4 and HEIC too, so only the AVIF still brands
    // are admitted.
    expect(sniffImage(bytes(...u32(32), 'ftypisom', 'isomiso2'))).toBeNull()
    expect(sniffImage(bytes(...u32(32), 'ftypmp42', 'mp42avc1'))).toBeNull()
    expect(sniffImage(bytes(...u32(32), 'ftypavis', 'avisavif'))?.kind).toBe('AVIF')
  })

  it('does not take a run of zeroes for an icon', () => {
    // The image count is the field a zero-filled block cannot satisfy.
    expect(sniffImage(new Uint8Array(32))).toBeNull()
    expect(sniffImage(bytes(0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x10, 0x10))).toBeNull()
  })

  it('recognises SVG through the prologue XML allows', () => {
    expect(sniffImage(text('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))?.kind).toBe('SVG')
    expect(sniffImage(text('<svg/>'))?.kind).toBe('SVG')
    expect(sniffImage(text('\n  <svg viewBox="0 0 8 8"/>'))?.kind).toBe('SVG')
    expect(sniffImage(text('<?xml version="1.0"?>\n<svg/>'))?.kind).toBe('SVG')
    expect(sniffImage(text('<!-- a note --><svg/>'))?.kind).toBe('SVG')
    expect(sniffImage(text('<?xml version="1.0"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd"><svg/>'))?.kind).toBe('SVG')
    expect(sniffImage(text('﻿<svg/>'))?.kind).toBe('SVG')
    expect(sniffImage(text('<svg/>')).mime).toBe('image/svg+xml')
  })

  it('walks past a DOCTYPE that carries an internal subset', () => {
    // Found by sweeping 125k real files: matplotlib ships this shape, and it
    // was the only miss. The declarations between the brackets end with '>'
    // characters of their own, so scanning to the first one stops inside the
    // subset and never reaches the root element.
    const real = [
      '<?xml version="1.0" standalone="no"?>',
      '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 20010904//EN"',
      '"http://www.w3.org/TR/2001/REC-SVG-20010904/DTD/svg10.dtd"',
      '[',
      ' <!ATTLIST svg',
      '  xmlns:xlink CDATA #FIXED "http://www.w3.org/1999/xlink">',
      ']>',
      '<!-- Created with Sodipodi -->',
      '<svg xml:space="preserve" width="128pt" height="128pt">',
    ].join(String.fromCharCode(10))
    expect(sniffImage(text(real))?.kind).toBe('SVG')
  })

  it('does not take a file that merely contains an svg tag for one', () => {
    // A substring search would call every one of these an image, and an HTML
    // page rendered as an image is a blank box where the source used to be.
    expect(sniffImage(text('<html><body><svg/></body></html>'))).toBeNull()
    expect(sniffImage(text('const icon = `<svg viewBox="0 0 8 8"/>`\n'))).toBeNull()
    expect(sniffImage(text('<svgfoo/>'))).toBeNull()
    expect(sniffImage(text('# Icons\n\nUse <svg> for vectors.\n'))).toBeNull()
  })

  it('does not call binary content SVG because it has no signature', () => {
    // Anything with a NUL is not text, whatever the rest of the bytes spell.
    const withNul = bytes('<svg', 0x00, ' viewBox="0 0 8 8"/>')
    expect(sniffImage(withNul)).toBeNull()
  })

  it('declines a prologue the sniff window cuts in half', () => {
    // Undecidable is not a match: an unterminated comment could be hiding
    // anything at all after it.
    expect(sniffImage(text(`<!-- ${'x'.repeat(9000)}`))).toBeNull()
    expect(sniffImage(text(`<?xml ${'x'.repeat(9000)}`))).toBeNull()
  })

  it('tolerates a signature that is all the bytes there are', () => {
    // A file truncated to exactly its magic number must not read past its end.
    expect(sniffImage(PNG.subarray(0, 8))?.kind).toBe('PNG')
    expect(sniffImage(PNG.subarray(0, 7))).toBeNull()
    expect(sniffImage(bytes(0xff, 0xd8, 0xff))?.kind).toBe('JPEG')
    expect(sniffImage(bytes('RIFF', ...u32(4), 'WEB'))).toBeNull()
  })

  it('caps the payload well above what repositories actually hold', () => {
    // The cap bounds the WIRE: base64 adds a third on top of it.
    expect(IMAGE_BYTE_CAP).toBeGreaterThan(1_000_000)
    expect(IMAGE_BYTE_CAP).toBeLessThanOrEqual(8_000_000)
  })
})
