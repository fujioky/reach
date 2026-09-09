// lib/article/remote-import.ts
// The transfer itself: resolve a pasted URL to a media file, pull the bytes
// into this site's storage, record a media row.
//
// Split out of the Server Action because a Server Action can only answer once.
// The import takes anywhere from a second to a couple of minutes — a 400MB
// video is downloaded and re-uploaded server-side — and until now the author
// watched a spinner with no idea whether anything was happening, which item was
// in flight, or which of the pasted links had already failed. Everything here
// reports through `onStage`, so /api/article-media/import can stream the same
// run to the browser while the Server Action ignores it and just awaits the
// result.

import { db, media } from '@/lib/db';
import { articleMediaUrl } from '@/lib/article/markdown';
import { getArticleById } from '@/lib/article/queries';
import {
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  articleImagePathname,
  articleVideoStorageKey,
  extensionForType,
  isAllowedImageType,
  isAllowedVideoType,
  loadArticleS3Config,
} from '@/lib/article/media';
import {
  RemoteImportError,
  guessTypeFromUrl,
  isAmbiguousContentType,
  readBodyLimited,
  resolveRemoteMedia,
  type ResolveStage,
} from '@/lib/article/remote-fetch';
import { loadAiParserConfig } from '@/lib/article/ai-resolver';

/** Where an import is, moment to moment. */
export type ImportStage =
  /** Walking redirects and player pages towards the actual file. */
  | { phase: 'resolving'; url?: string }
  /** The rules found nothing; a model is reading the page. */
  | { phase: 'ai'; url?: string }
  /** Bytes are moving. `total` is 0 when the server didn't declare a length. */
  | { phase: 'downloading'; percent: number; received?: number; total?: number }
  /** Video only: the download finished, the multipart upload is draining. */
  | { phase: 'uploading'; percent: number }
  /** Writing the media row. */
  | { phase: 'saving' };

export interface ImportOutcome {
  ok: boolean;
  /** In-app URL to paste into the Markdown body. */
  url?: string;
  mediaId?: string;
  kind?: 'image' | 'video';
  /** Bytes stored, when known. */
  size?: number;
  /** True when the LLM fallback is what found the file. */
  viaAi?: boolean;
  /** The URL the bytes actually came from, when it isn't what was pasted. */
  resolvedFrom?: string;
  error?: string;
}

/**
 * Import media from a remote URL into an article's own storage.
 *
 * Copies rather than hot-links, matching what the rest of the app does with
 * fetched content: an external URL rots, gets hotlink-blocked, or changes under
 * the article. After import the body references the in-app media URL, exactly
 * as it would for a file dragged in from the desktop.
 *
 * The URL comes from a human, so it goes through lib/article/remote-fetch.ts
 * (scheme check, private-address rejection, per-hop redirect validation) before
 * the server touches the network. Callers are responsible for auth.
 */
