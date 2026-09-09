// app/admin/(shell)/articles/actions.ts
// Server Actions for self-authored articles: draft lifecycle, media
// registration and comment moderation.
//
// Every action re-checks auth() even though proxy.ts already gates /admin/* —
// Server Actions are POST endpoints reachable by id, so the gate at the edge is
// not the only thing standing between an attacker and a write (same reasoning
// as the mirror actions).

'use server';

import { z } from 'zod';
import { and, eq, inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { del } from '@vercel/blob';
import { DeleteObjectsCommand } from '@aws-sdk/client-s3';

import { auth } from '@/auth';
import { db, contentItems, media, articleComments } from '@/lib/db';
import { generateUniqueSlug, normalizeRequestedSlug, MAX_SLUG_LENGTH } from '@/lib/article/slug';
import { hashPassword } from '@/lib/content/password';
import { articleMediaUrl, deriveExcerpt } from '@/lib/article/markdown';
import { getArticleById, isSlugTaken } from '@/lib/article/queries';
import {
  filterStillUnreferenced,
  listArticleAssets,
  loadArticleMediaRows,
  type AssetMeta,
} from '@/lib/article/assets';
import { createS3Client } from '@/lib/storage/s3';
import { derivedPathnamesFor } from '@/lib/article/image-transform';
import {
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  articleImagePathname,
  articleVideoStorageKey,
  extensionForType,
  isAllowedImageType,
  isAllowedVideoType,
  loadArticleS3Config,
  VIDEO_UPLOAD_PART_BYTES,
  abortVideoMultipartUpload,
  completeVideoMultipartUpload,
  createVideoMultipartUpload,
} from '@/lib/article/media';

const TITLE_MAX = 200;
const EXCERPT_MAX = 300;

async function requireAdmin(): Promise<{ name: string } | null> {
  const session = await auth();
  if (!session?.user) return null;
  return { name: session.user.name ?? 'admin' };
}

/** Revalidate every surface an article change can be visible on. */
function revalidateArticle(id: string, slug: string | null) {
  revalidatePath('/admin/articles');
  revalidatePath(`/admin/articles/${id}`);
  revalidatePath('/post');
  if (slug) revalidatePath(`/p/${slug}`);
}

/**
 * Delete the stored objects behind a set of media rows.
 *
 * Best effort by design: the caller is about to drop the rows that point at
 * these objects, and once those are gone the objects are unreachable anyway. A
 * storage hiccup should leave an orphaned object, not a half-deleted article.
 * Returns what failed so the caller can surface it.
 */
async function deleteStoredObjects(
  rows: Array<{ id?: string; type: string | null; blobUrl: string | null }>,
): Promise<string[]> {
  const warnings: string[] = [];

  const blobUrls = rows
    .filter((row) => row.type === 'image' && row.blobUrl?.startsWith('http'))
    .map((row) => row.blobUrl!);

  // Resized WebP derivatives live at deterministic paths beside the original;
  // deleting only the original would leave them orphaned forever. del() ignores
  // paths that were never generated, so listing all of them is fine.
  const derived = rows
    .filter((row) => row.type === 'image' && row.id)
    .flatMap((row) => derivedPathnamesFor(row.id!));

  const toDelete = [...blobUrls, ...derived];
  if (toDelete.length > 0) {
    try {
      await del(toDelete, { token: process.env.BLOB_READ_WRITE_TOKEN });
    } catch (err) {
      warnings.push(`图片存储清理失败：${(err as Error).message}`);
    }
  }

  const videoKeys = rows
    .filter((row) => row.type === 'video' && row.blobUrl)
    .map((row) => row.blobUrl!);
  if (videoKeys.length > 0) {
    const config = await loadArticleS3Config();
    if (!config) {
      warnings.push('视频存储未配置，视频文件未能从存储中删除');
    } else {
      try {
        const client = createS3Client(config);
        // DeleteObjects caps at 1000 keys per call.
        for (let i = 0; i < videoKeys.length; i += 1000) {
          await client.send(
            new DeleteObjectsCommand({
              Bucket: config.bucket,
              Delete: { Objects: videoKeys.slice(i, i + 1000).map((Key) => ({ Key })) },
            }),
          );
        }
      } catch (err) {
        warnings.push(`视频存储清理失败：${(err as Error).message}`);
      }
    }
  }

  return warnings;
}

// ─── create / update ─────────────────────────────────────────────────

const saveSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1, '标题不能为空').max(TITLE_MAX, `标题最长 ${TITLE_MAX} 字`),
  body: z.string(),
  excerpt: z.string().max(EXCERPT_MAX, `摘要最长 ${EXCERPT_MAX} 字`).optional(),
  slug: z.string().max(MAX_SLUG_LENGTH).optional(),
  coverImageUrl: z.string().optional(),
  status: z.enum(['draft', 'published']),
  authorName: z.string().trim().max(64).optional(),
  commentsEnabled: z.boolean().optional(),
  listed: z.boolean().optional(),
  passwordMode: z.enum(['none', 'inherit', 'custom']).optional(),
  /** Blank on an already-protected item means "keep the current password". */
  password: z.string().max(200).optional(),
  coverStyle: z.enum(['above', 'hero']).optional(),
});

