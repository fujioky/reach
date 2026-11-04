// lib/mirror/x-thread-expand.ts
// Loading more of an X thread when a visitor asks for it.
//
// A mirror stores the parent chain and the replies X returns with the post (two
// levels). Deeper replies, and parents beyond a chain that stopped short, are
// fetched here on demand and written back into the mirror, so the next visitor
// reads them from the database instead of fetching again.

import { eq } from 'drizzle-orm';
import { db, comments, contentItems } from '@/lib/db';
import { fetchContent } from '@/lib/fetcher';
import type { Comment, FetchedContent } from '@/lib/fetcher/types';
import { buildCommentRecords } from '@/lib/mirror/comments';
import { storeCommentImages } from '@/lib/mirror/comment-images';
import { readThread, storeThread } from '@/lib/mirror/x-thread';
import { openPost, statusUrl } from '@/lib/mirror/x-post-cache';
import { toThreadNodes, type ThreadNode } from '@/lib/mirror/thread-view';

type ContentItemRow = typeof contentItems.$inferSelect;

export type ExpandResult =
  | { ok: true; nodes: ThreadNode[]; parentMissing?: string | null }
  | { ok: false; status: number; error: string };


type CommentRow = typeof comments.$inferSelect;

/** Rows below `rootId` at any depth, as visitor-page nodes. */
async function subtreeNodes(rows: CommentRow[], rootId: string): Promise<ThreadNode[]> {
  const children = new Map<string, CommentRow[]>();
  for (const row of rows) {
    if (!row.inReplyTo) continue;
    children.set(row.inReplyTo, [...(children.get(row.inReplyTo) ?? []), row]);
  }
  const subtree: CommentRow[] = [];
  const queue = [rootId];
  while (queue.length > 0) {
    for (const row of children.get(queue.shift()!) ?? []) {
      subtree.push(row);
      if (row.platformCommentId) queue.push(row.platformCommentId);
    }
  }
  return toThreadNodes(
    subtree.map((r) => ({
      platformId: r.platformCommentId ?? r.id,
      inReplyTo: r.inReplyTo,
      author: r.author,
      text: r.text,
      images: r.images,
      replyCount: r.replyCount,
    })),
  );
}

/**
 * Load the replies under one stored comment. Only a comment that belongs to
 * this mirror can be expanded, so the endpoint cannot be used to fetch
 * arbitrary tweets. Three queries whatever the size of the thread: read the
 * mirror's comments, insert the new replies in one statement, update the count.
 */
export async function expandReplies(item: ContentItemRow, commentId: string): Promise<ExpandResult> {
  const rows = await db.select().from(comments).where(eq(comments.contentItemId, item.id));
  const target = rows.find((r) => r.platformCommentId === commentId);
  // Not one of the mirror's own comments: a reply shown on an opened post's
  // page. Its replies come from opening it (cached in x_post_cache).
  if (!target) {
    const opened = await openPost(item, commentId);
    if (!opened.ok) return opened;
    return { ok: true, nodes: await toThreadNodes(opened.payload.replies) };
  }

  let content: FetchedContent;
  try {
    content = await fetchContent(statusUrl(commentId));
  } catch {
    return { ok: false, status: 502, error: 'fetch_failed' };
  }

  const existing = new Set(rows.map((r) => r.platformCommentId));
  const records = buildCommentRecords(content.comments, content.comments.map((c) => c.id))
    // A reply to the expanded comment comes back as top level; attach it.
    .map((r) => ({ ...r, inReplyTo: r.inReplyTo ?? commentId }))
    .filter((r) => !existing.has(r.platformCommentId));
  const images = await storeCommentImages(records);

  const inserted =
    records.length === 0
      ? []
      : await db
          .insert(comments)
          .values(
            records.map((record, index) => ({
              contentItemId: item.id,
              platformCommentId: record.platformCommentId,
              author: record.author,
              text: record.text,
              postedAt: record.postedAt ? new Date(record.postedAt) : null,
              likes: record.likes,
              retained: true,
              images: images[index]!,
              inReplyTo: record.inReplyTo,
              replyCount: record.replyCount,
            })),
          )
          .returning();
  const all = [...rows, ...inserted];
  // What X actually returned is the reply count from now on: a reply it counts
  // but no longer shows (deleted, hidden) is not fetched again by every visitor.
  const direct = all.filter((r) => r.inReplyTo === commentId).length;
  await db.update(comments).set({ replyCount: direct }).where(eq(comments.id, target.id));
  target.replyCount = direct;

  return { ok: true, nodes: await subtreeNodes(all, commentId) };
}

