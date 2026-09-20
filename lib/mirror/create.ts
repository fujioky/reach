// lib/mirror/create.ts
// Mirror creation, shared by the admin wizard (the createMirror Server Action)
// and the quick-share API the browser extension calls.
//
// Order matters:
//   1. Re-fetch the post from the URL rather than accept content from the
//      caller — agent-reach caches, and a Server Action body is capped ~1MB.
//   2. Download images to Blob OUTSIDE the transaction, so no IO happens while
//      it holds a connection. A failed image is a warning, not a rollback.
//   3. One quick transaction: content_items + media + comments + the first
//      share link + the v0 snapshot, so a mirror never exists without them.
// Uploading videos to the storage backend can take minutes, so it is a
// separate step (uploadMirrorVideos): the wizard awaits it, the API runs it
// after the response.
//
// SSRF: fetch URLs are limited to the platform whitelist (platformUrlSchema)
// before anything is requested server-side.

import { z } from 'zod';
import { and, eq } from 'drizzle-orm';

import { db, contentItems, media, comments, shares, mirrorVersions } from '@/lib/db';
import { fetchContent } from '@/lib/fetcher';
import { FetcherError } from '@/lib/fetcher/errors';
import type { FetchedContent, MediaItem } from '@/lib/fetcher/types';
import { downloadImageToBlob } from '@/lib/blob/download-image';
import { buildCommentRecords } from '@/lib/mirror/comments';
import { createSnapshot } from '@/lib/mirror/versioning';
import { evaluateQuota, getStorageUsage, LIMITS } from '@/lib/quota';
import { getSetting } from '@/lib/settings';
import { generateShareToken } from '@/lib/share/token';
import { downloadAndUploadVideo, videoStorageKey, type S3Config } from '@/lib/storage/s3';
import { resolveVideoFetchUrl } from '@/lib/video/playback-url';

export const platformUrlSchema = z
  .string()
  .url()
  .refine(
    (url) =>
      /^https?:\/\/(twitter\.com|x\.com|t\.co|(?:(?:www|m)\.)?youtube\.com|youtu\.be)\//i.test(
        url,
      ),
    'URL must be from twitter.com, x.com, t.co, youtube.com, or youtu.be',
  );

/** Per-link access control. Null / absent fields mean no limit. */
export const accessControlSchema = z.object({
  expiresAt: z.string().datetime().nullable().optional(),
  maxViews: z.number().int().positive().nullable().optional(),
  maxUniqueVisitors: z.number().int().positive().nullable().optional(),
  burnAfterRead: z.boolean().optional(),
});

export type AccessControlInput = z.infer<typeof accessControlSchema>;

/** Insert an active share link for a content item and return its token. */
export async function insertShare(
  executor: Pick<typeof db, 'insert'>,
  contentItemId: string,
  accessControl: AccessControlInput | undefined,
): Promise<string> {
  const token = generateShareToken(); // nanoid 21 chars, ~126 bits
  await executor.insert(shares).values({
    token,
    contentItemId,
    status: 'active',
    // Enforced at view time by checkAccess().
    expiresAt: accessControl?.expiresAt ? new Date(accessControl.expiresAt) : null,
    maxViews: accessControl?.maxViews ?? null,
    maxUniqueVisitors: accessControl?.maxUniqueVisitors ?? null,
    burnAfterRead: accessControl?.burnAfterRead ?? false,
    viewCount: 0,
    uniqueVisitorCount: 0,
  });
  return token;
}

export type CreateMirrorStage =
  | { phase: 'fetching' }
  | { phase: 'images'; done: number; total: number }
  | { phase: 'saving' };

export type CreateMirrorOutcome =
  | {
      ok: true;
      mirrorId: string;
      shareToken: string;
      content: FetchedContent;
      warnings: string[];
    }
  | {
      ok: false;
      error: string;
      /** FetcherError kind when the upstream fetch is what failed. */
      kind?: string;
      warnings: string[];
    };

