// app/admin/mirrors/actions.ts
// Server Actions for mirror creation — previewMirror + createMirror.
// Plan 03-04, Task 3 — Wave 3 backend (UI wiring in 03-05).
//
// MIRR-01: fetch → preview → confirm creation (two-step, Open Q4).
// MIRR-02: images → Vercel Blob (private); videos → streaming proxy (D-12).
// MIRR-04: comment retention (D-24/D-25/D-27).
// MIRR-06: quota warnings (D-18 warn-only, never block).
//
// Review #1 (HIGH): Image download OUTSIDE db.transaction.
//   createMirror first downloads all images to Blob (collecting blobUrl/size
//   including failures), THEN enters db.transaction to write the three tables.
//   No IO inside the transaction — it must be quick.
//
// Review #2 (HIGH): createMirror payload = { url, selectedCommentIds } only.
//   The backend re-calls fetchContent(url) to get the content (agent-reach
//   caches). This avoids the ~1MB Server Action payload limit.
//
// Review #3 (MEDIUM): MediaItem has NO image size field (only video
//   selectedSource.filesize). Precise image bytes are only known after
//   downloadImageToBlob returns size (from Content-Length). Preview-stage
//   estimate is coarse / "confirmed at creation".
//
// Review #6 (MEDIUM): Video media meta includes fetchedAt: content.fetchedAt
//   — planted hook for Phase 4's refresh protocol (per-content vs per-video
//   is TBD, see open_questions).
//
// SSRF (T-03-07): URL validated against platform whitelist (x/twitter/youtube)
//   via zod before any server-side fetch. No arbitrary URL fetching.
// Auth (T-03-08): Both actions call auth() for defense-in-depth (not just proxy).

'use server';

import { z } from 'zod';
import { auth } from '@/auth';
import { fetchContent } from '@/lib/fetcher';
import { FetcherError, ReachErrorKind } from '@/lib/fetcher/errors';
import { downloadImageToBlob } from '@/lib/blob/download-image';
import { buildCommentRecords } from '@/lib/mirror/comments';
import { evaluateQuota, getStorageUsage, LIMITS } from '@/lib/quota';
import { db, contentItems, media, comments, shares, mirrorVersions, refreshPreviews } from '@/lib/db';
import { generateShareToken } from '@/lib/share/token';
import { eq, and } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { createSnapshot } from '@/lib/mirror/versioning';
import type { FetchedContent, MediaItem } from '@/lib/fetcher/types';
import { getSetting } from '@/lib/settings';
import { downloadAndUploadVideo, videoStorageKey } from '@/lib/storage/s3';
import { resolveVideoFetchUrl } from '@/lib/video/playback-url';

async function loadS3Config(): Promise<import('@/lib/storage/s3').S3Config | null> {
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

// ─── SSRF Protection: Platform URL Whitelist (T-03-07) ───────────────
// Only x/twitter/youtube URLs are allowed — agent-reach handles these.
// This prevents server-side fetch of arbitrary URLs (SSRF surface).
const platformUrlSchema = z
  .string()
  .url()
  .refine(
    (url) =>
      /^https?:\/\/(twitter\.com|x\.com|t\.co|www\.youtube\.com|youtu\.be)\//i.test(
        url,
      ),
    'URL must be from twitter.com, x.com, t.co, youtube.com, or youtu.be',
  );

// ─── Result Types ────────────────────────────────────────────────────

export interface PreviewResult {
  ok: boolean;
  content?: FetchedContent;
  error?: string;
  kind?: string;
  retryable?: boolean;
}

export interface CreateMirrorResult {
  ok: boolean;
  mirrorId?: string;
  shareToken?: string; // D-32: client builds {origin}/s/{token} from this (landmine #3/#4)
  warnings: string[];
  error?: string;
}

// ─── previewMirror ───────────────────────────────────────────────────
// Step 1 of the two-step flow (D-21 / Open Q4):
// Fetches content for preview — NO Blob upload, NO DB writes.
// The admin reviews the preview, selects comments, then calls createMirror.

