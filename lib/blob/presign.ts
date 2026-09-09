// lib/blob/presign.ts
// Presigned URL generation for private Vercel Blob images.
// Plan 04-02, Task 1 — D-39 (1h presigned URLs for visitor access).
//
// PATTERNS landmine #17: the `media` table stores only `blobUrl` (the
// permanent private URL from put()), NOT the Blob pathname. presignUrl()
// requires a pathname, so we extract it from the blobUrl via
// `new URL(blobUrl).pathname.slice(1)`. This avoids any Phase 3 schema
// change — createMirror already stores blobUrl in media.blobUrl.
//
// Reference: app/api/upload-image/route.ts:34-40 (issueSignedToken +
// presignUrl pattern) and lib/blob/download-image.ts (lib/blob/ module
// organization).
//
// Token resolution (same pitfall as download-image.ts): pass
// BLOB_READ_WRITE_TOKEN explicitly to issueSignedToken so it wins over any
// stale VERCEL_OIDC_TOKEN in .env.local. OIDC tokens are short-lived and
// expire; without the explicit override the SDK uses the expired OIDC
// token (tier 2 > tier 3) and the control API returns "Access denied".
// presignUrl is a local crypto op (uses clientSigningToken from the
// issueSignedToken result) so it does not need the token option.

import { issueSignedToken, presignUrl } from '@vercel/blob';

/**
 * Extract the Blob pathname from a permanent blob URL.
 *
 * Vercel Blob URL format: `https://<store>.blob.vercel-storage.com/<pathname>`
 * `new URL(blobUrl).pathname` returns `/<pathname>` (with leading slash);
 * `.slice(1)` strips the leading slash → `images/<uuid>.jpg`.
 *
 * PATTERNS landmine #17: media table does not store pathname — extract from blobUrl.
 */
export function extractPathname(blobUrl: string): string {
  return new URL(blobUrl).pathname.slice(1);
}

/**
 * Generate a presigned URL from a Blob pathname.
 *
 * presignImage() takes the permanent URL because that is what the media table
 * stores. Derived images are addressed by a pathname we compute rather than one
 * we looked up, so they need this entry point instead of round-tripping through
 * a synthesised URL.
 */
export async function presignPathname(pathname: string): Promise<string> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const signedToken = await issueSignedToken({ pathname, token });
  const { presignedUrl } = await presignUrl(signedToken, {
    operation: 'get',
    pathname,
    access: 'private',
  });
  return presignedUrl;
}

/**
 * Generate a presigned URL for a private Blob image (D-39).
 *
 * Default validity is 1h (issueSignedToken default validUntil = now + 1h).
 * The presigned URL is publicly accessible until the token expires.
 */
export async function presignImage(blobUrl: string): Promise<string> {
  const pathname = extractPathname(blobUrl);
  // Explicit token wins over stale VERCEL_OIDC_TOKEN (see header note).
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const signedToken = await issueSignedToken({ pathname, token });
  const { presignedUrl } = await presignUrl(signedToken, {
    operation: 'get',
    pathname,
    access: 'private',
  });
  return presignedUrl;
}

/**
 * Batch presign multiple images in parallel (D-39).
 *
 * Filters out falsy values (null, empty string) before presigning, so
 * media rows with a failed download (blobUrl=null) are silently skipped
 * (VIEW-02 empty edge — image gallery skips failed downloads).
 */
export async function presignImages(blobUrls: string[]): Promise<string[]> {
  return Promise.all(blobUrls.filter(Boolean).map(presignImage));
}
