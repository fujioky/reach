// lib/mirror/refresh.ts
// Plan 05-03, Task 3 — refreshMirror() re-fetch + change detection + snapshot (D-53).
//
// Flow (Pitfall 4 — snapshot BEFORE writing):
// 1. Read contentItem to get sourceUrl
// 2. Snapshot current state BEFORE any changes (Pitfall 4)
// 3. Re-fetch content from agent-reach
// 4. Detect substantial change (body/comments/media only — Pitfall 5)
// 5. If NOT changed: update only stats + refreshedAt, return { changed: false }
// 6. If changed: create new version snapshot, insert, prune to 3
// 7. Download new images to Blob OUTSIDE the transaction (Anti-Pattern)
// 8. Write new data in db.transaction (contentItems + media + comments)
// 9. Return { changed: true, version: nextVersion }
//
// CRITICAL Pitfall 4: snapshot is taken BEFORE any writes, so the pre-refresh
//   state is preserved for rollback.
// CRITICAL Anti-Pattern: downloadImageToBlob is called OUTSIDE db.transaction
//   (same pattern as createMirror — Review #1). No IO inside the transaction.
//
// Old Blob images are NOT deleted (research Open Question 2 — deferred to v2;
// old images stay in Blob). This is noted as tech debt.

import { eq, sql, and, gt } from 'drizzle-orm';
import { db, contentItems, media, comments, mirrorVersions, refreshPreviews } from '@/lib/db';
import { fetchContent } from '@/lib/fetcher';
import { downloadImageToBlob } from '@/lib/blob/download-image';
import { buildCommentRecords } from '@/lib/mirror/comments';
import {
  createSnapshot,
  detectSubstantialChange,
  pruneVersions,
} from '@/lib/mirror/versioning';
import { getSetting } from '@/lib/settings';
import { downloadAndUploadVideo, videoStorageKey } from '@/lib/storage/s3';
import { resolveVideoFetchUrl } from '@/lib/video/playback-url';
import type { FetchedContent, MediaItem } from '@/lib/fetcher/types';

export interface RefreshMirrorResult {
  changed: boolean;
  version?: number;
  error?: string;
}

/**
 * Refresh a mirror by re-fetching content, comments, and media from the
 * source. If a substantial change is detected (body/comments/media), a new
 * version snapshot is created. Stats-only changes update without a new
 * version (Pitfall 5). At most 3 versions are retained (prune).
 *
 * SSRF note: re-fetch uses the existing sourceUrl from content_items
 * (already validated at createMirror time with platform whitelist).
 */