export async function previewMirror(url: string): Promise<PreviewResult> {
  // 1. Auth self-check (T-03-08 defense-in-depth)
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: 'Unauthorized', kind: 'auth_required' };
  }

  // 2. SSRF: validate URL against platform whitelist (T-03-07)
  const parsed = platformUrlSchema.safeParse(url);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid URL',
      kind: 'invalid_url',
    };
  }

  // 3. Fetch content (reuses existing fetchContent — agent-reach call)
  try {
    const content = await fetchContent(parsed.data);
    return { ok: true, content };
  } catch (err) {
    if (err instanceof FetcherError) {
      return {
        ok: false,
        error: err.message,
        kind: err.kind,
        retryable: err.retryable ?? false,
      };
    }
    return {
      ok: false,
      error: (err as Error).message,
      kind: 'unknown',
    };
  }
}

// ─── createMirror ────────────────────────────────────────────────────
// Step 2 of the two-step flow (D-21 / Open Q4):
// Re-fetches content (Scheme A — Review #2), downloads images to Blob
// (OUTSIDE transaction — Review #1), then writes three tables in a quick
// db.transaction.
//
// Payload: { url, selectedCommentIds } only — NOT the whole FetchedContent.
// This avoids the ~1MB Server Action body limit.
// D-50: optional accessControl configures the auto-generated share link's
// access control params (expiry / maxViews / maxUniqueVisitors / burnAfterRead).

const createMirrorSchema = z.object({
  url: platformUrlSchema,
  selectedCommentIds: z.array(z.string()),
  accessControl: z
    .object({
      expiresAt: z.string().nullable().optional(),
      maxViews: z.number().int().positive().nullable().optional(),
      maxUniqueVisitors: z.number().int().positive().nullable().optional(),
      burnAfterRead: z.boolean().optional(),
    })
    .optional(),
});

