// lib/article/media.ts
// Storage plumbing for media attached to self-authored articles.
//
// Two backends, split by size and by what each one is good at:
//   images → Vercel Blob (private store), same as mirror images
//   videos → the S3/R2 bucket already configured for mirror video persistence
//
// Both are uploaded straight from the browser. Routing bytes through a Route
// Handler is not an option on Vercel: the request body cap (~4.5MB) would
// reject any real video and most photos off a phone. Blob has a first-party
// client-upload flow; S3/R2 gets a presigned PUT.

import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  ListPartsCommand,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import { createS3Client, type S3Config } from '@/lib/storage/s3';
import { getSetting } from '@/lib/settings';

/** Accepted image types for article uploads. */
export const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/svg+xml',
] as const;

/** Accepted video types. Progressive containers only — no HLS playlists. */
export const ALLOWED_VIDEO_TYPES = [
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-m4v',
  'video/ogg',
] as const;

/** Per-file ceilings, enforced client-side and re-checked server-side. */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // 20MB
export const MAX_VIDEO_BYTES = 500 * 1024 * 1024; // 500MB

/** How long a presigned video part PUT stays usable. */
const VIDEO_UPLOAD_URL_TTL_SECONDS = 3600;

/**
 * Video uploads are chunked into parts of this size and each part is retried
 * independently. The direct route to the S3 endpoint is erratic (throughput
 * swings from MB/s to a dead stall within a minute), so one flaky connection
 * must cost an 8MB retry, not the whole file. S3 multipart requires ≥5MB for
 * every part except the last.
 */
export const VIDEO_UPLOAD_PART_BYTES = 8 * 1024 * 1024;

/**
 * How long a presigned video GET stays usable.
 *
 * A player re-requests the same URL on every seek, so this has to outlast
 * watching the video, not just starting it.
 */
const VIDEO_DOWNLOAD_URL_TTL_SECONDS = 6 * 3600;

const EXTENSION_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/x-m4v': 'm4v',
  'video/ogg': 'ogv',
};

const TYPE_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v',
  ogv: 'video/ogg',
};

/** File extension for a MIME type; 'bin' for anything unrecognized. */
export function extensionForType(contentType: string): string {
  return EXTENSION_BY_TYPE[contentType.split(';')[0].trim().toLowerCase()] ?? 'bin';
}

/** MIME type for a file extension; octet-stream for anything unrecognized. */
export function typeForExtension(extension: string): string {
  return TYPE_BY_EXTENSION[extension.toLowerCase()] ?? 'application/octet-stream';
}

export function isAllowedImageType(contentType: string): boolean {
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(
    contentType.split(';')[0].trim().toLowerCase(),
  );
}

export function isAllowedVideoType(contentType: string): boolean {
  return (ALLOWED_VIDEO_TYPES as readonly string[]).includes(
    contentType.split(';')[0].trim().toLowerCase(),
  );
}

/**
 * Blob pathname for an article image.
 *
 * A UUID rather than the original filename: Blob paths are not access
 * controlled by themselves, so a guessable path is a leak (same reasoning as
 * lib/blob/download-image.ts).
 */
export function articleImagePathname(contentType: string): string {
  return `articles/images/${randomUUID()}.${extensionForType(contentType)}`;
}

/** S3/R2 object key for an article video. */
export function articleVideoStorageKey(contentType: string): string {
  return `articles/videos/${randomUUID()}.${extensionForType(contentType)}`;
}

/** Read the S3/R2 credentials from app_settings; null when not configured. */
export async function loadArticleS3Config(): Promise<S3Config | null> {
  const [endpoint, region, bucket, accessKeyId, secretAccessKey, customDomain] = await Promise.all([
    getSetting('video_storage_endpoint'),
    getSetting('video_storage_region'),
    getSetting('video_storage_bucket'),
    getSetting('video_storage_access_key'),
    getSetting('video_storage_secret_key'),
    getSetting('video_storage_custom_domain'),
  ]);
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  return {
    endpoint,
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
    ...(customDomain.trim() ? { customDomain: customDomain.trim() } : {}),
  };
}

/**
 * Open a multipart upload and presign a PUT for every part, so the browser can
 * upload a video straight to S3/R2 in independently-retried chunks.
 *
 * The bucket must allow cross-origin PUT from the site's origin, otherwise the
 * browser blocks the request before it leaves — see docs/article-publishing.md
 * for the CORS rule.
 */