export async function refreshMirror(
  contentItemId: string,
): Promise<RefreshMirrorResult> {
  // 1. Read the contentItem to get the sourceUrl
  const [item] = await db
    .select()
    .from(contentItems)
    .where(eq(contentItems.id, contentItemId))
    .limit(1);
  if (!item) {
    return { changed: false, error: 'Mirror not found' };
  }
  if (!item.sourceUrl) {
    return { changed: false, error: 'Mirror has no source URL' };
  }

  // 1b. Guard: if source_url is a media URL (Phase 3 data bug — agent-reach
  // sometimes returned media URLs as item.url), reconstruct the canonical
  // post URL from platformData.sourceId + author.handle.
  let fetchUrl = item.sourceUrl;
  const isMediaUrl = /twimg\.com|video\.twimg/i.test(item.sourceUrl);
  if (isMediaUrl) {
    const sourceId = (item.platformData as { sourceId?: string } | null)?.sourceId;
    const authorHandle = (item.author as { handle?: string } | null)?.handle;
    if (sourceId && authorHandle) {
      if (item.platform === 'youtube') {
        fetchUrl = `https://www.youtube.com/watch?v=${sourceId}`;
      } else {
        fetchUrl = `https://x.com/${authorHandle}/status/${sourceId}`;
      }
      // Persist the corrected URL so future refreshes don't need reconstruction
      await db
        .update(contentItems)
        .set({ sourceUrl: fetchUrl })
        .where(eq(contentItems.id, contentItemId));
    } else {
      return {
        changed: false,
        error: 'Mirror source URL is a media URL and cannot be reconstructed (missing sourceId or author handle)',
      };
    }
  }

  // 2. Snapshot current state BEFORE any changes (Pitfall 4)
  const snapshot = await createSnapshot(contentItemId);

  // 3. Re-fetch content from agent-reach
  let content: FetchedContent;
  try {
    content = await fetchContent(fetchUrl);
  } catch (err) {
    return {
      changed: false,
      error: `Re-fetch failed: ${(err as Error).message}`,
    };
  }

  // 4. Detect substantial change (body/comments/media only — Pitfall 5)
  const hasChanged = detectSubstantialChange(snapshot, content);

  // 5. If NOT changed: update only stats + platformData + refreshedAt (no new
  //    version). platformData is excluded from substantial-change detection,
  //    so a refresh that only picks up a new transcript would otherwise be
  //    silently dropped here.
  if (!hasChanged) {
    await db
      .update(contentItems)
      .set({
        stats: content.stats,
        platformData: content.platformData,
        refreshedAt: new Date(),
      })
      .where(eq(contentItems.id, contentItemId));
    return { changed: false };
  }

  // 6. If changed: create a new version snapshot
  const maxVersionRows = await db
    .select({
      max: sql`COALESCE(MAX(${mirrorVersions.versionNumber}), 0)`.as('max'),
    })
    .from(mirrorVersions)
    .where(eq(mirrorVersions.contentItemId, contentItemId));
  const nextVersion = (maxVersionRows[0]?.max as number) + 1;

  await db.insert(mirrorVersions).values({
    contentItemId,
    versionNumber: nextVersion,
    snapshot,
  });

  // Prune to 3 versions (D-53)
  await pruneVersions(contentItemId, 3);

  // 7. Download new images to Blob OUTSIDE the transaction (Anti-Pattern)
  //    Old Blob images are NOT deleted (deferred to v2 — tech debt).
  const imageMediaItems = content.media.filter((m) => m.type === 'image');
  const imageDownloads: Array<{
    mediaItem: MediaItem;
    blobUrl: string | null;
    size: number;
  }> = [];

  for (const imgItem of imageMediaItems) {
    try {
      const result = await downloadImageToBlob(imgItem.originalUrl);
      imageDownloads.push({
        mediaItem: imgItem,
        blobUrl: result.blobUrl,
        size: result.size,
      });
    } catch {
      // Partial failure: record as null, continue (don't rollback entire refresh)
      imageDownloads.push({
        mediaItem: imgItem,
        blobUrl: null,
        size: 0,
      });
    }
  }

  // 8. Write new data in db.transaction (contentItems + media + comments)
  //    Follow the createMirror transaction pattern exactly.
  try {
    await db.transaction(async (tx) => {
      // 8a. Update contentItems
      await tx
        .update(contentItems)
        .set({
          title: content.title,
          body: content.body,
          author: content.author,
          publishedAt: content.publishedAt ? new Date(content.publishedAt) : null,
          stats: content.stats,
          platformData: content.platformData,
          fetchedAt: content.fetchedAt ? new Date(content.fetchedAt) : null,
          refreshedAt: new Date(),
        })
        .where(eq(contentItems.id, contentItemId));

      // 8b. Delete old media rows and insert new ones
      await tx.delete(media).where(eq(media.contentItemId, contentItemId));
      for (const m of content.media) {
        if (m.type === 'image') {
          const download = imageDownloads.find((d) => d.mediaItem === m);
          await tx.insert(media).values({
            contentItemId,
            type: 'image',
            originalUrl: m.originalUrl,
            blobUrl: download?.blobUrl ?? null,
            size: download?.size ?? 0,
            meta: null,
          });
        } else if (m.type === 'video') {
          await tx.insert(media).values({
            contentItemId,
            type: 'video',
            originalUrl: m.originalUrl,
            blobUrl: null,
            size: m.filesize ?? null,
            meta: {
              selectedSource: m.selectedSource ?? null,
              fetchedAt: content.fetchedAt,
            },
          });
        }
      }

      // 8c. Delete old comments and insert new ones
      //     Refresh retains ALL comments (all comment IDs selected)
      const allCommentIds = content.comments.map((c) => c.id);
      const commentRecords = buildCommentRecords(content.comments, allCommentIds);
      await tx.delete(comments).where(eq(comments.contentItemId, contentItemId));
      for (const record of commentRecords) {
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
    });
  } catch (err) {
    return {
      changed: false,
      error: `Database write failed: ${(err as Error).message}`,
    };
  }

  // 9. Upload videos to storage backend (non-blocking)
  await uploadVideosToStorage(contentItemId);

  // 10. Return success with the new version number
  return { changed: true, version: nextVersion };
}

// ─── Helper: upload videos to the configured S3/R2 backend ───────────────
async function uploadVideosToStorage(contentItemId: string): Promise<string[]> {
  const enabled = (await getSetting('video_storage_enabled')) === 'true';
  if (!enabled) return [];

  const endpoint = await getSetting('video_storage_endpoint');
  const region = await getSetting('video_storage_region');
  const bucket = await getSetting('video_storage_bucket');
  const accessKey = await getSetting('video_storage_access_key');
  const secretKey = await getSetting('video_storage_secret_key');
  if (!endpoint || !bucket || !accessKey || !secretKey) return [];

  const config = { endpoint, region, bucket, accessKeyId: accessKey, secretAccessKey: secretKey };
  const videoRows = await db
    .select()
    .from(media)
    .where(and(eq(media.contentItemId, contentItemId), eq(media.type, 'video')));

  const warnings: string[] = [];
  for (const row of videoRows) {
    if (row.blobUrl) continue;
    const key = videoStorageKey(row.originalUrl);
    const upload = await downloadAndUploadVideo(config, bucket, await resolveVideoFetchUrl(row.originalUrl), key);
    if (upload.ok) {
      await db.update(media).set({ blobUrl: key }).where(eq(media.id, row.id));
    } else {
      warnings.push(`Video ${row.originalUrl.slice(0, 40)}... upload failed: ${upload.error}`);
    }
  }
  return warnings;
}

// ─── Preview-based refresh (D-53 extension) ───────────────────────────────

export type PreviewRefreshResult =
  | { ok: true; previewId: string; changed: true }
  | { ok: true; changed: false; message: string }
  | { ok: false; error: string };

/**
 * Step 1 of the preview refresh flow:
 *   - Re-fetches the source content.
 *   - If no substantial change, just updates stats + refreshedAt.
 *   - If substantial change, stores the new content in refresh_previews and
 *     returns the previewId. The admin reviews it before applying.
 */
export async function previewRefresh(
  contentItemId: string,
): Promise<PreviewRefreshResult> {
  // 1. Read the contentItem to get the sourceUrl
  const [item] = await db
    .select()
    .from(contentItems)
    .where(eq(contentItems.id, contentItemId))
    .limit(1);
  if (!item) {
    return { ok: false, error: 'Mirror not found' };
  }
  if (!item.sourceUrl) {
    return { ok: false, error: 'Mirror has no source URL' };
  }

  let fetchUrl = item.sourceUrl;
  const isMediaUrl = /twimg\.com|video\.twimg/i.test(item.sourceUrl);
  if (isMediaUrl) {
    const sourceId = (item.platformData as { sourceId?: string } | null)?.sourceId;
    const authorHandle = (item.author as { handle?: string } | null)?.handle;
    if (sourceId && authorHandle) {
      fetchUrl = item.platform === 'youtube'
        ? `https://www.youtube.com/watch?v=${sourceId}`
        : `https://x.com/${authorHandle}/status/${sourceId}`;
      await db
        .update(contentItems)
        .set({ sourceUrl: fetchUrl })
        .where(eq(contentItems.id, contentItemId));
    } else {
      return {
        ok: false,
        error: 'Mirror source URL is a media URL and cannot be reconstructed',
      };
    }
  }

  // 2. Snapshot current state (not written as a version yet — that happens on apply)
  const snapshot = await createSnapshot(contentItemId);

  // 3. Re-fetch
  let content: FetchedContent;
  try {
    content = await fetchContent(fetchUrl);
  } catch (err) {
    return { ok: false, error: `Re-fetch failed: ${(err as Error).message}` };
  }

  // 4. Detect substantial change
  const hasChanged = detectSubstantialChange(snapshot, content);

  // 5. No change: update stats + platformData (transcript may be newly
  //    available even when body/comments/media are unchanged)
  if (!hasChanged) {
    await db
      .update(contentItems)
      .set({
        stats: content.stats,
        platformData: content.platformData,
        refreshedAt: new Date(),
      })
      .where(eq(contentItems.id, contentItemId));
    return { ok: true, changed: false, message: '内容无变化' };
  }

  // 6. Store the preview (expires in 1 hour)
  const [preview] = await db
    .insert(refreshPreviews)
    .values({
      contentItemId,
      content,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    })
    .returning({ id: refreshPreviews.id });

  if (!preview) {
    return { ok: false, error: 'Failed to create refresh preview' };
  }

  return { ok: true, changed: true, previewId: preview.id };
}

export interface ApplyRefreshResult {
  ok: boolean;
  version?: number;
  error?: string;
}

/**
 * Step 2 of the preview refresh flow:
 *   - Reads the preview row.
 *   - Downloads new images to Blob.
 *   - Snapshots the CURRENT state as a new version.
 *   - Writes the preview content to content_items + media + comments.
 *   - Deletes the preview row.
 *   - Prunes old versions.
 */
export async function applyRefresh(
  contentItemId: string,
  previewId: string,
  selectedCommentIds: string[],
): Promise<ApplyRefreshResult> {
  // 1. Read and validate the preview
  const [preview] = await db
    .select()
    .from(refreshPreviews)
    .where(and(eq(refreshPreviews.id, previewId), eq(refreshPreviews.contentItemId, contentItemId)))
    .limit(1);

  if (!preview) {
    return { ok: false, error: 'Preview not found or expired' };
  }

  if (new Date() > preview.expiresAt) {
    await db.delete(refreshPreviews).where(eq(refreshPreviews.id, previewId));
    return { ok: false, error: 'Preview has expired, please re-fetch' };
  }

  const content = preview.content as FetchedContent;

  // 2. Download images to Blob OUTSIDE the transaction
  const imageMediaItems = content.media.filter((m) => m.type === 'image');
  const imageDownloads: Array<{ mediaItem: MediaItem; blobUrl: string | null; size: number }> = [];

  for (const imgItem of imageMediaItems) {
    try {
      const result = await downloadImageToBlob(imgItem.originalUrl);
      imageDownloads.push({ mediaItem: imgItem, blobUrl: result.blobUrl, size: result.size });
    } catch {
      imageDownloads.push({ mediaItem: imgItem, blobUrl: null, size: 0 });
    }
  }

  // 3. Compute next version number and snapshot current state BEFORE writing
  const maxVersionRows = await db
    .select({ max: sql`COALESCE(MAX(${mirrorVersions.versionNumber}), -1)`.as('max') })
    .from(mirrorVersions)
    .where(eq(mirrorVersions.contentItemId, contentItemId));
  const nextVersion = (maxVersionRows[0]?.max as number) + 1;
  const oldSnapshot = await createSnapshot(contentItemId);

  // 4. Write new data in a transaction, insert the old snapshot as a version,
  //    and delete the preview
  try {
    await db.transaction(async (tx) => {
      // 4a. Update contentItems
      await tx
        .update(contentItems)
        .set({
          title: content.title,
          body: content.body,
          author: content.author,
          publishedAt: content.publishedAt ? new Date(content.publishedAt) : null,
          stats: content.stats,
          platformData: content.platformData,
          fetchedAt: content.fetchedAt ? new Date(content.fetchedAt) : null,
          refreshedAt: new Date(),
        })
        .where(eq(contentItems.id, contentItemId));

      // 4b. Replace media
      await tx.delete(media).where(eq(media.contentItemId, contentItemId));
      for (const m of content.media) {
        if (m.type === 'image') {
          const download = imageDownloads.find((d) => d.mediaItem === m);
          await tx.insert(media).values({
            contentItemId,
            type: 'image',
            originalUrl: m.originalUrl,
            blobUrl: download?.blobUrl ?? null,
            size: download?.size ?? 0,
            meta: null,
          });
        } else if (m.type === 'video') {
          await tx.insert(media).values({
            contentItemId,
            type: 'video',
            originalUrl: m.originalUrl,
            blobUrl: null,
            size: m.filesize ?? null,
            meta: { selectedSource: m.selectedSource ?? null, fetchedAt: content.fetchedAt },
          });
        }
      }

      // 4c. Replace comments
      const allCommentIds = content.comments.map((c) => c.id);
      const commentRecords = buildCommentRecords(content.comments, allCommentIds);
      await tx.delete(comments).where(eq(comments.contentItemId, contentItemId));
      for (const record of commentRecords) {
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

      // 4d. Save the pre-refresh state as a new version
      await tx.insert(mirrorVersions).values({
        contentItemId,
        versionNumber: nextVersion,
        snapshot: oldSnapshot,
      });

      // 4e. Delete the preview
      await tx.delete(refreshPreviews).where(eq(refreshPreviews.id, previewId));
    });
  } catch (err) {
    return { ok: false, error: `Apply failed: ${(err as Error).message}` };
  }

  // 5. Upload videos to storage backend (non-blocking — failures are logged only)
  await uploadVideosToStorage(contentItemId);

  // 6. Prune versions after the transaction
  await pruneVersions(contentItemId, 3);

  return { ok: true, version: nextVersion };
}

/**
 * Clean up expired refresh previews (lazy cleanup). Safe to call periodically.
 */
export async function cleanupExpiredRefreshPreviews(): Promise<void> {
  await db.delete(refreshPreviews).where(gt(sql`now()`, refreshPreviews.expiresAt));
}

// ─── refreshTranscript — subtitle-only refresh ─────────────────────────

export interface RefreshTranscriptResult {
  ok: boolean;
  /** true when a subtitle track was found and saved. */
  found?: boolean;
  /** Subtitle track language ('zh-CN', 'en', ...). */
  lang?: string;
  error?: string;
}

/**
 * Re-fetch the source and update ONLY platformData (transcript/transcriptLang).
 * No version snapshot, no preview flow, no media/comment/body changes —
 * subtitles are deliberately outside substantial-change detection.
 *
 * If the re-fetch returns no transcript, the existing platformData is left
 * untouched (a previously saved transcript is never wiped by a flaky fetch).
 */
export async function refreshTranscript(
  contentItemId: string,
): Promise<RefreshTranscriptResult> {
  const [item] = await db
    .select()
    .from(contentItems)
    .where(eq(contentItems.id, contentItemId))
    .limit(1);
  if (!item) {
    return { ok: false, error: 'Mirror not found' };
  }
  if (!item.sourceUrl) {
    return { ok: false, error: 'Mirror has no source URL' };
  }

  // Media-URL guard — same reconstruction as previewRefresh.
  let fetchUrl = item.sourceUrl;
  if (/twimg\.com|video\.twimg/i.test(item.sourceUrl)) {
    const sourceId = (item.platformData as { sourceId?: string } | null)?.sourceId;
    const authorHandle = (item.author as { handle?: string } | null)?.handle;
    if (sourceId && authorHandle) {
      fetchUrl = item.platform === 'youtube'
        ? `https://www.youtube.com/watch?v=${sourceId}`
        : `https://x.com/${authorHandle}/status/${sourceId}`;
    } else {
      return { ok: false, error: 'Mirror source URL is a media URL and cannot be reconstructed' };
    }
  }

  let content: FetchedContent;
  try {
    content = await fetchContent(fetchUrl);
  } catch (err) {
    return { ok: false, error: `Re-fetch failed: ${(err as Error).message}` };
  }

  const transcript = content.platformData?.transcript?.trim();
  if (!transcript) {
    return { ok: true, found: false };
  }

  const oldData = (item.platformData ?? {}) as Record<string, unknown>;
  await db
    .update(contentItems)
    .set({
      platformData: {
        ...oldData,
        transcript,
        transcriptLang: content.platformData.transcriptLang,
        transcriptVtt: content.platformData.transcriptVtt,
      },
    })
    .where(eq(contentItems.id, contentItemId));

  return { ok: true, found: true, lang: content.platformData.transcriptLang };
}