export async function createMirror(
  input: {
    url: string;
    selectedCommentIds: string[];
    accessControl?: {
      expiresAt?: string | null;
      maxViews?: number | null;
      maxUniqueVisitors?: number | null;
      burnAfterRead?: boolean;
    };
  },
): Promise<CreateMirrorResult> {
  const warnings: string[] = [];

  // 1. Auth self-check (T-03-08 defense-in-depth)
  const session = await auth();
  if (!session?.user) {
    return { ok: false, warnings, error: 'Unauthorized' };
  }

  // 2. Validate input (SSRF whitelist + selectedCommentIds + accessControl)
  const parsed = createMirrorSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      warnings,
      error: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const { url, selectedCommentIds, accessControl } = parsed.data;

  // 3. Re-fetch content (Scheme A — Review #2: agent-reach caches)
  let content: FetchedContent;
  try {
    content = await fetchContent(url);
  } catch (err) {
    if (err instanceof FetcherError) {
      return {
        ok: false,
        warnings,
        error: err.message,
      };
    }
    return {
      ok: false,
      warnings,
      error: (err as Error).message,
    };
  }

  // 4. Quota check (D-17/D-18: warn-only, never block)
  //    Review #3: MediaItem has NO image size field. Precise image bytes are
  //    only known after downloadImageToBlob. The preview-stage estimate is
  //    coarse — we use video selectedSource.filesize where available (but
  //    videos don't count toward storage per D-15). For images, we note that
  //    precise bytes are "confirmed at creation" (after Blob download).
  const usedBytes = await getStorageUsage();
  // Image bytes: unknown at this stage (MediaItem has no image size field).
  // We pass 0 for mirrorImageBytes and largestImageBytes here — the actual
  // bytes are collected during downloadImageToBlob below. Quota warnings
  // based on totalQuota (usedBytes) are still meaningful.
  const imageMediaItems = content.media.filter((m) => m.type === 'image');
  // Coarse estimate: we cannot know image bytes pre-download. Mark as 0.
  // The totalQuota warning (usedBytes > LIMITS.totalQuota) is still checked.
  const quotaEval = evaluateQuota({
    usedBytes,
    mirrorImageBytes: 0, // precise bytes only known after download (Review #3)
    largestImageBytes: 0,
  });
  if (quotaEval.warnings.totalQuota) {
    warnings.push(
      `Total storage usage (${usedBytes} bytes) exceeds quota limit (${LIMITS.totalQuota} bytes).`,
    );
  }
  // Note: perImage and perMirror warnings are evaluated post-download with
  // actual sizes — but since D-18 is warn-only and we proceed regardless,
  // we report them after the download step below.

  // 5. Download images to Blob — OUTSIDE db.transaction (Review #1)
  //    Collect { blobUrl, size } for each image. Failed downloads get
  //    { blobUrl: null, size: 0 } and are reported as warnings (not rollback).
  const imageDownloads: Array<{
    mediaItem: MediaItem;
    blobUrl: string | null;
    size: number;
  }> = [];

  let totalImageBytes = 0;
  let largestImageBytes = 0;

  for (const imgItem of imageMediaItems) {
    try {
      const result = await downloadImageToBlob(imgItem.originalUrl);
      imageDownloads.push({
        mediaItem: imgItem,
        blobUrl: result.blobUrl,
        size: result.size,
      });
      totalImageBytes += result.size;
      if (result.size > largestImageBytes) largestImageBytes = result.size;
    } catch (err) {
      // Partial failure: record as null, continue (don't rollback entire mirror)
      imageDownloads.push({
        mediaItem: imgItem,
        blobUrl: null,
        size: 0,
      });
      warnings.push(
        `Image download failed for ${imgItem.originalUrl}: ${(err as Error).message}`,
      );
    }
  }

  // Post-download quota warnings (now we have actual image sizes)
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

  // 6. Write to DB — inside db.transaction (quick, no IO — Review #1)
  //    content_items + media + comments + shares (D-29)
  let mirrorId: string;
  let shareToken: string;

  try {
    const result = await db.transaction(async (tx) => {
      // 6a. Insert content_items
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
          createdBy: session.user?.name ?? null,
        })
        .returning({ id: contentItems.id });

      const contentItemId = inserted!.id;

      // 6b. Insert media rows
      //     Images: use blobUrl + size from the OUTSIDE-transaction download.
      //     Videos: blobUrl=null, meta={ selectedSource, fetchedAt } (D-12/D-14
      //     + Review #6: video-level fetchedAt hook for Phase 4 refresh).
      for (const item of content.media) {
        if (item.type === 'image') {
          // Find the download result for this image
          const download = imageDownloads.find(
            (d) => d.mediaItem === item,
          );
          await tx.insert(media).values({
            contentItemId,
            type: 'image',
            originalUrl: item.originalUrl,
            blobUrl: download?.blobUrl ?? null,
            size: download?.size ?? 0,
            meta: null,
          });
        } else if (item.type === 'video') {
          // D-12: videos do NOT go to Blob. Store googlevideo URL + meta.
          // D-14: meta = { selectedSource, fetchedAt: content.fetchedAt }
          // Review #6: fetchedAt hook for Phase 4 refresh protocol.
          await tx.insert(media).values({
            contentItemId,
            type: 'video',
            originalUrl: item.originalUrl, // googlevideo URL (not original post URL)
            blobUrl: null, // videos don't go to Blob (D-12)
            size: item.filesize ?? null, // video filesize from selectedSource (if available)
            meta: {
              selectedSource: item.selectedSource ?? null,
              fetchedAt: content.fetchedAt, // video-level fetchedAt (Review #6)
            },
          });
        }
      }

      // 6c. Insert comments — all stored, retained per selection (D-25/D-27)
      const commentRecords = buildCommentRecords(
        content.comments,
        selectedCommentIds,
      );
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

      // 6d. Insert share record (D-29: auto-generate share link atomically
      //     with the mirror writes). nanoid is synchronous (no IO), safe
      //     inside the transaction. status='active' per D-38 (Phase 4 all
      //     active). If the transaction rolls back, the share is not created.
      //     D-50: access control params (if provided) are written here —
      //     enforcement happens at view time via checkAccess() (05-01).
      const shareToken = generateShareToken(); // D-33: nanoid 21 chars, ~126 bits
      await tx.insert(shares).values({
        token: shareToken,
        contentItemId,
        status: 'active', // D-38: Phase 4 all active
        // D-50 access control (optional, backward compatible — null/false = unlimited)
        expiresAt: accessControl?.expiresAt
          ? new Date(accessControl.expiresAt)
          : null,
        maxViews: accessControl?.maxViews ?? null,
        maxUniqueVisitors: accessControl?.maxUniqueVisitors ?? null,
        burnAfterRead: accessControl?.burnAfterRead ?? false,
        viewCount: 0,
        uniqueVisitorCount: 0,
      });

      // 6e. Snapshot the newly-created state as v0 so future refreshes can
      //     roll back all the way to the original fetched version (D-53).
      const initialSnapshot = await createSnapshot(contentItemId, tx);
      await tx.insert(mirrorVersions).values({
        contentItemId,
        versionNumber: 0,
        snapshot: initialSnapshot,
      });

      return { contentItemId, token: shareToken };
    });

    mirrorId = result.contentItemId;
    shareToken = result.token;
  } catch (err) {
    return {
      ok: false,
      warnings,
      error: `Database write failed: ${(err as Error).message}`,
    };
  }

  // 7. If video storage backend is enabled, upload new videos to S3/R2 after
  //    the transaction (non-blocking — failures are recorded as warnings only).
  const storageEnabled = (await getSetting('video_storage_enabled')) === 'true';
  if (storageEnabled) {
    const s3Config = await loadS3Config();
    if (s3Config) {
      const videoRows = await db
        .select()
        .from(media)
        .where(and(eq(media.contentItemId, mirrorId), eq(media.type, 'video')));
      for (const row of videoRows) {
        if (row.blobUrl) continue;
        const key = videoStorageKey(row.originalUrl);
        const upload = await downloadAndUploadVideo(s3Config, s3Config.bucket, await resolveVideoFetchUrl(row.originalUrl), key);
        if (upload.ok) {
          await db
            .update(media)
            .set({ blobUrl: key })
            .where(eq(media.id, row.id));
        } else {
          warnings.push(`视频存储上传失败: ${upload.error}`);
        }
      }
    }
  }

  return { ok: true, mirrorId, shareToken, warnings };
}

