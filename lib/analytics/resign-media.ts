// lib/analytics/resign-media.ts
// Re-sign article-media tokens inside a rrweb recording payload.
//
// Recordings capture the visitor's page verbatim — including media URLs
// carrying `?t=<expiry>.<hmac>` tokens that expire after 6 hours
// (lib/article/media-token.ts). A replay watched later than that would show
// broken videos/images: the browser re-requests those URLs and
// /api/article-media rejects the stale signature. The admin replay endpoint
// is authenticated, so it can legitimately mint fresh tokens at read time;
// the stored recording is never modified.

import { signMediaToken } from '@/lib/article/media-token';

// Matches an article-media URL up to and including `t=`, capturing the media
// id; the token that follows is replaced. `[^"]` keeps the scan inside one
// JSON string literal; \b stops `t=` from matching inside e.g. `format=`.
const MEDIA_TOKEN_URL_RE =
  /(\/api\/article-media\/([0-9a-f-]{36})\.[a-z0-9]{1,5}\?[^"]*?\bt=)\d+\.[0-9a-f]{32}/gi;

/** Replace every embedded media token in a JSON payload string with a fresh one. */
export function resignArticleMediaTokens(json: string): string {
  return json.replace(MEDIA_TOKEN_URL_RE, (_match, prefix: string, mediaId: string) => {
    return `${prefix}${signMediaToken(mediaId.toLowerCase())}`;
  });
}

// A presigned private-Blob URL: the store host, the pathname, and the signature
// query that expires an hour after the page was rendered.
const PRIVATE_BLOB_URL_RE =
  /https:\/\/[a-z0-9]+\.private\.blob\.vercel-storage\.com\/([A-Za-z0-9._\-/]+)(?:\?[^"\s\\]*)?/g;

/**
 * Send private-Blob images in a recording through /api/admin/blob-image, which
 * presigns them afresh, so post and comment images still show in a replay
 * watched after the visitor's one-hour URLs expired.
 */
export function resignBlobImages(json: string): string {
  return json.replace(PRIVATE_BLOB_URL_RE, (_match, pathname: string) =>
    `/api/admin/blob-image?p=${encodeURIComponent(pathname)}`,
  );
}
