// lib/article/assets.ts
// Inventory of the images and videos uploaded into articles: what exists, what
// still references it, and what can be reclaimed.
//
// Reference tracking is done by scanning article text rather than by keeping a
// join table. The body is Markdown the author edits freely — they can delete an
// image, paste the same URL into a second article, or move it between posts,
// and none of that goes through an API we could hook. Text is the only source
// of truth about what a post actually references, so that's what gets read.

import { and, eq, inArray } from 'drizzle-orm';
import { db, contentItems, media } from '@/lib/db';
import { ARTICLE_MEDIA_PREFIX } from '@/lib/article/markdown';

/**
 * Uploads younger than this are never swept, even when unreferenced.
 *
 * A file is unreferenced for the whole window between "dropped into the editor"
 * and "article saved" — and an author may leave a draft open far longer than
 * that. Sweeping on that signal alone would delete work in progress. Single
 * deletes are still allowed; only the bulk sweep respects the grace period.
 */
export const CLEANUP_GRACE_MS = 24 * 60 * 60 * 1000;

/** Metadata written by the upload actions, plus the share flag set here. */
export interface AssetMeta {
  source?: string;
  contentType?: string;
  filename?: string | null;
  /** True once the admin flips "公开分享" — see the media route's access rules. */
  shared?: boolean;
  /** Blob URL of a video's captured first frame, if one was made. */
  posterUrl?: string;
}

export interface ArticleAsset {
  id: string;
  type: 'image' | 'video';
  url: string;
  filename: string | null;
  contentType: string;
  size: number;
  createdAt: Date;
  /** The article this was uploaded into (not necessarily one that uses it). */
  ownerArticleId: string;
  ownerArticleTitle: string;
  ownerArticleStatus: string | null;
  /** Articles whose body or cover actually references this asset. */
  referencedBy: Array<{ id: string; title: string; status: string | null }>;
  shared: boolean;
  /** True when a video has a captured poster frame. */
  hasPoster: boolean;
  /** Unreferenced and past the grace period — safe to sweep. */
  sweepable: boolean;
  /** Unreferenced but still inside the grace period. */
  withinGracePeriod: boolean;
}

/**
 * Collect the media ids an article's text refers to.
 *
 * Matches the `/api/article-media/<uuid>.<ext>` convention anywhere in the
 * text, so it catches Markdown images, bare links, and a URL the author pasted
 * into a cover field alike.
 */
export function extractMediaIds(...texts: Array<string | null | undefined>): Set<string> {
  const pattern = new RegExp(
    `${ARTICLE_MEDIA_PREFIX.replace(/\//g, '\\/')}([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\\.[a-z0-9]{1,5}`,
    'gi',
  );
  const ids = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    for (const match of text.matchAll(pattern)) {
      ids.add(match[1].toLowerCase());
    }
  }
  return ids;
}

export interface AssetInventory {
  assets: ArticleAsset[];
  totalBytes: number;
  sweepableCount: number;
  sweepableBytes: number;
}

/**
 * List every article asset with its reference status.
 *
 * Two queries, no N+1: all article rows (for their text) and all article media
 * rows. A personal site's article count stays in the hundreds, so scanning the
 * bodies in memory is cheaper than any indexed alternative would be to build.
 */
export async function listArticleAssets(now = Date.now()): Promise<AssetInventory> {
  const [articles, mediaRows] = await Promise.all([
    db
      .select({
        id: contentItems.id,
        title: contentItems.title,
        status: contentItems.status,
        body: contentItems.body,
        coverImageUrl: contentItems.coverImageUrl,
      })
      .from(contentItems)
      .where(eq(contentItems.type, 'article')),
    db
      .select({
        id: media.id,
        type: media.type,
        blobUrl: media.blobUrl,
        size: media.size,
        meta: media.meta,
        createdAt: media.createdAt,
        contentItemId: media.contentItemId,
      })
      .from(media)
      .innerJoin(contentItems, eq(media.contentItemId, contentItems.id))
      .where(eq(contentItems.type, 'article')),
  ]);

  const articleById = new Map(articles.map((a) => [a.id, a]));

  // media id → articles referencing it
  const references = new Map<string, Array<{ id: string; title: string; status: string | null }>>();
  for (const article of articles) {
    for (const mediaId of extractMediaIds(article.body, article.coverImageUrl)) {
      const list = references.get(mediaId) ?? [];
      list.push({ id: article.id, title: article.title, status: article.status });
      references.set(mediaId, list);
    }
  }

  const assets: ArticleAsset[] = mediaRows.map((row) => {
    const meta = (row.meta ?? {}) as AssetMeta;
    const owner = articleById.get(row.contentItemId);
    const referencedBy = references.get(row.id) ?? [];
    const fresh = now - new Date(row.createdAt).getTime() < CLEANUP_GRACE_MS;
    const extension = row.blobUrl?.split('.').pop()?.toLowerCase() ?? 'bin';

    return {
      id: row.id,
      type: row.type === 'video' ? 'video' : 'image',
      url: `${ARTICLE_MEDIA_PREFIX}${row.id}.${extension}`,
      filename: meta.filename ?? null,
      contentType: meta.contentType ?? '',
      size: row.size ?? 0,
      createdAt: row.createdAt,
      ownerArticleId: row.contentItemId,
      ownerArticleTitle: owner?.title ?? '(已删除)',
      ownerArticleStatus: owner?.status ?? null,
      referencedBy,
      shared: meta.shared === true,
      hasPoster: Boolean(meta.posterUrl),
      sweepable: referencedBy.length === 0 && !fresh,
      withinGracePeriod: referencedBy.length === 0 && fresh,
    };
  });

  assets.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return {
    assets,
    totalBytes: assets.reduce((sum, a) => sum + a.size, 0),
    sweepableCount: assets.filter((a) => a.sweepable).length,
    sweepableBytes: assets.filter((a) => a.sweepable).reduce((sum, a) => sum + a.size, 0),
  };
}

/**
 * Re-check that specific assets are still unreferenced, right before deleting.
 *
 * The inventory the admin saw may be minutes old, and an article saved in
 * between could have started using one of them. Reads the text again rather
 * than trusting the ids that came back from the browser.
 */
export async function filterStillUnreferenced(mediaIds: string[]): Promise<string[]> {
  if (mediaIds.length === 0) return [];

  const articles = await db
    .select({ body: contentItems.body, coverImageUrl: contentItems.coverImageUrl })
    .from(contentItems)
    .where(eq(contentItems.type, 'article'));

  const referenced = new Set<string>();
  for (const article of articles) {
    for (const id of extractMediaIds(article.body, article.coverImageUrl)) referenced.add(id);
  }
  return mediaIds.filter((id) => !referenced.has(id));
}

/** Media rows for the given ids, restricted to article assets. */
export async function loadArticleMediaRows(mediaIds: string[]) {
  if (mediaIds.length === 0) return [];
  return db
    .select({
      id: media.id,
      type: media.type,
      blobUrl: media.blobUrl,
      size: media.size,
      meta: media.meta,
    })
    .from(media)
    .innerJoin(contentItems, eq(media.contentItemId, contentItems.id))
    .where(and(inArray(media.id, mediaIds), eq(contentItems.type, 'article')));
}

/** Human-readable byte size for the admin UI. */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