const PREFETCH_LIMIT = 12;
const PREFETCH_CONCURRENCY = 3;
const prefetching = new Set<string>();

/**
 * Fetch the replies of top-level comments X says have some but the mirror
 * stores none, so visitors see each comment's first reply without waiting.
 * Run in the background (after()) on create, refresh and visitor page views;
 * each run handles a batch, and what it stores is read by every later visitor.
 */
export async function prefetchMissingReplies(contentItemId: string): Promise<void> {
  if (prefetching.has(contentItemId)) return;
  prefetching.add(contentItemId);
  try {
    const [item] = await db.select().from(contentItems).where(eq(contentItems.id, contentItemId)).limit(1);
    if (!item || item.platform !== 'x') return;
    const rows = await db
      .select({ platformCommentId: comments.platformCommentId, inReplyTo: comments.inReplyTo, replyCount: comments.replyCount })
      .from(comments)
      .where(eq(comments.contentItemId, contentItemId));
    const withChildren = new Set(rows.map((r) => r.inReplyTo).filter(Boolean));
    // Top-level comments only: the default view shows each one with its first
    // reply. Deeper levels load when a reader asks, so a busy thread is not
    // crawled a level further on every page view.
    const missing = rows
      .filter((r) => !r.inReplyTo && r.platformCommentId && r.replyCount > 0 && !withChildren.has(r.platformCommentId))
      .slice(0, PREFETCH_LIMIT)
      .map((r) => r.platformCommentId!);
    let next = 0;
    async function worker() {
      while (next < missing.length) {
        await expandReplies(item!, missing[next++]!).catch(() => undefined);
      }
    }
    await Promise.all(Array.from({ length: Math.min(PREFETCH_CONCURRENCY, missing.length) }, worker));
  } finally {
    prefetching.delete(contentItemId);
  }
}

/**
 * Load the tweets above a parent chain that stopped short of its root. Only
 * the chain's own `parentMissing` id is accepted.
 */
export async function expandParents(item: ContentItemRow, tweetId: string): Promise<ExpandResult> {
  const thread = readThread(item.platformData);
  if (!thread || thread.parentMissing !== tweetId) return { ok: false, status: 404, error: 'not_in_mirror' };

  let content: FetchedContent;
  try {
    content = await fetchContent(statusUrl(tweetId));
  } catch {
    return { ok: false, status: 502, error: 'fetch_failed' };
  }

  // The fetched tweet itself is the next parent up; its own chain sits above it.
  const self: Comment = {
    id: content.sourceId,
    content: content.body,
    author: content.author,
    createdAt: content.publishedAt,
    stats: { likes: content.stats.likes, replies: content.stats.comments },
    images: content.media.filter((m) => m.type === 'image').map((m) => m.originalUrl),
  };
  const above = await storeThread({
    parents: [...(content.thread?.parents ?? []), self],
    parentMissing: content.thread?.parentMissing ?? null,
  });
  const merged = { parents: [...above.parents, ...thread.parents], parentMissing: above.parentMissing };

  await db
    .update(contentItems)
    .set({ platformData: { ...(item.platformData as object), xThread: merged } })
    .where(eq(contentItems.id, item.id));

  return {
    ok: true,
    nodes: await toThreadNodes(above.parents.map((p) => ({ ...p, inReplyTo: null }))),
    parentMissing: merged.parentMissing,
  };
}
