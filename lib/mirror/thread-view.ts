// lib/mirror/thread-view.ts
// Shapes stored X posts (comments and the parent chain) for the visitor page.
// The client gets a flat list and builds the reply tree from `inReplyTo`, so
// replies loaded later merge in the same way as the ones rendered first.

import { presignImage } from '@/lib/blob/presign';
import type { CommentImage } from '@/lib/db/schema';

export interface ThreadNodeAuthor {
  name: string;
  handle: string;
  avatarUrl?: string;
}

export interface ThreadNode {
  /** Platform id (tweet id): the key replies point at with `inReplyTo`. */
  id: string;
  /** Platform id of the post this answers; null for a top-level comment. */
  inReplyTo: string | null;
  author: ThreadNodeAuthor;
  text: string;
  /** Presigned image URLs. */
  images: string[];
  /** Playable video URLs (through /api/x-thread/video). */
  videos: string[];
  /** Platform-reported reply count; more than the loaded children means more can be fetched. */
  replyCount: number;
  /** Server-prefetched translations from the DB cache. */
  initialTranslations: Record<string, string>;
}

export interface StoredNodeInput {
  platformId: string;
  inReplyTo: string | null;
  author: unknown;
  text: string;
  images: CommentImage[];
  /** X video URLs as stored; turned into playable URLs by `videoSrc`. */
  videos?: string[];
  replyCount: number;
}

/** Builds the playable URL for video `index` of tweet `postId`. */
export type VideoSrc = (postId: string, index: number) => string;

/** Videos of thread posts play through /api/x-thread/video under the share. */
export function threadVideoSrc(token: string): VideoSrc {
  return (postId, index) =>
    `/api/x-thread/video?token=${encodeURIComponent(token)}&post=${encodeURIComponent(postId)}&i=${index}`;
}

/** Presign every stored image once and build the nodes, in input order. */
export async function toThreadNodes(
  rows: StoredNodeInput[],
  translations: Map<string, string> = new Map(),
  videoSrc?: VideoSrc,
): Promise<ThreadNode[]> {
  const blobUrls = [...new Set(rows.flatMap((r) => r.images.flatMap((img) => img.blobUrl ?? [])))];
  const presigned = new Map<string, string>();
  const results = await Promise.allSettled(blobUrls.map((url) => presignImage(url)));
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') presigned.set(blobUrls[i]!, r.value);
  });

  const seen = new Set<string>();
  return rows.flatMap((r) => {
    // Two visitors expanding the same reply at once can store it twice.
    if (seen.has(r.platformId)) return [];
    seen.add(r.platformId);
    const cached = translations.get(r.text);
    return [
      {
        id: r.platformId,
        inReplyTo: r.inReplyTo,
        author: r.author as ThreadNodeAuthor,
        text: r.text,
        images: r.images.flatMap((img) => {
          const src = img.blobUrl ? presigned.get(img.blobUrl) : undefined;
          return src ? [src] : [];
        }),
        videos: videoSrc ? (r.videos ?? []).map((_, i) => videoSrc(r.platformId, i)) : [],
        replyCount: r.replyCount,
        initialTranslations: cached ? { [r.text]: cached } : {},
      },
    ];
  });
}
