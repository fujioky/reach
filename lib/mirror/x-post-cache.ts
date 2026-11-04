// lib/mirror/x-post-cache.ts
// Opening an X post from a mirror's thread without mirroring it.
//
// From the visitor page a reader can open a tweet in the conversation (a
// parent above the mirrored post, or a reply loaded on such a page) and see it
// with its own context and replies. A tweet that already has a mirror is
// built from that mirror (no fetch, images already in Blob); otherwise the
// first open fetches it through reach-upstream and copies its images to Blob.
// Either way the result is stored in x_post_cache for later readers. Only tweets already
// reachable from this mirror can be opened, so a share link cannot be used to
// fetch arbitrary tweets.

import { and, eq, sql } from 'drizzle-orm';
import { db, comments, contentItems, media, xPostCache } from '@/lib/db';
import { fetchContent } from '@/lib/fetcher';
import type { Comment, FetchedContent } from '@/lib/fetcher/types';
import { buildCommentRecords, type CommentRecord } from '@/lib/mirror/comments';
import { storeCommentImages } from '@/lib/mirror/comment-images';
import { readThread, type StoredPost } from '@/lib/mirror/x-thread';

type ContentItemRow = typeof contentItems.$inferSelect;

export interface StoredReply extends StoredPost {
  /** Tweet this reply answers: the opened post or another reply in `replies`. */
  inReplyTo: string;
}

export interface XPostCachePayload {
  post: StoredPost & { sourceUrl: string };
  /** What the post replies to, root first. */
  parents: StoredPost[];
  parentMissing: string | null;
  replies: StoredReply[];
}

export type OpenPostResult = { ok: true; payload: XPostCachePayload } | { ok: false; status: number; error: string };

export function statusUrl(id: string): string {
  return `https://x.com/i/status/${id}`;
}

/** Tweet ids this mirror's thread already shows, so a reader may open them. */
async function reachableIds(item: ContentItemRow): Promise<Set<string>> {
  const ids = new Set<string>();
  const thread = readThread(item.platformData);
  for (const p of thread?.parents ?? []) ids.add(p.platformId);
  if (thread?.parentMissing) ids.add(thread.parentMissing);
  const rows = await db
    .select({ platformCommentId: comments.platformCommentId })
    .from(comments)
    .where(eq(comments.contentItemId, item.id));
  for (const r of rows) if (r.platformCommentId) ids.add(r.platformCommentId);
  const cached = await db
    .select({ payload: xPostCache.payload })
    .from(xPostCache)
    .where(eq(xPostCache.contentItemId, item.id));
  for (const { payload } of cached) {
    const p = payload as XPostCachePayload;
    for (const post of [...p.parents, ...p.replies]) ids.add(post.platformId);
    if (p.parentMissing) ids.add(p.parentMissing);
  }
  return ids;
}

async function readCached(item: ContentItemRow, tweetId: string): Promise<XPostCachePayload | null> {
  const [row] = await db
    .select({ payload: xPostCache.payload })
    .from(xPostCache)
    .where(and(eq(xPostCache.contentItemId, item.id), eq(xPostCache.tweetId, tweetId)))
    .limit(1);
  const payload = (row?.payload as XPostCachePayload | undefined) ?? null;
  // Stored before videos were kept: build it again rather than show a post
  // whose video is missing.
  return payload && payload.post.videos !== undefined ? payload : null;
}

/** Store (or replace an outdated copy of) an opened post. */
async function saveCached(item: ContentItemRow, tweetId: string, payload: XPostCachePayload): Promise<void> {
  await db
    .insert(xPostCache)
    .values({ contentItemId: item.id, tweetId, payload })
    .onConflictDoUpdate({
      target: [xPostCache.contentItemId, xPostCache.tweetId],
      set: { payload, fetchedAt: new Date() },
    });
}

function toStored(record: CommentRecord, images: StoredPost['images']): StoredPost {
  return {
    platformId: record.platformCommentId,
    author: record.author,
    text: record.text,
    postedAt: record.postedAt || null,
    likes: record.likes,
    replyCount: record.replyCount,
    images,
    videos: record.videos,
  };
}