export interface SaveArticleResult {
  ok: boolean;
  id?: string;
  slug?: string;
  error?: string;
}

/**
 * Create or update an article.
 *
 * `publishedAt` is stamped on the first transition into 'published' and left
 * alone afterwards — re-publishing an edited post should not reorder the list
 * or rewrite its date. Unpublishing keeps the timestamp so the original date
 * survives a round trip through draft.
 */
export async function saveArticle(input: {
  id?: string;
  title: string;
  body: string;
  excerpt?: string;
  slug?: string;
  coverImageUrl?: string;
  status: 'draft' | 'published';
  authorName?: string;
  commentsEnabled?: boolean;
  listed?: boolean;
  passwordMode?: 'none' | 'inherit' | 'custom';
  password?: string;
  coverStyle?: 'above' | 'hero';
}): Promise<SaveArticleResult> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: 'Unauthorized' };

  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '输入有误' };
  }
  const data = parsed.data;

  const existing = data.id ? await getArticleById(data.id) : null;
  if (data.id && !existing) return { ok: false, error: '文章不存在' };

  // Slug: honour an explicit one, otherwise generate a random ASCII one. A
  // published article keeps its slug when left blank — the URL is public by
  // then, and regenerating it on every save would break inbound links.
  let slug: string;
  if (data.slug?.trim()) {
    const result = await normalizeRequestedSlug(data.slug, (s) => isSlugTaken(s, data.id));
    if (!result.ok) {
      return {
        ok: false,
        error:
          result.reason === 'taken'
            ? '这个链接已被其他文章占用'
            : '链接格式不正确（只能用字母、数字、汉字和连字符）',
      };
    }
    slug = result.slug;
  } else if (existing?.slug) {
    slug = existing.slug;
  } else {
    slug = await generateUniqueSlug((s) => isSlugTaken(s, data.id));
  }

  // Password: hash a newly typed one, keep the stored hash when the field was
  // left blank, and drop it entirely outside 'custom' mode so a mode switch
  // doesn't leave a stale secret behind.
  const passwordMode = data.passwordMode ?? 'none';
  let passwordHash: string | null = null;
  if (passwordMode === 'custom') {
    if (data.password?.trim()) {
      passwordHash = await hashPassword(data.password.trim());
    } else if (existing?.passwordHash) {
      passwordHash = existing.passwordHash;
    } else {
      return { ok: false, error: '选择「单独设置密码」时需要填写密码' };
    }
  }

  const excerpt = data.excerpt?.trim() || deriveExcerpt(data.body);
  const now = new Date();
  const becomingPublished = data.status === 'published' && existing?.status !== 'published';

  const values = {
    type: 'article' as const,
    title: data.title.trim(),
    body: data.body,
    excerpt,
    slug,
    status: data.status,
    coverImageUrl: data.coverImageUrl?.trim() || null,
    commentsEnabled: data.commentsEnabled ?? true,
    listed: data.listed ?? true,
    passwordMode,
    passwordHash,
    coverStyle: data.coverStyle ?? 'above',
    author: { name: data.authorName?.trim() || admin.name, handle: admin.name },
    updatedAt: now,
    createdBy: admin.name,
  };

  try {
    if (existing) {
      await db
        .update(contentItems)
        .set({
          ...values,
          // Stamp the publish date once, on the first publish.
          ...(becomingPublished ? { publishedAt: existing.publishedAt ?? now } : {}),
        })
        .where(eq(contentItems.id, existing.id));

      revalidateArticle(existing.id, slug);
      if (existing.slug && existing.slug !== slug) revalidatePath(`/p/${existing.slug}`);
      return { ok: true, id: existing.id, slug };
    }

    const [inserted] = await db
      .insert(contentItems)
      .values({
        ...values,
        publishedAt: data.status === 'published' ? now : null,
      })
      .returning({ id: contentItems.id });

    revalidateArticle(inserted!.id, slug);
    return { ok: true, id: inserted!.id, slug };
  } catch (err) {
    return { ok: false, error: `保存失败：${(err as Error).message}` };
  }
}

