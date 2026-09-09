// lib/blob/download-image.ts
// Server-side image download → Vercel Blob (private store).
// Plan 03-04, Task 1 — extracts the upload-image route's Blob put logic into a
// reusable utility for createMirror's image persistence step.
//
// Pitfall 5: @vercel/blob put() does NOT return file size. We read the
//   Content-Length header from the upstream response to get the byte count.
//   This size is critical for D-17 quota aggregation (SUM(size) WHERE type='image').
//   Without it, the quota sum would always be 0.
// Pitfall 6: We return blob.url (the permanent private URL), NOT a presigned
//   URL. Presigned URLs expire after ~1h. Phase 4's visitor-facing layer will
//   re-presign on demand. Storing the permanent URL ensures the mirror survives.
// SHRE-08 prereq: pathname uses crypto.randomUUID() for a high-entropy random
//   segment so Blob paths are not enumerable.

import { put } from '@vercel/blob';
import { randomUUID } from 'crypto';

/**
 * Result of downloading an image to Vercel Blob.
 * - blobUrl: permanent private URL from put() (NOT a presigned URL — Pitfall 6)
 * - size: byte count from the upstream Content-Length header (Pitfall 5)
 * - pathname: the Blob pathname (high-entropy, non-enumerable)
 * - contentType: MIME type from upstream (or fallback 'image/jpeg')
 */
export interface DownloadedImage {
  blobUrl: string;
  size: number;
  pathname: string;
  contentType: string;
}

/**
 * Download an image from an upstream URL and persist it to Vercel Blob
 * (private store). Returns the permanent blob URL and the byte size.
 *
 * @param originalUrl  the upstream image URL (e.g. https://pbs.twimg.com/...)
 * @returns            { blobUrl, size, pathname, contentType }
 * @throws             Error if the upstream fetch returns a non-2xx status
 *                     (caller should catch and record as a partial failure)
 *
 * Usage in createMirror:
 *   Called OUTSIDE db.transaction for each image media item. Failures are
 *   collected (blobUrl=null, size=0) and reported as warnings — a single
 *   image failure does not roll back the entire mirror.
 */
export async function downloadImageToBlob(
  originalUrl: string,
): Promise<DownloadedImage> {
  // 1. Fetch the image from upstream
  const upstream = await fetch(originalUrl);
  if (!upstream.ok) {
    throw new Error(
      `Upstream image fetch failed: ${upstream.status} for ${originalUrl}`,
    );
  }

  // 2. Extract metadata from upstream response headers
  const contentType = upstream.headers.get('content-type') || 'image/jpeg';
  // Pitfall 5: put() does not return size. Read Content-Length from upstream.
  const contentLength = upstream.headers.get('content-length');
  const size = contentLength ? parseInt(contentLength, 10) : 0;

  // 3. Build a high-entropy pathname (SHRE-08 prereq — not enumerable)
  //    Include file extension derived from contentType so Vercel Blob
  //    dashboard shows a recognizable filename instead of "unknown".
  const ext = contentTypeToExt(contentType);
  const pathname = `images/${randomUUID()}.${ext}`;

  // 4. Upload to Vercel Blob (private store, no extra suffix — UUID is enough)
  //    Pass token explicitly to win over any stale VERCEL_OIDC_TOKEN that may
  //    be present in .env.local (from `vercel env pull`). OIDC tokens are
  //    short-lived and expire; the long-lived BLOB_READ_WRITE_TOKEN is the
  //    correct credential for local dev. SDK resolution order: explicit token
  //    (tier 1) > OIDC (tier 2) > BLOB_READ_WRITE_TOKEN env (tier 3).
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const blob = await put(pathname, upstream.body!, {
    access: 'private',
    contentType,
    addRandomSuffix: false,
    ...(token ? { token } : {}),
  });

  // 5. Return permanent URL (Pitfall 6: NOT presigned) + size from Content-Length
  return {
    blobUrl: blob.url,
    size,
    pathname: blob.pathname,
    contentType,
  };
}

/** Map common image MIME types to file extensions for Blob pathname. */
function contentTypeToExt(contentType: string): string {
  const mime = contentType.split(';')[0].trim().toLowerCase();
  switch (mime) {
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/gif':
      return 'gif';
    case 'image/webp':
      return 'webp';
    case 'image/svg+xml':
      return 'svg';
    case 'image/avif':
      return 'avif';
    default:
      return 'bin';
  }
}