// ─── deleteMirror ────────────────────────────────────────────────────
// Deletes a mirror and its child rows (media, comments).
//
// T-03-11: auth() self-check (defense-in-depth).
// T-03-12 / Review #13: mirrorId validated with zod z.string().uuid()
//   to prevent injection / unauthorized deletion.
//
// FK no-action: media and comments have ON DELETE NO ACTION on
// content_items. We must delete child rows first inside a transaction
// before deleting the parent content_items row (Open Q2 / 阶段假设 4).
// We do NOT alter the existing migration's cascade semantics.

const mirrorIdSchema = z.string().uuid();

export interface DeleteMirrorResult {
  ok: boolean;
  error?: string;
}

export async function deleteMirror(
  mirrorId: string,
): Promise<DeleteMirrorResult> {
  // 1. Auth self-check (T-03-11 defense-in-depth)
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: 'Unauthorized' };
  }

  // 2. Validate mirrorId (T-03-12 / Review #13: zod uuid)
  const parsed = mirrorIdSchema.safeParse(mirrorId);
  if (!parsed.success) {
    return { ok: false, error: 'invalid mirrorId' };
  }
  const id = parsed.data;

  // 3. Delete in transaction: child rows first, then parent
  //    (FK ON DELETE NO ACTION — must remove children before parent)
  try {
    await db.transaction(async (tx) => {
      // 3a. Delete shares rows for this content item (FK ON DELETE NO ACTION
      //     — must delete before parent; PATTERNS landmine #1)
      await tx.delete(shares).where(eq(shares.contentItemId, id));
      // 3b. Delete media rows for this content item
      await tx.delete(media).where(eq(media.contentItemId, id));
      // 3c. Delete comments rows for this content item
      await tx.delete(comments).where(eq(comments.contentItemId, id));
      // 3d. Delete the content_items row
      await tx.delete(contentItems).where(eq(contentItems.id, id));
    });
  } catch (err) {
    return {
      ok: false,
      error: `Delete failed: ${(err as Error).message}`,
    };
  }

  // 4. Revalidate the list page
  revalidatePath('/admin/mirrors');

  return { ok: true };
}