// ─── delete ──────────────────────────────────────────────────────────

export async function deleteArticle(id: string): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: 'Unauthorized' };

  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return { ok: false, error: 'invalid id' };

  const article = await getArticleById(parsed.data);
  if (!article) return { ok: false, error: '文章不存在' };

  // Storage cleanup before the rows go: once the media rows are gone, the blob
  // URLs and object keys are unrecoverable and the objects would leak forever.
  const mediaRows = await db.select().from(media).where(eq(media.contentItemId, parsed.data));
  await deleteStoredObjects(mediaRows);

  try {
    await db.transaction(async (tx) => {
      // article_comments cascades on the FK; media does not (ON DELETE NO
      // ACTION, matching the mirror tables) so it goes first.
      await tx.delete(media).where(eq(media.contentItemId, parsed.data));
      await tx.delete(articleComments).where(eq(articleComments.contentItemId, parsed.data));
      await tx.delete(contentItems).where(eq(contentItems.id, parsed.data));
    });
  } catch (err) {
    return { ok: false, error: `删除失败：${(err as Error).message}` };
  }

  revalidateArticle(parsed.data, article.slug);
  return { ok: true };
}

// ─── media library ───────────────────────────────────────────────────

/** One entry in the picker's library grid — smaller than ArticleAsset. */
export interface MediaLibraryItem {
  id: string;
  type: 'image' | 'video';
  /** In-app `/api/article-media/<id>.<ext>` URL, ready to paste. */
  url: string;
  filename: string | null;
  size: number;
  /** Epoch ms — a Date would survive the wire, but this is what the UI sorts on. */
  createdAt: number;
  /** Title of the article it was uploaded into. */
  ownerArticleTitle: string;
  /** False when nothing references it — the reason to go looking in here. */
  referenced: boolean;
  hasPoster: boolean;
}

/** Beyond this the grid stops being a way to find anything. */
const LIBRARY_LIMIT = 500;

/**
 * Every article asset on the site, newest first, for the picker's library tab.
 *
 * Deliberately not scoped to the current article. The point of the tab is to
 * reuse what already exists — an image uploaded into a draft last month, or one
 * whose article was rewritten and no longer references it. Scoping it to the
 * open article would leave exactly those unreachable, which is the case the
 * author actually has.
 *
 * Everything is returned at once and filtered in the browser: the inventory
 * scan already reads every article body, so paginating it server-side would
 * repeat that work per page for a list that fits in one response.
 */
