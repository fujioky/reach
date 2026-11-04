// lib/mirror/comment-images.ts
// Copies the images attached to comments into Blob, the same way post images
// are copied, so a mirror keeps showing them after the platform URL goes away.

import { downloadImageToBlob } from '@/lib/blob/download-image';
import type { CommentImage } from '@/lib/db/schema';
import type { CommentRecord } from '@/lib/mirror/comments';

const CONCURRENCY = 4;

/**
 * Download every comment image once (URLs shared across comments are fetched
 * a single time) and return the stored images per record, index-aligned with
 * `records`. A failed download keeps its originalUrl with blobUrl null.
 */
export async function storeCommentImages(records: CommentRecord[]): Promise<CommentImage[][]> {
  const urls = [...new Set(records.flatMap((r) => r.images))];
  const blobUrls = new Map<string, string | null>();

  let next = 0;
  async function worker() {
    while (next < urls.length) {
      const url = urls[next++]!;
      try {
        blobUrls.set(url, (await downloadImageToBlob(url)).blobUrl);
      } catch {
        blobUrls.set(url, null);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, urls.length) }, worker));

  return records.map((r) =>
    r.images.map((originalUrl) => ({ originalUrl, blobUrl: blobUrls.get(originalUrl) ?? null })),
  );
}
