// lib/article/image-transform.ts
// On-demand WebP derivatives for article images.
//
// An article photo comes off a phone at several megabytes and gets displayed in
// a 700px column. Serving the original wastes most of those bytes on every
// reader. This resizes to the width actually needed and re-encodes as WebP,
// which is typically a quarter to a third the size of the source JPEG.
//
// Derivatives are cached in Blob under a deterministic path, so the conversion
// happens once per (image, width). Every later request is the same 302 the
// original took — no function work at all. That's also why widths come from a
// fixed ladder rather than the query string: an open width parameter would let
// anyone fill the store with one-off renders.

import sharp from 'sharp';
import { head, put } from '@vercel/blob';
import { presignImage, presignPathname } from '@/lib/blob/presign';

/**
 * Widths offered to the browser via srcset.
 *
 * Chosen around the layouts that exist: ~350 for a grid tile, 700 for the
 * reading column, and the 2× versions of each for dense displays.
 */
export const IMAGE_WIDTHS = [400, 700, 1000, 1400, 2000] as const;
export type ImageWidth = (typeof IMAGE_WIDTHS)[number];

/** Quality that stays visually clean while cutting most of the bytes. */
const WEBP_QUALITY = 82;

/** Refuse to decode something absurd — a decompression-bomb guard. */
const MAX_SOURCE_PIXELS = 60_000_000;

/**
 * Formats left untouched.
 *
 * SVG is vector — resizing it means rasterising, which makes it bigger and
 * worse. GIF is usually animated, and flattening an animation to a still is a
 * worse failure than serving the original.
 */
const PASSTHROUGH_TYPES = ['image/svg+xml', 'image/gif'];

export function isTransformableType(contentType: string): boolean {
  const type = contentType.split(';')[0].trim().toLowerCase();
  return type.startsWith('image/') && !PASSTHROUGH_TYPES.includes(type);
}

/** Parse a requested width, snapping to the ladder; null when absent/invalid. */
export function parseWidth(raw: string | null): ImageWidth | null {
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  return (IMAGE_WIDTHS as readonly number[]).includes(value) ? (value as ImageWidth) : null;
}

/** Deterministic Blob path for one derivative. */
function derivedPathname(mediaId: string, width: number): string {
  return `articles/derived/${mediaId}-w${width}.webp`;
}

/**
 * Presigned URL for an already-built derivative, or null if it isn't built yet.
 *
 * Split from the generating path deliberately. Converting a multi-megabyte
 * photo takes seconds, and making the first request wait for it means the first
 * reader stares at a broken image — the browser gives up long before sharp
 * finishes. So the request path only ever *looks up*, and generation is kicked
 * off behind the response.
 */
export async function getCachedDerivedUrl(
  mediaId: string,
  width: ImageWidth,
): Promise<string | null> {
  const pathname = derivedPathname(mediaId, width);
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  try {
    // head() is a metadata call — cheap enough to sit in the request path.
    await head(pathname, { ...(token ? { token } : {}) });
    return await presignPathname(pathname);
  } catch {
    return null;
  }
}

/**
 * Build the WebP derivative and store it.
 *
 * Meant to run after the response has been sent (see `after()` in the media
 * route), so its cost never lands on a reader. Returns the presigned URL for
 * completeness; callers that only want the side effect can ignore it.
 *
 * Returns null when the source can't be transformed or the conversion fails —
 * the original stays available either way, so a bad derivative costs quality,
 * never availability.
 */
export async function generateDerivedImage(
  mediaId: string,
  blobUrl: string,
  width: ImageWidth,
): Promise<string | null> {
  const pathname = derivedPathname(mediaId, width);
  const token = process.env.BLOB_READ_WRITE_TOKEN;

  // Another request may have built it while this one waited to run.
  const existing = await getCachedDerivedUrl(mediaId, width);
  if (existing) return existing;

  try {
    const sourceUrl = await presignImage(blobUrl);
    const response = await fetch(sourceUrl);
    if (!response.ok) return null;
    const input = Buffer.from(await response.arrayBuffer());

    const image = sharp(input, { limitInputPixels: MAX_SOURCE_PIXELS });
    const meta = await image.metadata();
    // Never upscale: a 600px source asked for at 1400 should stay 600.
    const target = meta.width && meta.width < width ? meta.width : width;

    const output = await image
      .rotate() // honour EXIF orientation before resizing
      .resize({ width: target, withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();

    await put(pathname, output, {
      access: 'private',
      contentType: 'image/webp',
      addRandomSuffix: false, // the path IS the cache key
      allowOverwrite: true,
      ...(token ? { token } : {}),
    });

    return await presignPathname(pathname);
  } catch {
    return null;
  }
}

/** Blob pathnames of every derivative of one image, for cleanup on delete. */
export function derivedPathnamesFor(mediaId: string): string[] {
  return IMAGE_WIDTHS.map((width) => derivedPathname(mediaId, width));
}