export async function listMediaLibrary(): Promise<{
  ok: boolean;
  items?: MediaLibraryItem[];
  /** True when the list was cut at LIBRARY_LIMIT. */
  truncated?: boolean;
  error?: string;
}> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: 'Unauthorized' };

  try {
    const { assets } = await listArticleAssets();
    return {
      ok: true,
      truncated: assets.length > LIBRARY_LIMIT,
      items: assets.slice(0, LIBRARY_LIMIT).map((asset) => ({
        id: asset.id,
        type: asset.type,
        url: asset.url,
        filename: asset.filename,
        size: asset.size,
        createdAt: new Date(asset.createdAt).getTime(),
        ownerArticleTitle: asset.ownerArticleTitle,
        referenced: asset.referencedBy.length > 0,
        hasPoster: asset.hasPoster,
      })),
    };
  } catch (err) {
    return { ok: false, error: `读取素材库失败：${(err as Error).message}` };
  }
}

// ─── media registration ──────────────────────────────────────────────

const registerImageSchema = z.object({
  articleId: z.string().uuid(),
  blobUrl: z.string().url(),
  contentType: z.string(),
  size: z.number().int().nonnegative(),
  filename: z.string().max(255).optional(),
});

export interface RegisterMediaResult {
  ok: boolean;
  /** In-app URL to paste into the Markdown body. */
  url?: string;
  mediaId?: string;
  error?: string;
}

/**
 * Record an image the browser already uploaded to Blob.
 *
 * Returns the `/api/article-media/<id>.<ext>` URL rather than the Blob URL:
 * the Blob store is private, so its presigned URL would expire out of the
 * saved Markdown within the hour.
 */
export async function registerArticleImage(input: {
  articleId: string;
  blobUrl: string;
  contentType: string;
  size: number;
  filename?: string;
}): Promise<RegisterMediaResult> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: 'Unauthorized' };

  const parsed = registerImageSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '输入有误' };
  }
  if (!isAllowedImageType(parsed.data.contentType)) {
    return { ok: false, error: '不支持的图片格式' };
  }

  const article = await getArticleById(parsed.data.articleId);
  if (!article) return { ok: false, error: '文章不存在' };

  const [row] = await db
    .insert(media)
    .values({
      contentItemId: article.id,
      type: 'image',
      originalUrl: parsed.data.blobUrl,
      blobUrl: parsed.data.blobUrl,
      size: parsed.data.size,
      meta: {
        source: 'article',
        contentType: parsed.data.contentType,
        filename: parsed.data.filename ?? null,
      },
    })
    .returning({ id: media.id });

  return {
    ok: true,
    mediaId: row!.id,
    url: articleMediaUrl(row!.id, extensionForType(parsed.data.contentType)),
  };
}

const videoUploadSchema = z.object({
  articleId: z.string().uuid(),
  contentType: z.string(),
  size: z.number().int().positive().max(MAX_VIDEO_BYTES, '视频超过 500MB 上限'),
});

export interface VideoUploadTicket {
  ok: boolean;
  key?: string;
  uploadId?: string;
  partSize?: number;
  partUrls?: string[];
  error?: string;
}

/**
 * Open a multipart upload and issue one presigned PUT per part, so the browser
 * can upload a video straight to S3/R2 in independently-retried chunks.
 *
 * No media row yet — it is written by registerArticleVideo once the upload
 * actually lands, so an abandoned upload leaves no dangling row behind.
 */