// ─── refreshMirror (Plan 05-03, MIRR-05, D-53) ──────────────────────
// Admin clicks '重新抓取' to re-fetch content, comments, and media.
// Delegates to lib/mirror/refresh.ts — snapshot → re-fetch → detect
// change → version or stats-only update (Pitfall 4).
//
// T-05-09: re-fetch uses the existing sourceUrl from content_items
//   (already validated at createMirror with platform whitelist) — no
//   user-supplied URL at refresh time, so no new SSRF risk.
// T-05-10: auth() self-check + zod validation (contentItemId uuid).

export interface RefreshMirrorActionResult {
  ok: boolean;
  changed?: boolean;
  version?: number;
  error?: string;
}

export async function refreshMirror(
  contentItemId: string,
): Promise<RefreshMirrorActionResult> {
  // 1. Auth self-check (T-05-10 defense-in-depth)
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: 'Unauthorized' };
  }

  // 2. Validate contentItemId (zod uuid)
  const parsed = z.string().uuid().safeParse(contentItemId);
  if (!parsed.success) {
    return { ok: false, error: 'invalid contentItemId' };
  }

  // 3. Call refreshMirror() lib function
  const { refreshMirror: refreshMirrorLib } = await import('@/lib/mirror/refresh');
  const result = await refreshMirrorLib(parsed.data);

  if (result.error) {
    return { ok: false, error: result.error };
  }

  // 4. Revalidate the list + detail pages
  revalidatePath('/admin/mirrors');
  revalidatePath(`/admin/mirrors/${parsed.data}`);

  return {
    ok: true,
    changed: result.changed,
    version: result.version,
  };
}

// ─── rollbackMirror (Plan 05-03, D-53) ──────────────────────────────
// Admin rolls back a mirror to a previous version. Delegates to
// rollbackVersion() from lib/mirror/versioning.ts — writes the snapshot
// back to content_items + media + comments in a transaction.
//
// T-05-10: auth() self-check + zod validation (contentItemId uuid +
//   versionNumber positive int).

export interface RollbackMirrorActionResult {
  ok: boolean;
  error?: string;
}

const rollbackSchema = z.object({
  contentItemId: z.string().uuid(),
  versionNumber: z.number().int().positive(),
});

export async function rollbackMirror(
  contentItemId: string,
  versionNumber: number,
): Promise<RollbackMirrorActionResult> {
  // 1. Auth self-check (T-05-10 defense-in-depth)
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: 'Unauthorized' };
  }

  // 2. Validate input (zod uuid + positive int)
  const parsed = rollbackSchema.safeParse({ contentItemId, versionNumber });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }

  // 3. Call rollbackVersion() lib function
  const { rollbackVersion } = await import('@/lib/mirror/versioning');
  try {
    await rollbackVersion(parsed.data.contentItemId, parsed.data.versionNumber);
  } catch (err) {
    return {
      ok: false,
      error: `Rollback failed: ${(err as Error).message}`,
    };
  }

  // 4. Revalidate the list + detail pages
  revalidatePath('/admin/mirrors');
  revalidatePath(`/admin/mirrors/${parsed.data.contentItemId}`);

  return { ok: true };
}

