// lib/mirror/x-thread-expand.ts
// Loading more of an X thread when a visitor asks for it.
//
// A mirror stores the parent chain and the replies X returns with the post (two
// levels). Deeper replies, and parents beyond a chain that stopped short, are
// fetched here on demand and written back into the mirror, so the next visitor
// reads them from the database instead of fetching again.

import { and, eq } from 'drizzle-orm';
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


/** Every stored comment of the item that sits below `rootId`, at any depth. */
async function storedSubtree(contentItemId: string, rootId: string): Promise<ThreadNode[]> {
  const rows = await db.select().from(comments).where(eq(comments.contentItemId, contentItemId));
  const children = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!row.inReplyTo) continue;
    children.set(row.inReplyTo, [...(children.get(row.inReplyTo) ?? []), row]);
  }
  const subtree: typeof rows = [];
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
 * arbitrary tweets.
 */
export async function expandReplies(item: ContentItemRow, commentId: string): Promise<ExpandResult> {
  const [target] = await db
    .select({ id: comments.id })
    .from(comments)
    .where(and(eq(comments.contentItemId, item.id), eq(comments.platformCommentId, commentId)))
    .limit(1);
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

  const existing = new Set(
    (
      await db
        .select({ platformCommentId: comments.platformCommentId })
        .from(comments)
        .where(eq(comments.contentItemId, item.id))
    ).map((r) => r.platformCommentId),
  );
  const records = buildCommentRecords(content.comments, content.comments.map((c) => c.id))
    // A reply to the expanded comment comes back as top level; attach it.
    .map((r) => ({ ...r, inReplyTo: r.inReplyTo ?? commentId }))
    .filter((r) => !existing.has(r.platformCommentId));
  const images = await storeCommentImages(records);

  await db.transaction(async (tx) => {
    for (const [index, record] of records.entries()) {
      await tx.insert(comments).values({
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
      });
    }
    await tx
      .update(comments)
      .set({ replyCount: content.stats.comments })
      .where(eq(comments.id, target.id));
  });

  return { ok: true, nodes: await storedSubtree(item.id, commentId) };
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
