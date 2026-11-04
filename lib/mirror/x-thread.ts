// lib/mirror/x-thread.ts
// X thread context stored with a mirror: the tweets the post replies to.
//
// The chain lives in content_items.platform_data.xThread rather than in the
// comments table, because it sits above the post, not under it. Its images are
// copied to Blob the same way comment images are.

import type { Author, FetchedContent, XThread } from '@/lib/fetcher/types';
import type { CommentImage } from '@/lib/db/schema';
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
}

export interface StoredThread {
  /** Root first; the last entry is the tweet the mirrored post answers. */
  parents: StoredPost[];
  /** Next tweet up when the stored chain does not reach a root. */
  parentMissing: string | null;
}

/** Download the chain's images and shape it for platform_data. */
export async function storeThread(thread: XThread): Promise<StoredThread> {
  const records = buildCommentRecords(thread.parents, thread.parents.map((p) => p.id));
  const images = await storeCommentImages(records);
  return {
    parents: records.map((r, i) => ({
      platformId: r.platformCommentId,
      author: r.author,
      text: r.text,
      postedAt: r.postedAt || null,
      likes: r.likes,
      replyCount: r.replyCount,
      images: images[i]!,
    })),
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