// ─── createShare ─────────────────────────────────────────────────────
// 为已有内容新增一个分享链接（内容详情页"新增分享"按钮调用）。
// auth() self-check + zod contentItemId uuid 验证。

const createShareSchema = z.object({
  contentItemId: z.string().uuid(),
  accessControl: z
    .object({
      expiresAt: z.string().nullable().optional(),
      maxViews: z.number().int().positive().nullable().optional(),
      maxUniqueVisitors: z.number().int().positive().nullable().optional(),
      burnAfterRead: z.boolean().optional(),
    })
    .optional(),
});

export interface CreateShareResult {
  ok: boolean;
  token?: string;
  error?: string;
}

export async function createShare(input: {
  contentItemId: string;
  accessControl?: {
    expiresAt?: string | null;
    maxViews?: number | null;
    maxUniqueVisitors?: number | null;
    burnAfterRead?: boolean;
  };
}): Promise<CreateShareResult> {
  // 1. Auth
  const session = await auth();
  if (!session?.user) return { ok: false, error: 'Unauthorized' };

  // 2. Validate
  const parsed = createShareSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }
  const { contentItemId, accessControl } = parsed.data;

  // 3. Insert share
  const shareToken = generateShareToken();
  try {
    await db.insert(shares).values({
      token: shareToken,
      contentItemId,
      status: 'active',
      expiresAt: accessControl?.expiresAt ? new Date(accessControl.expiresAt) : null,
      maxViews: accessControl?.maxViews ?? null,
      maxUniqueVisitors: accessControl?.maxUniqueVisitors ?? null,
      burnAfterRead: accessControl?.burnAfterRead ?? false,
      viewCount: 0,
      uniqueVisitorCount: 0,
    });
  } catch (err) {
    return { ok: false, error: `Create share failed: ${(err as Error).message}` };
  }

  // 4. Revalidate
  revalidatePath('/admin/mirrors');
  revalidatePath(`/admin/mirrors/${contentItemId}`);

  return { ok: true, token: shareToken };
}

// ─── setMirrorPassword ───────────────────────────────────────────────
// Password gate for a mirror. Stored on the content item, so it applies to
// every share link pointing at it — the password protects the content, while
// expiry / view caps / burn-after-read are properties of an individual link.

const mirrorPasswordSchema = z.object({
  contentItemId: z.string().uuid(),
  mode: z.enum(['none', 'inherit', 'custom']),
  password: z.string().max(200).optional(),
});

export async function setMirrorPassword(input: {
  contentItemId: string;
  mode: 'none' | 'inherit' | 'custom';
  password?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: 'Unauthorized' };

  const parsed = mirrorPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '输入有误' };
  }
  const { contentItemId, mode, password } = parsed.data;

  const [existing] = await db
    .select({ passwordHash: contentItems.passwordHash })
    .from(contentItems)
    .where(eq(contentItems.id, contentItemId))
    .limit(1);
  if (!existing) return { ok: false, error: '内容不存在' };

  // Blank keeps the stored password; leaving 'custom' drops it so no stale
  // secret survives the mode change.
  let passwordHash: string | null = null;
  if (mode === 'custom') {
    if (password?.trim()) {
      const { hashPassword } = await import('@/lib/content/password');
      passwordHash = await hashPassword(password.trim());
    } else if (existing.passwordHash) {
      passwordHash = existing.passwordHash;
    } else {
      return { ok: false, error: '选择「单独设置密码」时需要填写密码' };
    }
  }

  try {
    await db
      .update(contentItems)
      .set({ passwordMode: mode, passwordHash })
      .where(eq(contentItems.id, contentItemId));
  } catch (err) {
    return { ok: false, error: `保存失败：${(err as Error).message}` };
  }

  revalidatePath('/admin/mirrors');
  revalidatePath(`/admin/mirrors/${contentItemId}`);
  return { ok: true };
}

// ─── previewRefresh + applyRefresh (D-53 extension) ───────────────────
// Two-step refresh flow: preview first, then apply. The admin sees the diff
// and chooses which comments to keep before the new version is written.