export async function createArticleVideoUpload(input: {
  articleId: string;
  contentType: string;
  size: number;
}): Promise<VideoUploadTicket> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: 'Unauthorized' };

  const parsed = videoUploadSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '输入有误' };
  }
  if (!isAllowedVideoType(parsed.data.contentType)) {
    return { ok: false, error: '不支持的视频格式（支持 mp4 / webm / mov）' };
  }

  const article = await getArticleById(parsed.data.articleId);
  if (!article) return { ok: false, error: '文章不存在' };

  const config = await loadArticleS3Config();
  if (!config) {
    return { ok: false, error: '视频存储尚未配置，请先在「系统设置」中填写 S3/R2 参数' };
  }

  const key = articleVideoStorageKey(parsed.data.contentType);
  const partCount = Math.max(1, Math.ceil(parsed.data.size / VIDEO_UPLOAD_PART_BYTES));
  try {
    const { uploadId, partUrls } = await createVideoMultipartUpload(
      config,
      key,
      parsed.data.contentType,
      partCount,
    );
    return { ok: true, key, uploadId, partSize: VIDEO_UPLOAD_PART_BYTES, partUrls };
  } catch (err) {
    return { ok: false, error: `无法生成上传地址：${(err as Error).message}` };
  }
}

/**
 * Drop a multipart upload the browser gave up on, so its parts stop taking up
 * storage. Best-effort from the client's perspective — R2 also expires
 * incomplete multipart uploads on its own after a few days.
 */
export async function abortArticleVideoUpload(input: {
  key: string;
  uploadId: string;
}): Promise<void> {
  const admin = await requireAdmin();
  if (!admin) return;
  if (!input.key.startsWith('articles/videos/')) return;

  const config = await loadArticleS3Config();
  if (!config) return;
  try {
    await abortVideoMultipartUpload(config, input.key, input.uploadId);
  } catch {
    // Nothing to do — the storage's own expiry will collect it.
  }
}

const registerVideoSchema = z.object({
  articleId: z.string().uuid(),
  key: z.string().min(1).max(255),
  uploadId: z.string().min(1).max(1024),
  contentType: z.string(),
  size: z.number().int().nonnegative(),
  filename: z.string().max(255).optional(),
});

/**
 * Seal a finished multipart upload into the final S3/R2 object and record it.
 *
 * Completion happens here rather than in a separate action so a video row can
 * only ever describe an object that actually exists: if the seal fails, no row
 * is written.
 */
export async function registerArticleVideo(input: {
  articleId: string;
  key: string;
  uploadId: string;
  contentType: string;
  size: number;
  filename?: string;
}): Promise<RegisterMediaResult> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: 'Unauthorized' };

  const parsed = registerVideoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '输入有误' };
  }
  if (!isAllowedVideoType(parsed.data.contentType)) {
    return { ok: false, error: '不支持的视频格式' };
  }
  // The key was minted by createArticleVideoUpload; anything else is a forged
  // request trying to bind an arbitrary bucket object to this article.
  if (!parsed.data.key.startsWith('articles/videos/')) {
    return { ok: false, error: '非法的存储路径' };
  }

  const article = await getArticleById(parsed.data.articleId);
  if (!article) return { ok: false, error: '文章不存在' };

  const config = await loadArticleS3Config();
  if (!config) {
    return { ok: false, error: '视频存储尚未配置' };
  }
  try {
    await completeVideoMultipartUpload(config, parsed.data.key, parsed.data.uploadId);
  } catch (err) {
    return { ok: false, error: `合并分块失败：${(err as Error).message}` };
  }

  const [row] = await db
    .insert(media)
    .values({
      contentItemId: article.id,
      type: 'video',
      originalUrl: parsed.data.key,
      blobUrl: parsed.data.key,
      size: parsed.data.size,
      meta: {
        source: 'article',
        contentType: parsed.data.contentType,
        filename: parsed.data.filename ?? null,
      },
    })
    .returning({ id: media.id });

  return {
    ok: true,
    mediaId: row!.id,
    url: articleMediaUrl(row!.id, extensionForType(parsed.data.contentType)),
  };
}

// ─── remote import ───────────────────────────────────────────────────