export async function createVideoMultipartUpload(
  config: S3Config,
  key: string,
  contentType: string,
  partCount: number,
): Promise<{ uploadId: string; partUrls: string[] }> {
  const client = createS3Client(config);
  const { UploadId } = await client.send(
    new CreateMultipartUploadCommand({
      Bucket: config.bucket,
      Key: key,
      ContentType: contentType,
    }),
  );
  if (!UploadId) throw new Error('存储未返回 uploadId');

  const partUrls = await Promise.all(
    Array.from({ length: partCount }, (_, i) =>
      getSignedUrl(
        client,
        new UploadPartCommand({
          Bucket: config.bucket,
          Key: key,
          UploadId,
          PartNumber: i + 1,
        }),
        { expiresIn: VIDEO_UPLOAD_URL_TTL_SECONDS },
      ),
    ),
  );
  return { uploadId: UploadId, partUrls };
}

/**
 * Seal a multipart upload into the final object.
 *
 * Part ETags come from a server-side ListParts rather than from the browser:
 * the storage already knows what it received, and this way the client never
 * needs to read response headers across origins (no ExposeHeaders dependency)
 * or be trusted about what it uploaded.
 */
export async function completeVideoMultipartUpload(
  config: S3Config,
  key: string,
  uploadId: string,
): Promise<void> {
  const client = createS3Client(config);
  const listed = await client.send(
    new ListPartsCommand({ Bucket: config.bucket, Key: key, UploadId: uploadId }),
  );
  const parts = (listed.Parts ?? [])
    .map((p) => ({ PartNumber: p.PartNumber, ETag: p.ETag }))
    .sort((a, b) => (a.PartNumber ?? 0) - (b.PartNumber ?? 0));
  if (parts.length === 0) throw new Error('存储中没有任何已上传的分块');

  await client.send(
    new CompleteMultipartUploadCommand({
      Bucket: config.bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: parts },
    }),
  );
}

/** Discard an abandoned multipart upload so its parts stop taking up storage. */
export async function abortVideoMultipartUpload(
  config: S3Config,
  key: string,
  uploadId: string,
): Promise<void> {
  const client = createS3Client(config);
  await client.send(
    new AbortMultipartUploadCommand({ Bucket: config.bucket, Key: key, UploadId: uploadId }),
  );
}

/**
 * Presign a GET so the browser can read a stored video straight from S3/R2.
 *
 * ⚠️ The signature only actually gates access on the S3 endpoint. **An R2
 * custom domain serves the bucket publicly** — that is what connecting a custom
 * domain means in R2 — and ignores SigV4 parameters entirely: an object there
 * answers 206 with no signature, or with a nonsense one. So when customDomain
 * is set, the returned URL is effectively a public, non-expiring address that
 * happens to carry unused query parameters.
 *
 * The signing still matters for the endpoint path (no custom domain → the
 * signature is what authorises the read), and it costs nothing to keep, so the
 * behaviour is uniform. But do not read this function as "direct delivery is
 * private": with a custom domain configured, anything the media route redirects
 * to is reachable by whoever obtains that URL, indefinitely.
 *
 * Access control therefore lives at /api/article-media (signed `?t=` tokens),
 * not at the storage layer. Making the storage layer private too would mean
 * dropping the custom domain, or putting Cloudflare Access in front of it.
 */
export async function presignVideoDownload(
  config: S3Config,
  key: string,
  expiresIn = VIDEO_DOWNLOAD_URL_TTL_SECONDS,
): Promise<string> {
  const client = createS3Client(config);
  const signed = await getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: config.bucket, Key: key }),
    { expiresIn },
  );

  if (!config.customDomain) return signed;

  // Swap the endpoint host for the custom domain. The signature rides along
  // unused — the custom domain serves the object publicly and never checks it —
  // but routing through that host is still what puts the bytes on the CDN
  // instead of the raw endpoint.
  try {
    const signedUrl = new URL(signed);
    const custom = new URL(config.customDomain);
    // The presigned path is /<bucket>/<key> (forcePathStyle); a custom domain
    // is already bound to the bucket, so that prefix has to come off.
    const bucketPrefix = `/${config.bucket}/`;
    const path = signedUrl.pathname.startsWith(bucketPrefix)
      ? signedUrl.pathname.slice(bucketPrefix.length - 1)
      : signedUrl.pathname;
    return `${custom.origin}${path}${signedUrl.search}`;
  } catch {
    return signed; // malformed custom domain — the raw endpoint still works
  }
}
