/**
 * The ZIP archive inside `bytes`. Self-extracting and signed packages prepend data to the archive; the
 * end-of-central-directory record tells how much, so the archive's own offsets line up again.
 */
export function zipPayload(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const stop = Math.max(0, bytes.length - 22 - 0xffff);
  for (let offset = bytes.length - 22; offset >= stop; offset -= 1) {
    if (view.getUint32(offset, true) !== 0x06054b50) {
      continue;
    }
    const directorySize = view.getUint32(offset + 12, true);
    const directoryOffset = view.getUint32(offset + 16, true);
    const prefix = offset - directorySize - directoryOffset;
    return prefix > 0 && prefix < offset ? bytes.subarray(prefix) : bytes;
  }
  return bytes;
}

export function isZipBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}