const importRemoteSchema = z.object({
  articleId: z.string().uuid(),
  url: z.string().trim().min(1).max(2048),
});

/**
 * Import media from a remote URL into the article's own storage.
 *
 * The transfer itself lives in lib/article/remote-import.ts, which
 * /api/article-media/import also drives — that route streams the same run's
 * progress to the browser, which a Server Action cannot do. This entry point
 * stays for callers that only want the final answer, and to keep the auth check
 * in one recognisable place.
 */
export async function importRemoteMedia(input: {
  articleId: string;
  url: string;
}): Promise<RegisterMediaResult> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: 'Unauthorized' };

  const parsed = importRemoteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '输入有误' };
  }

  const { importRemoteMediaToArticle } = await import('@/lib/article/remote-import');
  const outcome = await importRemoteMediaToArticle(parsed.data);

  return outcome.ok
    ? { ok: true, url: outcome.url, mediaId: outcome.mediaId }
    : { ok: false, error: outcome.error };
}

// ─── video posters ───────────────────────────────────────────────────

const posterSchema = z.object({
  mediaId: z.string().uuid(),
  blobUrl: z.string().url(),
});

/**
 * Attach a poster frame to a video.
 *
 * The frame is captured in the browser (lib/article/video-poster.ts) and
 * uploaded to Blob like any image; this only records where it landed. Stored on
 * media.meta rather than as its own media row — a poster is an attribute of the
 * video, and giving it a row would double the asset list with thumbnails.
 */
export async function setVideoPoster(input: {
  mediaId: string;
  blobUrl: string;
}): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: 'Unauthorized' };

  const parsed = posterSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: '输入有误' };

  const [row] = await loadArticleMediaRows([parsed.data.mediaId]);
  if (!row) return { ok: false, error: '素材不存在' };
  if (row.type !== 'video') return { ok: false, error: '只有视频需要封面帧' };

  const meta = (row.meta ?? {}) as AssetMeta & { posterUrl?: string };
  try {
    await db
      .update(media)
      .set({ meta: { ...meta, posterUrl: parsed.data.blobUrl } })
      .where(eq(media.id, parsed.data.mediaId));
  } catch (err) {
    return { ok: false, error: `保存失败：${(err as Error).message}` };
  }

  revalidatePath('/admin/articles/media');
  return { ok: true };
}

// ─── asset management ────────────────────────────────────────────────

function revalidateAssets() {
  revalidatePath('/admin/articles/media');
}

export interface AssetActionResult {
  ok: boolean;
  /** Number of assets affected. */
  count?: number;
  /** Bytes reclaimed, for the delete paths. */
  bytes?: number;
  warnings?: string[];
  error?: string;
}

const shareSchema = z.object({
  mediaId: z.string().uuid(),
  shared: z.boolean(),
});

/**
 * Flip an asset's public-share flag.
 *
 * Stored on media.meta rather than as a column: it's a per-asset toggle with no
 * query or index behind it, and meta already carries the rest of the upload's
 * bookkeeping. The media route reads it to decide whether an asset is readable
 * regardless of its article's publish state.
 */
export async function setAssetShared(input: {
  mediaId: string;
  shared: boolean;
}): Promise<AssetActionResult> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: 'Unauthorized' };

  const parsed = shareSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: '输入有误' };

  const [row] = await loadArticleMediaRows([parsed.data.mediaId]);
  if (!row) return { ok: false, error: '素材不存在' };

  const meta = (row.meta ?? {}) as AssetMeta;
  try {
    await db
      .update(media)
      .set({ meta: { ...meta, shared: parsed.data.shared } })
      .where(eq(media.id, parsed.data.mediaId));
  } catch (err) {
    return { ok: false, error: `设置失败：${(err as Error).message}` };
  }

  revalidateAssets();
  return { ok: true, count: 1 };
}

