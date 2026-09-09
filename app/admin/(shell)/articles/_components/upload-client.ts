'use client';

// app/admin/(shell)/articles/_components/upload-client.ts
// Browser-side upload for article media. Both paths send bytes straight to
// storage — never through a Route Handler, which on Vercel would cap the
// request body around 4.5MB.

import { upload } from '@vercel/blob/client';
import {
  abortArticleVideoUpload,
  createArticleVideoUpload,
  registerArticleImage,
  registerArticleVideo,
  setVideoPoster,
} from '../actions';
import { captureVideoPoster } from '@/lib/article/video-poster';
import {
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  extensionForType,
  isAllowedImageType,
  isAllowedVideoType,
} from '@/lib/article/media';

export type UploadResult =
  | { ok: true; url: string; kind: 'image' | 'video' }
  | { ok: false; error: string };

/** 0–100, reported as the transfer progresses. */
export type ProgressCallback = (percent: number) => void;

function formatMb(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)}MB`;
}

/** Vercel Blob: mint a client token via our route, then PUT to Blob directly. */
async function uploadImage(
  articleId: string,
  file: File,
  onProgress?: ProgressCallback,
): Promise<UploadResult> {
  if (!isAllowedImageType(file.type)) {
    return { ok: false, error: `不支持的图片格式：${file.type || '未知'}` };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { ok: false, error: `图片超过 ${formatMb(MAX_IMAGE_BYTES)} 上限` };
  }

  const pathname = `articles/images/${crypto.randomUUID()}.${extensionForType(file.type)}`;
  const blob = await upload(pathname, file, {
    access: 'private',
    handleUploadUrl: '/api/article-upload/image',
    contentType: file.type,
    onUploadProgress: ({ percentage }) => onProgress?.(percentage),
  });

  const registered = await registerArticleImage({
    articleId,
    blobUrl: blob.url,
    contentType: file.type,
    size: file.size,
    filename: file.name,
  });
  if (!registered.ok || !registered.url) {
    return { ok: false, error: registered.error ?? '图片登记失败' };
  }
  return { ok: true, url: registered.url, kind: 'image' };
}

/**
 * S3/R2 multipart: how many parts fly at once, how often a part may retry, and
 * how long one part gets before it counts as stalled.
 *
 * The direct route to the storage endpoint is erratic — throughput swings from
 * MB/s to a dead stall within a minute — so resilience comes from the part
 * size: a bad connection costs one ~8MB retry instead of the whole file, and a
 * stalled part hits the timeout instead of hanging the upload at 0% forever.
 */
const PART_CONCURRENCY = 3;
const PART_ATTEMPTS = 4;
const PART_TIMEOUT_MS = 120_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * PUT one part to its presigned URL.
 *
 * XHR rather than fetch — fetch still has no upload-progress event, and a
 * silent progress bar on a 200MB video is worse than no upload at all.
 */
function putPart(
  url: string,
  body: Blob,
  onBytes: (loaded: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);
    xhr.timeout = PART_TIMEOUT_MS;
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onBytes(event.loaded);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`存储返回 HTTP ${xhr.status}`));
    };
    xhr.onerror = () =>
      reject(
        new Error(
          '无法连接存储服务 — 请确认存储桶已允许本站域名的跨域 PUT（CORS）',
        ),
      );
    xhr.ontimeout = () => reject(new Error('连接停滞'));
    xhr.onabort = () => reject(new Error('上传已取消'));
    xhr.send(body);
  });
}

/**
 * Upload every part of the file: a small worker pool pulls part indexes off a
 * shared cursor, each part retries independently with backoff, and progress is
 * the sum of bytes accepted across all parts.
 */
async function putParts(
  file: File,
  partUrls: string[],
  partSize: number,
  onProgress?: ProgressCallback,
): Promise<void> {
  const loaded: number[] = new Array(partUrls.length).fill(0);
  const report = () => {
    const sum = loaded.reduce((a, b) => a + b, 0);
    // Cap at 99 — 100 is for when registerArticleVideo has sealed the object.
    onProgress?.(Math.min(99, Math.round((sum / file.size) * 100)));
  };

  let next = 0;
  let failed = false;

  async function uploadPart(index: number): Promise<void> {
    const body = file.slice(index * partSize, Math.min((index + 1) * partSize, file.size));
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= PART_ATTEMPTS; attempt++) {
      try {
        await putPart(partUrls[index], body, (bytes) => {
          loaded[index] = bytes;
          report();
        });
        loaded[index] = body.size;
        report();
        return;
      } catch (err) {
        lastError = err as Error;
        loaded[index] = 0;
        report();
        if (attempt < PART_ATTEMPTS) await sleep(1000 * 2 ** (attempt - 1));
      }
    }
    throw new Error(
      `分块 ${index + 1}/${partUrls.length} 重试 ${PART_ATTEMPTS} 次后仍失败：${lastError?.message}`,
    );
  }

  const workers = Array.from(
    { length: Math.min(PART_CONCURRENCY, partUrls.length) },
    async () => {
      while (!failed) {
        const index = next++;
        if (index >= partUrls.length) return;
        try {
          await uploadPart(index);
        } catch (err) {
          failed = true; // stop the other workers from starting new parts
          throw err;
        }
      }
    },
  );
  await Promise.all(workers);
}

async function uploadVideo(
  articleId: string,
  file: File,
  onProgress?: ProgressCallback,
): Promise<UploadResult> {
  if (!isAllowedVideoType(file.type)) {
    return { ok: false, error: `不支持的视频格式：${file.type || '未知'}` };
  }
  if (file.size > MAX_VIDEO_BYTES) {
    return { ok: false, error: `视频超过 ${formatMb(MAX_VIDEO_BYTES)} 上限` };
  }

  const ticket = await createArticleVideoUpload({
    articleId,
    contentType: file.type,
    size: file.size,
  });
  if (!ticket.ok || !ticket.key || !ticket.uploadId || !ticket.partSize || !ticket.partUrls) {
    return { ok: false, error: ticket.error ?? '无法生成上传地址' };
  }

  try {
    await putParts(file, ticket.partUrls, ticket.partSize, onProgress);
  } catch (err) {
    // Parts already in the bucket are useless without a completion — drop them.
    void abortArticleVideoUpload({ key: ticket.key, uploadId: ticket.uploadId });
    return { ok: false, error: (err as Error).message };
  }

  const registered = await registerArticleVideo({
    articleId,
    key: ticket.key,
    uploadId: ticket.uploadId,
    contentType: file.type,
    size: file.size,
    filename: file.name,
  });
  if (!registered.ok || !registered.url) {
    return { ok: false, error: registered.error ?? '视频登记失败' };
  }
  onProgress?.(100);

  // Capture a poster frame while the file is still in the page — the browser
  // decodes one frame locally, which no server-side path can match without
  // shipping ffmpeg. Entirely best-effort: a video without a poster still
  // works, so nothing here can fail the upload.
  if (registered.mediaId) {
    void attachPoster(registered.mediaId, file);
  }

  return { ok: true, url: registered.url, kind: 'video' };
}

/**
 * Grab a still from a video and store it as that video's poster.
 *
 * Runs detached from the upload so the author isn't kept waiting on a
 * thumbnail, and swallows every failure: an undecodable codec should cost a
 * poster, not the upload that produced it.
 */
export async function attachPoster(mediaId: string, source: File | string): Promise<void> {
  try {
    const poster = await captureVideoPoster(source);
    if (!poster) return;

    const blob = await upload(`articles/posters/${mediaId}.jpg`, poster.blob, {
      access: 'private',
      handleUploadUrl: '/api/article-upload/image',
      contentType: 'image/jpeg',
    });
    await setVideoPoster({ mediaId, blobUrl: blob.url });
  } catch {
    // Best effort — see above.
  }
}

/** Route a file to the right backend by its MIME type. */
export async function uploadArticleFile(
  articleId: string,
  file: File,
  onProgress?: ProgressCallback,
): Promise<UploadResult> {
  try {
    if (file.type.startsWith('image/')) return await uploadImage(articleId, file, onProgress);
    if (file.type.startsWith('video/')) return await uploadVideo(articleId, file, onProgress);
    return { ok: false, error: `只支持图片和视频，当前文件类型：${file.type || '未知'}` };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
