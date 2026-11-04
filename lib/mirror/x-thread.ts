// lib/mirror/x-thread.ts
// X thread context stored with a mirror: the tweets the post replies to.
//
// The chain lives in content_items.platform_data.xThread rather than in the
// comments table, because it sits above the post, not under it. Its images are
// copied to Blob the same way comment images are, and its videos are kept as
// their X URLs, played through /api/x-thread/video. A tweet that is already
// mirrored is taken from that mirror instead: its images are in Blob already.

import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Author, FetchedContent, XThread } from '@/lib/fetcher/types';
import type { CommentImage } from '@/lib/db/schema';
import { db, contentItems, media } from '@/lib/db';
import { buildCommentRecords } from '@/lib/mirror/comments';
import { storeCommentImages } from '@/lib/mirror/comment-images';

export interface StoredPost {
  platformId: string;
  author: Author;
  text: string;
  postedAt: string | null;
  likes: number;
  replyCount: number;
  images: CommentImage[];
  /** X video URLs (video.twimg.com); absent in posts stored before videos were kept. */
  videos?: string[];
}

export interface StoredThread {
  /** Root first; the last entry is the tweet the mirrored post answers. */
  parents: StoredPost[];
  /** Next tweet up when the stored chain does not reach a root. */
  parentMissing: string | null;
}

/** Mirror rows for tweets that already have a mirror, keyed by tweet id. */
export async function mirroredTweets(tweetIds: string[]): Promise<Map<string, StoredPost & { contentItemId: string }>> {
  const found = new Map<string, StoredPost & { contentItemId: string }>();
  if (tweetIds.length === 0) return found;
  const items = await db
    .select()
    .from(contentItems)
    .where(and(eq(contentItems.platform, 'x'), inArray(sql`${contentItems.platformData}->>'sourceId'`, tweetIds)));
  if (items.length === 0) return found;
  const rows = await db.select().from(media).where(inArray(media.contentItemId, items.map((i) => i.id)));
  for (const item of items) {
    const sourceId = (item.platformData as { sourceId?: string } | null)?.sourceId;
    if (!sourceId || found.has(sourceId)) continue;
    const own = rows.filter((m) => m.contentItemId === item.id);
    const stats = item.stats as { likes?: number; comments?: number } | null;
    found.set(sourceId, {
      contentItemId: item.id,
      platformId: sourceId,
      author: item.author as Author,
      text: item.body,
      postedAt: item.publishedAt?.toISOString() ?? null,
      likes: stats?.likes ?? 0,
      replyCount: stats?.comments ?? 0,
      images: own.filter((m) => m.type === 'image').map((m) => ({ originalUrl: m.originalUrl, blobUrl: m.blobUrl })),
      videos: own.filter((m) => m.type === 'video').map((m) => m.originalUrl),
    });
  }
  return found;
}

/**
 * Shape the chain for platform_data: tweets already mirrored come from their
 * mirror, the rest have their images downloaded to Blob.
 */
export async function storeThread(thread: XThread): Promise<StoredThread> {
  const mirrored = await mirroredTweets(thread.parents.map((p) => p.id));
  const fresh = thread.parents.filter((p) => !mirrored.has(p.id));
  const records = buildCommentRecords(fresh, fresh.map((p) => p.id));
  const images = await storeCommentImages(records);
  const stored = new Map(
    records.map((r, i) => [
      r.platformCommentId,
      {
        platformId: r.platformCommentId,
        author: r.author,
        text: r.text,
        postedAt: r.postedAt || null,
        likes: r.likes,
        replyCount: r.replyCount,
        images: images[i]!,
        videos: r.videos,
      } satisfies StoredPost,
    ]),
  );
  return {
    parents: thread.parents.map((p) => {
      const hit = mirrored.get(p.id);
      if (!hit) return stored.get(p.id)!;
      const { contentItemId: _mirror, ...post } = hit;
      return post;
    }),
    parentMissing: thread.parentMissing,
  };
}

/** platform_data to write for freshly fetched content (adds the stored X thread). */
export async function mirrorPlatformData(content: FetchedContent): Promise<FetchedContent['platformData'] & { xThread?: StoredThread }> {
  if (!content.thread || (content.thread.parents.length === 0 && !content.thread.parentMissing)) {
    return content.platformData;
  }
  return { ...content.platformData, xThread: await storeThread(content.thread) };
}

/** Read the stored thread back from a content item's platform_data. */
export function readThread(platformData: unknown): StoredThread | null {
  const thread = (platformData as { xThread?: StoredThread } | null)?.xThread;
  return thread && Array.isArray(thread.parents) ? thread : null;
}

/**
 * Parents stored before videos were kept have no `videos`: fill those that
 * have their own mirror from it (videos, and images if none were stored), so
 * the page needs no refresh to show them.
 */
export async function withMirroredMedia(parents: StoredPost[]): Promise<StoredPost[]> {
  const missing = parents.filter((p) => p.videos === undefined).map((p) => p.platformId);
  if (missing.length === 0) return parents;
  const mirrored = await mirroredTweets(missing);
  return parents.map((p) => {
    const hit = p.videos === undefined ? mirrored.get(p.platformId) : undefined;
    if (!hit) return p;
    return { ...p, videos: hit.videos, images: p.images.length > 0 ? p.images : hit.images };
  });
}