export async function importRemoteMediaToArticle(params: {
  articleId: string;
  url: string;
  onStage?: (stage: ImportStage) => void;
}): Promise<ImportOutcome> {
  const { articleId, url, onStage } = params;

  const article = await getArticleById(articleId);
  if (!article) return { ok: false, error: '文章不存在' };

  const ai = await loadAiParserConfig();

  onStage?.({ phase: 'resolving', url });
  let remote: Awaited<ReturnType<typeof resolveRemoteMedia>>;
  try {
    remote = await resolveRemoteMedia(url, {
      ai,
      onStage: (stage: ResolveStage) => {
        if (stage.kind === 'ai') onStage?.({ phase: 'ai', url: stage.url });
        else onStage?.({ phase: 'resolving', url: stage.url });
      },
    });
  } catch (err) {
    if (err instanceof RemoteImportError) return { ok: false, error: err.message };
    return { ok: false, error: `抓取失败：${(err as Error).message}` };
  }

  const resolvedFrom = remote.finalUrl !== url ? remote.finalUrl : undefined;
  const provenance = { viaAi: remote.viaAi === true, ...(resolvedFrom ? { resolvedFrom } : {}) };

  // The URL extension is consulted only when the server said nothing useful
  // (octet-stream and friends). A header that states a real type is believed —
  // trusting the extension over it is how an HTML player page served at a .mp4
  // address ends up stored as the video.
  const contentType = isAmbiguousContentType(remote.contentType)
    ? guessTypeFromUrl(remote.finalUrl) || remote.contentType
    : remote.contentType;

  const isImage = isAllowedImageType(contentType);
  const isVideo = isAllowedVideoType(contentType);
  if (!isImage && !isVideo) {
    await remote.response.body?.cancel();
    return {
      ok: false,
      ...provenance,
      error: `不支持的文件类型：${remote.contentType || '未知'}（支持常见图片与 mp4 / webm / mov）`,
    };
  }

  const filename = decodeURIComponent(remote.finalUrl.split('/').pop()?.split('?')[0] ?? '') || null;

  // ── images: buffer (bounded by MAX_IMAGE_BYTES) → Vercel Blob ──
  if (isImage) {
    if (remote.declaredSize > MAX_IMAGE_BYTES) {
      await remote.response.body?.cancel();
      return {
        ok: false,
        ...provenance,
        error: `图片超过 ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB 上限`,
      };
    }

    let buffer: Buffer;
    try {
      onStage?.({ phase: 'downloading', percent: 0, received: 0, total: remote.declaredSize });
      buffer = await readBodyLimited(remote.response, MAX_IMAGE_BYTES, (received, total) => {
        onStage?.({
          phase: 'downloading',
          // Without a Content-Length there is no denominator, so the bar can
          // only say "started" until the body ends.
          percent: total > 0 ? Math.min(99, Math.round((received / total) * 100)) : 0,
          received,
          total,
        });
      });
    } catch (err) {
      if (err instanceof RemoteImportError) return { ok: false, ...provenance, error: err.message };
      return { ok: false, ...provenance, error: `下载失败：${(err as Error).message}` };
    }

    onStage?.({ phase: 'uploading', percent: 0 });
    let blobUrl: string;
    try {
      const { put } = await import('@vercel/blob');
      const blob = await put(articleImagePathname(contentType), buffer, {
        access: 'private',
        contentType,
        addRandomSuffix: true,
        ...(process.env.BLOB_READ_WRITE_TOKEN
          ? { token: process.env.BLOB_READ_WRITE_TOKEN }
          : {}),
      });
      blobUrl = blob.url;
    } catch (err) {
      return { ok: false, ...provenance, error: `存储失败：${(err as Error).message}` };
    }

    onStage?.({ phase: 'saving' });
    const [row] = await db
      .insert(media)
      .values({
        contentItemId: article.id,
        type: 'image',
        originalUrl: blobUrl,
        blobUrl,
        size: buffer.byteLength,
        meta: {
          source: 'article',
          contentType,
          filename,
          importedFrom: remote.finalUrl,
          ...(remote.viaAi ? { resolvedBy: 'ai' } : {}),
        },
      })
      .returning({ id: media.id });

    return {
      ok: true,
      ...provenance,
      mediaId: row!.id,
      url: articleMediaUrl(row!.id, extensionForType(contentType)),
      kind: 'image',
      size: buffer.byteLength,
    };
  }

  // ── videos: stream straight into S3/R2 multipart, never buffered ──
  // A 500MB video cannot be held in a serverless function's memory, so the
  // download and the upload run as one pipeline.
  await remote.response.body?.cancel(); // downloadAndUploadVideo re-opens the URL

  if (remote.declaredSize > MAX_VIDEO_BYTES) {
    return {
      ok: false,
      ...provenance,
      error: `视频超过 ${Math.round(MAX_VIDEO_BYTES / 1024 / 1024)}MB 上限`,
    };
  }

  const config = await loadArticleS3Config();
  if (!config) {
    return {
      ok: false,
      ...provenance,
      error: '视频存储尚未配置，请先在「系统设置」中填写 S3/R2 参数',
    };
  }

  const key = articleVideoStorageKey(contentType);
  const { downloadAndUploadVideo } = await import('@/lib/storage/s3');

  onStage?.({ phase: 'downloading', percent: 0, received: 0, total: remote.declaredSize });
  let phase: 'downloading' | 'uploading' = 'downloading';
  const upload = await downloadAndUploadVideo(config, config.bucket, remote.finalUrl, key, {
    maxBytes: MAX_VIDEO_BYTES,
    // finalUrl already passed the SSRF checks; a fresh redirect from here would
    // reach a host that never did.
    disallowRedirects: true,
    onStage: (next) => {
      phase = next;
    },
    onProgress: (percent) => {
      onStage?.(
        phase === 'uploading'
          ? { phase: 'uploading', percent }
          : {
              phase: 'downloading',
              percent,
              received: remote.declaredSize
                ? Math.round((remote.declaredSize * percent) / 100)
                : undefined,
              total: remote.declaredSize,
            },
      );
    },
  });
  if (!upload.ok) return { ok: false, ...provenance, error: `视频转存失败：${upload.error}` };

  onStage?.({ phase: 'saving' });
  const [row] = await db
    .insert(media)
    .values({
      contentItemId: article.id,
      type: 'video',
      originalUrl: key,
      blobUrl: key,
      size: remote.declaredSize,
      meta: {
        source: 'article',
        contentType,
        filename,
        importedFrom: remote.finalUrl,
        ...(remote.viaAi ? { resolvedBy: 'ai' } : {}),
      },
    })
    .returning({ id: media.id });

  return {
    ok: true,
    ...provenance,
    mediaId: row!.id,
    url: articleMediaUrl(row!.id, extensionForType(contentType)),
    kind: 'video',
    size: remote.declaredSize,
  };
}
