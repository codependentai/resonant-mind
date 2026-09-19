import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  MAX_IMAGE_BYTES,
  decodeBase64Image,
  validateImageBytes,
} from '../src/shared/image-security';

const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(
  fileURLToPath(new URL(`./fixtures/images/${name}`, import.meta.url)),
));

const jpeg = fixture('valid.jpg');
const png = fixture('valid.png');
const gif = fixture('valid.gif');
const webp = fixture('valid.webp');
const webpVp8 = fixture('valid-vp8.webp');
const webpVp8x = fixture('valid-vp8x.webp');
const formats = [
  [jpeg, 'image/jpeg', '.jpg'],
  [png, 'image/png', '.png'],
  [gif, 'image/gif', '.gif'],
  [webp, 'image/webp', '.webp'],
  [webpVp8, 'image/webp', '.webp'],
  [webpVp8x, 'image/webp', '.webp'],
] as const;

function concat(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function findSequence(bytes: Uint8Array, sequence: readonly number[]): number {
  for (let i = 0; i <= bytes.length - sequence.length; i += 1) {
    if (sequence.every((byte, offset) => bytes[i + offset] === byte)) return i;
  }
  throw new Error(`Fixture does not contain ${sequence.map((value) => value.toString(16)).join(' ')}`);
}

describe('image byte validation', () => {
  it.each(formats)('derives a canonical format from a genuinely valid fixture', (bytes, mime, extension) => {
    expect(validateImageBytes(bytes)).toEqual({ mime, extension });
  });

  it('rejects spoofed active content regardless of claimed MIME', () => {
    const html = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
    expect(() => validateImageBytes(html)).toThrow(/unsupported image bytes/i);
  });

  it.each([
    concat(Uint8Array.of(0xff, 0xd8, 0xff), new TextEncoder().encode('<script>alert(1)</script>'), Uint8Array.of(0xff, 0xd9)),
    concat(png.subarray(0, 8), new TextEncoder().encode('<script>alert(1)</script>'), png.subarray(png.length - 12)),
    concat(gif.subarray(0, 6), new TextEncoder().encode('<script>alert(1)</script>'), Uint8Array.of(0x3b)),
    (() => {
      const payload = new TextEncoder().encode('<script>alert(1)</script>');
      const bytes = concat(
        new TextEncoder().encode('RIFF'),
        new Uint8Array(4),
        new TextEncoder().encode('WEBPVP8 '),
        Uint8Array.of(payload.length, 0, 0, 0),
        payload,
        payload.length % 2 ? Uint8Array.of(0) : new Uint8Array(),
      );
      new DataView(bytes.buffer).setUint32(4, bytes.length - 8, true);
      return bytes;
    })(),
  ])('rejects marker-wrapped script payloads', (bytes) => {
    expect(() => validateImageBytes(bytes)).toThrow();
  });

  it.each(formats.map(([bytes]) => bytes.subarray(0, bytes.length - 1)))('rejects truncated containers', (bytes) => {
    expect(() => validateImageBytes(bytes)).toThrow();
  });

  it('rejects an invalid JPEG segment length', () => {
    const malformed = jpeg.slice();
    malformed[4] = 0;
    malformed[5] = 1;
    expect(() => validateImageBytes(malformed)).toThrow(/jpeg/i);
  });

  it('rejects PNG chunks in an invalid order', () => {
    const malformed = png.slice();
    malformed.set(new TextEncoder().encode('IDAT'), 12);
    expect(() => validateImageBytes(malformed)).toThrow(/png/i);
  });

  it('rejects PNG chunk data with a bad CRC', () => {
    const malformed = png.slice();
    const idat = findSequence(malformed, [0x49, 0x44, 0x41, 0x54]);
    malformed[idat + 4] ^= 1;
    expect(() => validateImageBytes(malformed)).toThrow(/png/i);
  });

  it('rejects an invalid GIF sub-block length', () => {
    const malformed = gif.slice();
    malformed[malformed.length - 2] = 0xff;
    expect(() => validateImageBytes(malformed)).toThrow(/gif/i);
  });

  it('rejects an invalid WebP chunk length', () => {
    const malformed = webp.slice();
    new DataView(malformed.buffer).setUint32(16, malformed.length, true);
    expect(() => validateImageBytes(malformed)).toThrow(/webp/i);
  });

  it('rejects a WebP frame header with no compressed image payload', () => {
    const frameHeader = Uint8Array.of(0, 0, 0, 0x9d, 0x01, 0x2a, 1, 0, 1, 0);
    const headerOnly = concat(
      new TextEncoder().encode('RIFF'),
      new Uint8Array(4),
      new TextEncoder().encode('WEBPVP8 '),
      Uint8Array.of(frameHeader.length, 0, 0, 0),
      frameHeader,
    );
    new DataView(headerOnly.buffer).setUint32(4, headerOnly.length - 8, true);
    expect(() => validateImageBytes(headerOnly)).toThrow(/webp/i);
  });

  it('rejects VP8X metadata without a primary image payload', () => {
    const headerOnly = webpVp8x.slice(0, 30);
    new DataView(headerOnly.buffer).setUint32(4, headerOnly.length - 8, true);
    expect(() => validateImageBytes(headerOnly)).toThrow(/webp/i);
  });

  it.each([
    (() => {
      const malformed = jpeg.slice();
      const sof = findSequence(malformed, [0xff, 0xc0]);
      malformed.fill(0, sof + 5, sof + 9);
      return malformed;
    })(),
    (() => {
      const malformed = png.slice();
      malformed.fill(0, 16, 24);
      return malformed;
    })(),
    (() => {
      const malformed = gif.slice();
      malformed.fill(0, 6, 10);
      return malformed;
    })(),
  ])('rejects zero or invalid image dimensions', (bytes) => {
    expect(() => validateImageBytes(bytes)).toThrow();
  });

  it.each(formats.map(([bytes]) => concat(bytes, Uint8Array.of(0))))('rejects trailing data after the exact container end', (bytes) => {
    expect(() => validateImageBytes(bytes)).toThrow(/trailing|length|end|trailer/i);
  });
});

describe('base64 image bounds', () => {
  it('rejects encoded input that cannot fit before decoding', () => {
    const oversized = 'A'.repeat(Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 1);
    expect(() => decodeBase64Image(oversized)).toThrow(/encoded image_data is too large/i);
  });

  it('rejects malformed base64 instead of accepting partial input', () => {
    expect(() => decodeBase64Image('not+base64!')).toThrow(/valid base64/i);
  });
});
