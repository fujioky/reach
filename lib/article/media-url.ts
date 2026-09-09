// lib/article/media-url.ts
// Prepares article media URLs for rendering: signs the ones that need it.
//
// The page no longer decides how media is delivered — /api/article-media reads
// the article_media_direct setting itself and either streams or redirects to a
// presigned storage URL. What the page still has to do is prove that a request
// for a non-public asset came from the article, because only the server can
// sign, and a rendered page is the only place that proof can be attached.
//
// So: assets marked 公开分享 keep a bare URL (copyable, shareable, permanent),
// everything else gets `?t=<token>` valid for a few hours.

import { and, eq, inArray } from 'drizzle-orm';
import { db, media, contentItems } from '@/lib/db';
import { getSetting } from '@/lib/settings';
import { ARTICLE_MEDIA_PREFIX } from '@/lib/article/markdown';
import { extractMediaIds } from '@/lib/article/assets';
import { signMediaToken, MEDIA_TOKEN_PARAM } from '@/lib/article/media-token';

/** True when the media route should redirect to storage instead of streaming. */
export async function isDirectMediaEnabled(): Promise<boolean> {
  return (await getSetting('article_media_direct')) === 'true';
}

/**
 * Which of the given media ids need a signed URL.
 *
 * Returns the set of ids that are NOT publicly shared — the ones the route will
 * demand a token for.
 */
export async function findGatedMediaIds(
  ...texts: Array<string | null | undefined>
): Promise<Set<string>> {
  const ids = [...extractMediaIds(...texts)];
  if (ids.length === 0) return new Set();

  const rows = await db
    .select({ id: media.id, meta: media.meta })
    .from(media)
    .innerJoin(contentItems, eq(media.contentItemId, contentItems.id))
    .where(and(inArray(media.id, ids), eq(contentItems.type, 'article')));

  const gated = new Set<string>();
  for (const row of rows) {
    const meta = (row.meta ?? {}) as { shared?: boolean };
    if (meta.shared !== true) gated.add(row.id);
  }
  return gated;
}

/**
 * Append access tokens to the media URLs in a piece of text.
 *
 * Ids outside `gated` are left alone, so a public asset's URL stays clean and
 * can be copied straight out of the page.
 */
export function signMediaUrls(text: string, gated: Set<string>, ttlMs?: number): string {
  if (gated.size === 0) return text;
  const pattern = new RegExp(
    `${ARTICLE_MEDIA_PREFIX.replace(/\//g, '\\/')}([0-9a-f-]{36})\\.[a-z0-9]{1,5}`,
    'gi',
  );
  return text.replace(pattern, (match, id: string) => {
    const mediaId = id.toLowerCase();
    if (!gated.has(mediaId)) return match;
    const separator = match.includes('?') ? '&' : '?';
    return `${match}${separator}${MEDIA_TOKEN_PARAM}=${signMediaToken(mediaId, ttlMs)}`;
  });
}

/**
 * Convenience for a page: look up which ids are gated, then sign every text.
 * Returns the texts in the order they were given.
 */
export async function signArticleMedia(
  ...texts: Array<string | null | undefined>
): Promise<Array<string | null>> {
  const gated = await findGatedMediaIds(...texts);
  return texts.map((text) => (text == null ? null : signMediaUrls(text, gated)));
}
