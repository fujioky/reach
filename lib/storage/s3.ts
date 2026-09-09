// lib/storage/s3.ts
// S3-compatible storage client for video persistence (Cloudflare R2, AWS S3,
// MinIO, etc.).
//
// Exposes:
//   - checkS3Connection(): quick health check (HeadBucket)
//   - getPublicVideoUrl(): public URL for a stored video key, honoring custom
//     domain and the Vercel-app proxy acceleration flag
//   - uploadVideoBuffer(): upload a video buffer to the configured bucket
//
// Credentials and endpoint are read from app_settings at call sites. This keeps
// the client stateless and allows runtime configuration changes.

import { S3Client, HeadBucketCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Readable } from 'stream';
import { createHash } from 'crypto';
import { fetchInChunks } from '@/lib/video/chunked-fetch';

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  customDomain?: string;
  useVercelProxy?: boolean;
}

/**
 * Build an S3 client from runtime settings. Compatible with R2 (region 'auto'),
 * AWS S3, and other S3-compatible services.
 */
export function createS3Client(config: S3Config): S3Client {
  const { endpoint, region, accessKeyId, secretAccessKey } = config;

  return new S3Client({
    endpoint,
    region: region === 'auto' ? 'us-east-1' : region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    forcePathStyle: true,
    // AWS SDK ≥3.729 defaults to WHEN_SUPPORTED, which bakes an (empty-body)
    // CRC32 into presigned PUT URLs — R2 then rejects the browser's actual
    // upload with a checksum mismatch. WHEN_REQUIRED restores plain SigV4.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

/**
 * Quick health check: try to HeadBucket. Returns latencyMs and any error.
 */
export async function checkS3Connection(
  config: S3Config,
): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const t0 = Date.now();
  const client = createS3Client(config);
  try {
    await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
    return { ok: true, latencyMs: Date.now() - t0 };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - t0,
      error: (err as Error).message,
    };
  }
}

/**
 * Compute the public URL for a stored video key.
 *
 * Priority:
 *   1. If useVercelProxy is true -> https://<vercel-app>/api/storage/video?key=<key>
 *      (allows the Vercel app to cache / authenticate / accelerate)
 *   2. If customDomain is set -> https://<customDomain>/<key>
 *   3. Fallback -> https://<endpoint>/<bucket>/<key>
 */
export function getPublicVideoUrl(config: S3Config, key: string): string {
  if (config.useVercelProxy) {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? '';
    const base = siteUrl.replace(/\/$/, '');
    if (base) {
      return `${base}/api/storage/video?key=${encodeURIComponent(key)}`;
    }
  }

  if (config.customDomain) {
    const domain = config.customDomain.replace(/\/$/, '');
    return `${domain}/${key}`;
  }

  const endpoint = config.endpoint.replace(/\/$/, '');
  return `${endpoint}/${config.bucket}/${key}`;
}

/**
 * Upload a video buffer to S3/R2. The key should include an extension.
 * Returns the public URL for the stored object.
 */
export async function uploadVideoBuffer(
  configOrClient: S3Config | S3Client,
  bucket: string,
  key: string,
  buffer: Buffer,
  contentType: string = 'video/mp4',
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const client = configOrClient instanceof S3Client ? configOrClient : createS3Client(configOrClient);
  const config = configOrClient instanceof S3Client ? null : configOrClient;
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      }),
    );
    return { ok: true, url: config ? getPublicVideoUrl(config, key) : key };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * Download a video from upstream and upload it to S3/R2, streaming chunks
 * straight into a multipart upload — memory use stays around
 * partSize × queueSize (~32MB) regardless of video size.
 * Returns the storage key on success. Returns null on failure (failures are
 * non-blocking — the caller falls back to the proxy URL).
 */
