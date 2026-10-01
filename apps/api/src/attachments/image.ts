import sharp from 'sharp';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export type ImageKind = 'jpeg' | 'png' | 'webp';

/** Detect the real type from magic bytes; the client's Content-Type is ignored (SEC-38). */
export function sniffImage(buf: Buffer): ImageKind | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return null;
}

/**
 * Re-encode to JPEG (max 1600 px). Decoding and re-encoding drops EXIF (including GPS) and any
 * appended or polyglot payload, because only decoded pixels are written back.
 */
export async function reencode(buf: Buffer): Promise<Buffer> {
  return sharp(buf, { limitInputPixels: 40_000_000, failOn: 'error' })
    .rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 78, mozjpeg: true })
    .toBuffer();
}