/** The opened tweet as a comment-shaped record (so its images go the same way). */
function selfComment(content: FetchedContent): Comment {
  return {
    id: content.sourceId,
    content: content.body,
    author: content.author,
    createdAt: content.publishedAt,
    stats: { likes: content.stats.likes, replies: content.stats.comments },
    images: content.media.filter((m) => m.type === 'image').map((m) => m.originalUrl),
    videos: content.media.filter((m) => m.type === 'video').map((m) => m.originalUrl),
  };
}

/** The tweet as stored by its own mirror, if it has one: no fetch, no upload. */
async function fromMirror(tweetId: string): Promise<XPostCachePayload | null> {
  const [mirror] = await db
    .select()
    .from(contentItems)
    .where(and(eq(contentItems.platform, 'x'), eq(sql`${contentItems.platformData}->>'sourceId'`, tweetId)))
    .limit(1);
  if (!mirror) return null;
  const [mediaRows, commentRows] = await Promise.all([
    db.select().from(media).where(eq(media.contentItemId, mirror.id)),
    db.select().from(comments).where(eq(comments.contentItemId, mirror.id)),
  ]);
  const stats = mirror.stats as { likes?: number; comments?: number } | null;
  const thread = readThread(mirror.platformData);
  return {
    post: {
      platformId: tweetId,
      sourceUrl: mirror.sourceUrl ?? statusUrl(tweetId),
      author: mirror.author as StoredPost['author'],
      text: mirror.body,
      postedAt: mirror.publishedAt?.toISOString() ?? null,
      likes: stats?.likes ?? 0,
      replyCount: stats?.comments ?? 0,
      images: mediaRows.filter((m) => m.type === 'image').map((m) => ({ originalUrl: m.originalUrl, blobUrl: m.blobUrl })),
      videos: mediaRows.filter((m) => m.type === 'video').map((m) => m.originalUrl),
    },
    parents: thread?.parents ?? [],
    parentMissing: thread?.parentMissing ?? null,
    replies: commentRows
      .filter((c) => c.retained && c.platformCommentId)
      .map((c) => ({
        platformId: c.platformCommentId!,
        author: c.author as StoredPost['author'],
        text: c.text,
        postedAt: c.postedAt?.toISOString() ?? null,
        likes: c.likes ?? 0,
        replyCount: c.replyCount,
        images: c.images,
        inReplyTo: c.inReplyTo ?? tweetId,
      })),
  };
}

/** Open a tweet from this mirror's thread: the stored copy, or fetch and store it. */
export async function openPost(item: ContentItemRow, tweetId: string): Promise<OpenPostResult> {
  if (item.platform !== 'x') return { ok: false, status: 404, error: 'not_found' };
  const cached = await readCached(item, tweetId);
  if (cached) return { ok: true, payload: cached };
  if (!(await reachableIds(item)).has(tweetId)) return { ok: false, status: 404, error: 'not_in_mirror' };

  const mirrored = await fromMirror(tweetId);
  if (mirrored) {
    await saveCached(item, tweetId, mirrored);
    return { ok: true, payload: mirrored };
  }

  let content: FetchedContent;
  try {
    content = await fetchContent(statusUrl(tweetId));
  } catch {
    return { ok: false, status: 502, error: 'fetch_failed' };
  }

  const parents = content.thread?.parents ?? [];
  // One records list so every image is downloaded once: self, parents, replies.
  const selfRecord = buildCommentRecords([selfComment(content)], [content.sourceId]);
  const parentRecords = buildCommentRecords(parents, parents.map((p) => p.id));
  const replyRecords = buildCommentRecords(content.comments, content.comments.map((c) => c.id));
  const all = [...selfRecord, ...parentRecords, ...replyRecords];
  const images = await storeCommentImages(all);
  const stored = all.map((r, i) => toStored(r, images[i]!));

  const payload: XPostCachePayload = {
    post: { ...stored[0]!, sourceUrl: content.sourceUrl },
    parents: stored.slice(1, 1 + parentRecords.length),
    parentMissing: content.thread?.parentMissing ?? null,
    replies: stored.slice(1 + parentRecords.length).map((post, i) => ({
      ...post,
      inReplyTo: replyRecords[i]!.inReplyTo ?? tweetId,
    })),
  };

  await saveCached(item, tweetId, payload);
  return { ok: true, payload };
}