const deleteAssetsSchema = z.object({
  mediaIds: z.array(z.string().uuid()).min(1).max(500),
  /** Bulk sweep re-checks references; a single delete is an explicit override. */
  requireUnreferenced: z.boolean(),
});

/**
 * Delete assets: storage objects first, then the rows.
 *
 * With requireUnreferenced the references are re-read from article text right
 * before deleting, so an asset that got used between rendering the page and
 * pressing the button survives. Deleting a single asset by hand skips that
 * check — the admin can see it's in use and chose to remove it anyway.
 */
export async function deleteAssets(input: {
  mediaIds: string[];
  requireUnreferenced: boolean;
}): Promise<AssetActionResult> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: 'Unauthorized' };

  const parsed = deleteAssetsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '输入有误' };
  }

  let targets = parsed.data.mediaIds;
  if (parsed.data.requireUnreferenced) {
    targets = await filterStillUnreferenced(targets);
    if (targets.length === 0) {
      return { ok: true, count: 0, bytes: 0, warnings: ['这些素材已被文章引用，未删除任何内容'] };
    }
  }

  const rows = await loadArticleMediaRows(targets);
  if (rows.length === 0) return { ok: false, error: '素材不存在' };

  const bytes = rows.reduce((sum, row) => sum + (row.size ?? 0), 0);
  const warnings = await deleteStoredObjects(rows);

  try {
    await db.delete(media).where(inArray(media.id, rows.map((row) => row.id)));
  } catch (err) {
    return { ok: false, error: `删除失败：${(err as Error).message}` };
  }

  revalidateAssets();
  revalidatePath('/admin/articles');
  return { ok: true, count: rows.length, bytes, warnings };
}

/**
 * Sweep every asset no article references and that is past the grace period.
 *
 * The set is recomputed here rather than taken from the client: the button says
 * "clean up unreferenced assets", so what gets deleted must be whatever is
 * unreferenced at the moment it runs, not what the page showed earlier.
 */
export async function cleanupUnreferencedAssets(): Promise<AssetActionResult> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: 'Unauthorized' };

  const { assets } = await listArticleAssets();
  const sweepable = assets.filter((asset) => asset.sweepable).map((asset) => asset.id);
  if (sweepable.length === 0) return { ok: true, count: 0, bytes: 0 };

  return deleteAssets({ mediaIds: sweepable, requireUnreferenced: true });
}

// ─── comment moderation ──────────────────────────────────────────────

const moderateSchema = z.object({
  commentIds: z.array(z.string().uuid()).min(1),
  action: z.enum(['hide', 'show', 'delete']),
});

export async function moderateComments(input: {
  commentIds: string[];
  action: 'hide' | 'show' | 'delete';
}): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: 'Unauthorized' };

  const parsed = moderateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '输入有误' };
  }
  const { commentIds, action } = parsed.data;

  // Resolve the affected articles first — after a delete the rows are gone and
  // there is nothing left to derive the revalidation paths from.
  const affected = await db
    .select({ contentItemId: articleComments.contentItemId })
    .from(articleComments)
    .where(inArray(articleComments.id, commentIds));

  try {
    if (action === 'delete') {
      await db.delete(articleComments).where(inArray(articleComments.id, commentIds));
    } else {
      await db
        .update(articleComments)
        .set({ status: action === 'hide' ? 'hidden' : 'visible' })
        .where(inArray(articleComments.id, commentIds));
    }
  } catch (err) {
    return { ok: false, error: `操作失败：${(err as Error).message}` };
  }

  const articleIds = [...new Set(affected.map((row) => row.contentItemId))];
  if (articleIds.length > 0) {
    const rows = await db
      .select({ id: contentItems.id, slug: contentItems.slug })
      .from(contentItems)
      .where(and(inArray(contentItems.id, articleIds), eq(contentItems.type, 'article')));
    for (const row of rows) revalidateArticle(row.id, row.slug);
  }

  return { ok: true };
}
