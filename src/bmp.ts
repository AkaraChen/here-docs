/**
 * A minimal BMP decoder: sharp's prebuilt libvips has no BMP loader, and BMP still turns up as inline
 * images of older Outlook mail, in Word documents, and in OFD resources. Uncompressed 1/4/8-bit palette
 * and 16/24/32-bit images (with bit-field masks) are decoded to RGBA; RLE-compressed files are rejected.
 */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array;
}

const MAX_PIXELS = 100_000_000;

export function isBmp(bytes: Uint8Array): boolean {
  if (bytes.length < 26 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) {
    return false;
  }
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(14, true);
  return header === 12 || header === 40 || header === 52 || header === 56 || header === 64 || header === 108 || header === 124;
}

export function decodeBmp(bytes: Uint8Array): RgbaImage {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pixelOffset = view.getUint32(10, true);
  const headerSize = view.getUint32(14, true);
  const core = headerSize === 12;
  const width = core ? view.getUint16(18, true) : view.getInt32(18, true);
  const rawHeight = core ? view.getInt16(20, true) : view.getInt32(22, true);
  const bits = core ? view.getUint16(24, true) : view.getUint16(28, true);
  const compression = core ? 0 : view.getUint32(30, true);
  const height = Math.abs(rawHeight);
  const bottomUp = rawHeight > 0;
  if (width <= 0 || height <= 0 || width * height > MAX_PIXELS) {
    throw new Error(`unsupported BMP dimensions ${width}x${height}`);
  }
  if (compression !== 0 && compression !== 3 && compression !== 6) {
    throw new Error(`unsupported BMP compression ${compression}`);
  }

  // Bit-field masks follow a 40-byte header, or live inside the larger V4/V5 headers.
  let masks: [number, number, number, number] | null = null;
  if (compression === 3 || compression === 6) {
    const at = headerSize === 40 ? 54 : 40;
    masks = [view.getUint32(at, true), view.getUint32(at + 4, true), view.getUint32(at + 8, true), compression === 6 || headerSize >= 56 ? view.getUint32(at + 12, true) : 0];
  } else if (bits === 16) {
    masks = [0x7c00, 0x03e0, 0x001f, 0];
  }

  const palette: number[][] = [];
  if (bits <= 8) {
    const entrySize = core ? 3 : 4;
    const colors = (core ? 0 : view.getUint32(46, true)) || 1 << bits;
    const start = 14 + headerSize;
    for (let i = 0; i < colors && start + i * entrySize + 2 < bytes.length; i += 1) {
      const at = start + i * entrySize;
      palette.push([bytes[at + 2]!, bytes[at + 1]!, bytes[at]!]);
    }
  }

  const stride = Math.floor((bits * width + 31) / 32) * 4;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const row = pixelOffset + (bottomUp ? height - 1 - y : y) * stride;
    for (let x = 0; x < width; x += 1) {
      const out = (y * width + x) * 4;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 255;
      if (bits <= 8) {
        const bit = x * bits;
        const byte = bytes[row + (bit >> 3)] ?? 0;
        const index = (byte >> (8 - bits - (bit & 7))) & ((1 << bits) - 1);
        [r = 0, g = 0, b = 0] = palette[index] ?? [];
      } else if (bits === 24) {
        const at = row + x * 3;
        [b, g, r] = [bytes[at] ?? 0, bytes[at + 1] ?? 0, bytes[at + 2] ?? 0];
      } else if (bits === 16 || bits === 32) {
        const at = row + x * (bits / 8);
        if (at + bits / 8 > bytes.length) {
          continue;
        }
        const value = bits === 16 ? view.getUint16(at, true) : view.getUint32(at, true);
        if (masks) {
          [r, g, b] = [channel(value, masks[0]), channel(value, masks[1]), channel(value, masks[2])];
          a = masks[3] ? channel(value, masks[3]) : 255;
        } else {
          [b, g, r] = [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff];
        }
      } else {
        throw new Error(`unsupported BMP bit depth ${bits}`);
      }
      data[out] = r;
      data[out + 1] = g;
      data[out + 2] = b;
      data[out + 3] = a;
    }
  }
  return { width, height, data };
}

/** Scales a masked field to 0..255. */
function channel(value: number, mask: number): number {
  if (mask === 0) {
    return 0;
  }
  let shift = 0;
  while (((mask >>> shift) & 1) === 0) {
    shift += 1;
  }
  const max = mask >>> shift;
  return Math.round((((value & mask) >>> shift) * 255) / max);
}