export interface PreviewRefreshActionResult {
  ok: boolean;
  previewId?: string;
  changed?: boolean;
  message?: string;
  error?: string;
}

export interface ApplyRefreshActionResult {
  ok: boolean;
  version?: number;
  error?: string;
}

const previewRefreshSchema = z.string().uuid();
const applyRefreshSchema = z.object({
  mirrorId: z.string().uuid(),
  previewId: z.string().uuid(),
  selectedCommentIds: z.array(z.string()),
});

/**
 * Server Action: start a refresh preview.
 * Fetches the source, compares with current mirror, and either:
 *   - returns { changed: false } if nothing substantial changed, or
 *   - returns { previewId } so the client can redirect to the preview page.
 */
export async function previewRefreshAction(
  mirrorId: string,
): Promise<PreviewRefreshActionResult> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: 'Unauthorized' };
  }

  const parsed = previewRefreshSchema.safeParse(mirrorId);
  if (!parsed.success) {
    return { ok: false, error: 'Invalid mirror id' };
  }

  const { previewRefresh } = await import('@/lib/mirror/refresh');
  const result = await previewRefresh(parsed.data);

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  if (result.changed === false) {
    revalidatePath('/admin/mirrors');
    revalidatePath(`/admin/mirrors/${mirrorId}`);
    return { ok: true, changed: false, message: result.message };
  }

  return { ok: true, changed: true, previewId: result.previewId };
}

/**
 * Server Action: apply a refresh preview.
 * Downloads images, writes the new content, creates a version snapshot, and
 * deletes the preview. Then revalidates the mirror pages.
 */
export async function applyRefreshAction(
  input: {
    mirrorId: string;
    previewId: string;
    selectedCommentIds: string[];
  },
): Promise<ApplyRefreshActionResult> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: 'Unauthorized' };
  }

  const parsed = applyRefreshSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }

  const { mirrorId, previewId, selectedCommentIds } = parsed.data;

  const { applyRefresh } = await import('@/lib/mirror/refresh');
  const result = await applyRefresh(mirrorId, previewId, selectedCommentIds);

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  revalidatePath('/admin/mirrors');
  revalidatePath(`/admin/mirrors/${mirrorId}`);

  return { ok: true, version: result.version };
}

/**
 * Server Action: discard a refresh preview without applying it.
 */
export async function discardRefreshAction(
  mirrorId: string,
  previewId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: 'Unauthorized' };
  }

  const idParsed = z.string().uuid().safeParse(mirrorId);
  const previewParsed = z.string().uuid().safeParse(previewId);
  if (!idParsed.success || !previewParsed.success) {
    return { ok: false, error: 'Invalid ids' };
  }

  try {
    await db
      .delete(refreshPreviews)
      .where(
        and(eq(refreshPreviews.id, previewParsed.data), eq(refreshPreviews.contentItemId, idParsed.data)),
      );
  } catch (err) {
    return { ok: false, error: `Discard failed: ${(err as Error).message}` };
  }

  return { ok: true };
}

// ─── refreshTranscriptAction — 字幕单独刷新 ────────────────────────────
// Re-fetches the source and updates only platformData.transcript(/Lang).
// No version snapshot, no preview flow (subtitles are outside
// substantial-change detection by design).

export interface RefreshTranscriptActionResult {
  ok: boolean;
  found?: boolean;
  lang?: string;
  error?: string;
}

export async function refreshTranscriptAction(
  mirrorId: string,
): Promise<RefreshTranscriptActionResult> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: 'Unauthorized' };
  }

  const parsed = z.string().uuid().safeParse(mirrorId);
  if (!parsed.success) {
    return { ok: false, error: 'Invalid mirror id' };
  }

  const { refreshTranscript } = await import('@/lib/mirror/refresh');
  const result = await refreshTranscript(parsed.data);

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  revalidatePath(`/admin/mirrors/${parsed.data}`);
  return { ok: true, found: result.found, lang: result.lang };
}
