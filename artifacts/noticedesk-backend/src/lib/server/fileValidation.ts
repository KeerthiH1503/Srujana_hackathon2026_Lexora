export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 MB

export type FileKind = 'pdf' | 'png' | 'jpeg' | 'webp' | 'text';

/** Detects the real file type from its first bytes. The browser-supplied type/name is NOT trusted. */
export function detectFileKind(bytes: Uint8Array): FileKind | null {
  const startsWith = (sig: number[], offset = 0) => sig.every((b, i) => bytes[offset + i] === b);
  if (bytes.length >= 5 && startsWith([0x25, 0x50, 0x44, 0x46, 0x2d])) return 'pdf'; // %PDF-
  if (bytes.length >= 8 && startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (bytes.length >= 3 && startsWith([0xff, 0xd8, 0xff])) return 'jpeg';
  if (bytes.length >= 12 && startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) return 'webp';
  // Plain text: no NUL bytes in the first 4 KB and valid UTF-8.
  const sample = bytes.subarray(0, 4096);
  if (sample.length > 0 && !sample.includes(0)) {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(sample);
      return 'text';
    } catch {
      /* a multi-byte character may be cut at the 4 KB boundary; try a shorter prefix */
      try {
        new TextDecoder('utf-8', { fatal: true }).decode(sample.subarray(0, Math.max(0, sample.length - 3)));
        return 'text';
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function mimeFor(kind: FileKind): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (kind === 'png') return 'image/png';
  if (kind === 'jpeg') return 'image/jpeg';
  if (kind === 'webp') return 'image/webp';
  return null;
}

export const MAX_FILES = 5;
export const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGE_SIDE = 10_000;
export const MAX_IMAGE_PIXELS = 40_000_000;

/** Reads width and height from PNG and JPEG headers without decoding the image. Returns null if unknown. */
export function imageSize(bytes: Uint8Array, kind: FileKind): { width: number; height: number } | null {
  if (kind === 'png' && bytes.length >= 24) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: dv.getUint32(16), height: dv.getUint32(20) };
  }
  if (kind === 'jpeg') {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) { i++; continue; }
      const marker = bytes[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = (bytes[i + 2] << 8) | bytes[i + 3];
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] };
      }
      i += 2 + len;
    }
  }
  return null;
}

export function imageTooLarge(size: { width: number; height: number } | null): boolean {
  if (!size) return false;
  return size.width > MAX_IMAGE_SIDE || size.height > MAX_IMAGE_SIDE || size.width * size.height > MAX_IMAGE_PIXELS;
}