export async function createMirrorFromUrl(input: {
  url: string;
  /** Top-level comment IDs to retain (replies follow their parent); null retains all. */
  selectedCommentIds: string[] | null;
  accessControl?: AccessControlInput;
  createdBy: string | null;
  onStage?: (stage: CreateMirrorStage) => void;
}): Promise<CreateMirrorOutcome> {
  const { url, accessControl, createdBy, onStage } = input;
  const warnings: string[] = [];

  onStage?.({ phase: 'fetching' });
  let content: FetchedContent;
  try {
    content = await fetchContent(url);
  } catch (err) {
    return {
      ok: false,
      error: (err as Error).message,
      kind: err instanceof FetcherError ? err.kind : undefined,
      warnings,
    };
  }

  // Quota is warn-only, never blocks. Images carry no size until downloaded,
  // so only the total-usage check is meaningful before the download.
  const usedBytes = await getStorageUsage();
  const preDownloadQuota = evaluateQuota({ usedBytes, mirrorImageBytes: 0, largestImageBytes: 0 });
  if (preDownloadQuota.warnings.totalQuota) {
    warnings.push(
      `Total storage usage (${usedBytes} bytes) exceeds quota limit (${LIMITS.totalQuota} bytes).`,
    );
  }

  const imageItems = content.media.filter((m) => m.type === 'image');
  const imageDownloads: Array<{ mediaItem: MediaItem; blobUrl: string | null; size: number }> = [];
  let totalImageBytes = 0;
  let largestImageBytes = 0;

  for (const imgItem of imageItems) {
    onStage?.({ phase: 'images', done: imageDownloads.length, total: imageItems.length });
    try {
      const result = await downloadImageToBlob(imgItem.originalUrl);
      imageDownloads.push({ mediaItem: imgItem, blobUrl: result.blobUrl, size: result.size });
      totalImageBytes += result.size;
      if (result.size > largestImageBytes) largestImageBytes = result.size;
    } catch (err) {
      imageDownloads.push({ mediaItem: imgItem, blobUrl: null, size: 0 });
      warnings.push(
        `Image download failed for ${imgItem.originalUrl}: ${(err as Error).message}`,
      );
    }
  }

  const postDownloadQuota = evaluateQuota({
    usedBytes,
    mirrorImageBytes: totalImageBytes,
    largestImageBytes,
  });
  if (postDownloadQuota.warnings.perImage) {
    warnings.push(
      `Largest image (${largestImageBytes} bytes) exceeds per-image limit (${LIMITS.perImage} bytes).`,
    );
  }
  if (postDownloadQuota.warnings.perMirror) {
    warnings.push(
      `Mirror total images (${totalImageBytes} bytes) exceeds per-mirror limit (${LIMITS.perMirror} bytes).`,
    );
  }

  onStage?.({ phase: 'saving' });
  const selectedCommentIds = input.selectedCommentIds ?? content.comments.map((c) => c.id);

  try {
    const result = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(contentItems)
        .values({
          type: 'mirror',
          sourceUrl: content.sourceUrl,
          platform: content.platform,
          title: content.title,
          author: content.author,
          publishedAt: content.publishedAt ? new Date(content.publishedAt) : null,
          body: content.body,
          stats: content.stats,
          platformData: content.platformData,
          fetchedAt: content.fetchedAt ? new Date(content.fetchedAt) : null,
          createdBy,
        })
        .returning({ id: contentItems.id });

      const contentItemId = inserted!.id;

      for (const item of content.media) {
        if (item.type === 'image') {
          const download = imageDownloads.find((d) => d.mediaItem === item);
          await tx.insert(media).values({
            contentItemId,
            type: 'image',
            originalUrl: item.originalUrl,
            blobUrl: download?.blobUrl ?? null,
            size: download?.size ?? 0,
            meta: null,
          });
        } else if (item.type === 'video') {
          // Videos are not copied to Blob: the row keeps the googlevideo URL,
          // and fetchedAt tells the player when that URL has expired.
          await tx.insert(media).values({
            contentItemId,
            type: 'video',
            originalUrl: item.originalUrl,
            blobUrl: null,
            size: item.filesize ?? null,
            meta: {
              selectedSource: item.selectedSource ?? null,
              fetchedAt: content.fetchedAt,
            },
          });
        }
      }

      // Every comment is stored; `retained` marks the ones shown to visitors.
      for (const record of buildCommentRecords(content.comments, selectedCommentIds)) {
        await tx.insert(comments).values({
          contentItemId,
          platformCommentId: record.platformCommentId,
          author: record.author,
          text: record.text,
          postedAt: record.postedAt ? new Date(record.postedAt) : null,
          likes: record.likes,
          retained: record.retained,
        });
      }

      const shareToken = await insertShare(tx, contentItemId, accessControl);

      // v0 lets a later refresh roll back all the way to the original fetch.
      const initialSnapshot = await createSnapshot(contentItemId, tx);
      await tx.insert(mirrorVersions).values({
        contentItemId,
        versionNumber: 0,
        snapshot: initialSnapshot,
      });

      return { contentItemId, shareToken };
    });

    return {
      ok: true,
      mirrorId: result.contentItemId,
      shareToken: result.shareToken,
      content,
      warnings,
    };
  } catch (err) {
    return {
      ok: false,
      error: `Database write failed: ${(err as Error).message}`,
      warnings,
    };
  }
}

async function loadS3Config(): Promise<S3Config | null> {
  const endpoint = await getSetting('video_storage_endpoint');
  const region = await getSetting('video_storage_region');
  const bucket = await getSetting('video_storage_bucket');
  const accessKey = await getSetting('video_storage_access_key');
  const secretKey = await getSetting('video_storage_secret_key');
  if (!endpoint || !bucket || !accessKey || !secretKey) return null;
  return {
    endpoint,
    region,
    bucket,
    accessKeyId: accessKey,
    secretAccessKey: secretKey,
  };
}

/**
 * Copy a mirror's videos to the storage backend when one is enabled. Failures
 * come back as warnings: an unstored video still plays through the proxy.
 */
export async function uploadMirrorVideos(mirrorId: string): Promise<string[]> {
  if ((await getSetting('video_storage_enabled')) !== 'true') return [];
  const s3Config = await loadS3Config();
  if (!s3Config) return [];

  const warnings: string[] = [];
  const videoRows = await db
    .select()
    .from(media)
    .where(and(eq(media.contentItemId, mirrorId), eq(media.type, 'video')));
  for (const row of videoRows) {
    if (row.blobUrl) continue;
    const key = videoStorageKey(row.originalUrl);
    const upload = await downloadAndUploadVideo(
      s3Config,
      s3Config.bucket,
      await resolveVideoFetchUrl(row.originalUrl),
      key,
    );
    if (upload.ok) {
      await db.update(media).set({ blobUrl: key }).where(eq(media.id, row.id));
    } else {
      warnings.push(`视频存储上传失败: ${upload.error}`);
    }
  }
  return warnings;
}
