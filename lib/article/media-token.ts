// lib/article/media-token.ts
// Signed access tokens for article media URLs.
//
// An asset that isn't marked as publicly shared should be reachable from the
// article it belongs to and nowhere else. A bare `/api/article-media/<id>.<ext>`
// carries no proof of where the request came from — Referer is forgeable and
// often absent — so the page hands out a signed URL instead: the server signs
// (media id + expiry) when it renders the article, and the route verifies that
// signature before serving anything.
//
// Same construction as the comment challenge: HMAC over AUTH_SECRET, no server
// state, so it survives a cold start and costs no database round trip.

import { createHmac, timingSafeEqual } from 'crypto';

/** Query parameter carrying the token. */
export const MEDIA_TOKEN_PARAM = 't';

/**
 * How long a token minted for an article page stays valid.
 *
 * Long enough to read the article and watch what's in it — a video seek reuses
 * the same URL, and a token that expires mid-playback would look like a broken
 * player. Short enough that a URL copied out of devtools stops working the same
 * day.
 */
export const MEDIA_TOKEN_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * TTL for the og:image URL.
 *
 * Social crawlers fetch it without any token we could have given them and then
 * cache the result for a long time, so the page has to embed a URL that stays
 * valid well past the share. A cover image is the article's shopfront — it is
 * meant to be seen by whoever the link reaches — so a long-lived token is the
 * right trade. Everything else in the body keeps the short TTL.
 */
export const OG_IMAGE_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error('AUTH_SECRET is required to sign media URLs');
  return value;
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('hex').slice(0, 32);
}

/**
 * Mint a token for one media id.
 *
 * The id is part of the signed payload, so a token minted for one asset cannot
 * be replayed against another.
 */
export function signMediaToken(mediaId: string, ttlMs = MEDIA_TOKEN_TTL_MS): string {
  const expiresAt = Date.now() + ttlMs;
  return `${expiresAt}.${sign(`${mediaId}.${expiresAt}`)}`;
}

/** Append a freshly minted token to an in-app media URL. */
export function withMediaToken(url: string, mediaId: string, ttlMs?: number): string {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}${MEDIA_TOKEN_PARAM}=${signMediaToken(mediaId, ttlMs)}`;
}

export type MediaTokenVerdict = 'valid' | 'expired' | 'invalid';

/** Verify a token against the media id it should belong to. */
export function verifyMediaToken(mediaId: string, token: string | null): MediaTokenVerdict {
  if (!token) return 'invalid';

  const parts = token.split('.');
  if (parts.length !== 2) return 'invalid';
  const [expiresPart, signature] = parts;

  const expected = sign(`${mediaId}.${expiresPart}`);
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(signature, 'utf8');
  if (expectedBuf.length !== providedBuf.length) return 'invalid';
  if (!timingSafeEqual(expectedBuf, providedBuf)) return 'invalid';

  const expiresAt = Number(expiresPart);
  if (!Number.isFinite(expiresAt)) return 'invalid';
  // Expiry is checked after the signature so a forged token reports 'invalid'
  // rather than leaking that its expiry was the only problem.
  if (Date.now() > expiresAt) return 'expired';

  return 'valid';
}