export async function downloadAndUploadVideo(
  configOrClient: S3Config | S3Client,
  bucket: string,
  sourceUrl: string,
  key: string,
  options?: {
    maxBytes?: number;
    timeoutMs?: number;
    onStage?: (stage: 'downloading' | 'uploading') => void;
    onProgress?: (percent: number) => void;
    /**
     * Fail instead of following a redirect. Set by the article remote-import
     * flow, where sourceUrl is a URL the admin typed: it has already been
     * validated against private address ranges, and a redirect here would
     * reach a host that never went through that check.
     */
    disallowRedirects?: boolean;
  },
): Promise<{ ok: true; key: string } | { ok: false; error: string }> {
  // timeoutMs bounds the whole transfer: upload consumes the fetch body, so the
  // fetch abort signal stays armed until the last chunk is read.
  const {
    maxBytes = 300 * 1024 * 1024,
    timeoutMs = 240000,
    onStage,
    onProgress,
    disallowRedirects = false,
  } = options ?? {};

  try {
    onStage?.('downloading');
    onProgress?.(0);
    // Bounded-range chunks: googlevideo 403s open-ended downloads.
    const res = await fetchInChunks(sourceUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ReachStorage/1.0)',
        'Accept': 'video/*,*/*',
      },
      ...(disallowRedirects ? { redirect: 'error' as const } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      return { ok: false, error: `Upstream HTTP ${res.status}` };
    }

    const contentType = res.contentType.toLowerCase();
    if (
      contentType.includes('mpegurl') ||
      contentType.includes('m3u8') ||
      contentType.includes('application/x-mpegurl')
    ) {
      return { ok: false, error: 'Source is HLS playlist, not progressive MP4' };
    }

    const total = res.total;
    if (total > maxBytes) {
      return { ok: false, error: `Video exceeds max size ${maxBytes} bytes` };
    }

    const body = res.body;
    const reader = body.getReader();

    // Sniff the head before opening the multipart upload: some upstreams serve
    // an HLS playlist with a video/mp4 content-type.
    const headChunks: Uint8Array[] = [];
    let headBytes = 0;
    while (headBytes < 512) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        headChunks.push(value);
        headBytes += value.byteLength;
      }
    }
    const head = Buffer.concat(headChunks).subarray(0, 512).toString('utf8').trimStart();
    if (head.startsWith('#EXTM3U')) {
      return { ok: false, error: 'Downloaded content is HLS playlist, not MP4' };
    }

    // Re-yield the sniffed head, then pump the rest of the body, enforcing
    // maxBytes and reporting download progress as chunks are handed to the
    // uploader.
    let received = 0;
    let downloadDone = false;
    async function* pump() {
      for (const chunk of headChunks) {
        received += chunk.byteLength;
        yield chunk;
      }
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          received += value.byteLength;
          if (received > maxBytes) {
            throw new Error(`Video exceeds max size ${maxBytes} bytes`);
          }
          if (total > 0 && !downloadDone) {
            onProgress?.(Math.min(99, Math.round((received / total) * 100)));
          }
          yield value;
        }
      }
      downloadDone = true;
      onProgress?.(100);
      onStage?.('uploading');
    }

    const client = configOrClient instanceof S3Client ? configOrClient : createS3Client(configOrClient);
    const upload = new Upload({
      client,
      params: {
        Bucket: bucket,
        Key: key,
        Body: Readable.from(pump()),
        ContentType: res.contentType,
      },
      partSize: 8 * 1024 * 1024,
      queueSize: 4,
      // default leavePartsOnError=false → multipart upload is aborted on failure
    });

    // After the download finishes, surface the tail of the upload (parts still
    // in flight) as upload-stage progress.
    upload.on('httpUploadProgress', (p) => {
      if (downloadDone && p.loaded && received > 0) {
        onProgress?.(Math.min(99, Math.round((p.loaded / received) * 100)));
      }
    });

    await upload.done();
    onProgress?.(100); // upload complete

    return { ok: true, key };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * Generate a deterministic storage key for a video based on its source URL.
 * Uses a short SHA-256 hash so the same upstream URL maps to the same object.
 */
export function videoStorageKey(sourceUrl: string): string {
  const hash = createHash('sha256').update(sourceUrl).digest('hex').slice(0, 16);
  return `videos/${hash}.mp4`;
}

/** True when a stored blob was keyed from a different upstream URL (e.g. m3u8 vs mp4). */
export function isVideoStorageKeyStale(
  storageKey: string | null | undefined,
  sourceUrl: string,
): boolean {
  if (!storageKey) return false;
  const normalized = storageKey.replace(/^\//, '');
  return normalized !== videoStorageKey(sourceUrl);
}
