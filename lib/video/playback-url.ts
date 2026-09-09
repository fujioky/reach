// lib/video/playback-url.ts
// Resolve the <video src> URL for share-page playback.
//
// Follows admin settings: external proxy / storage CDN direct links when
// configured, otherwise same-origin /api/proxy-video.

import { getSetting } from '@/lib/settings';
import { getPublicVideoUrl, isVideoStorageKeyStale } from '@/lib/storage/s3';

export type VideoMedia = {
  id: string;
  originalUrl: string;
  blobUrl: string | null;
};

/**
 * URL the server fetches video bytes from (storage uploads). Goes through the
 * configured reverse proxy when there is one: googlevideo streams are bound to
 * the resolver's IP, so only that host can pull them; a direct fetch from Vercel gets 403.
 */
export async function resolveVideoFetchUrl(videoUrl: string): Promise<string> {
  const proxyBase = (await getSetting('video_proxy_url')).trim().replace(/\/$/, '');
  return proxyBase ? `${proxyBase}/${videoUrl}` : videoUrl;
}

export function proxyVideoPath(token: string, mediaId: string): string {
  return `/api/proxy-video?token=${encodeURIComponent(token)}&mediaId=${encodeURIComponent(mediaId)}`;
}

async function buildStoragePublicUrl(storageKey: string): Promise<string | null> {
  const endpoint = await getSetting('video_storage_endpoint');
  const region = await getSetting('video_storage_region');
  const bucket = await getSetting('video_storage_bucket');
  const accessKey = await getSetting('video_storage_access_key');
  const secretKey = await getSetting('video_storage_secret_key');
  const customDomain = await getSetting('video_storage_custom_domain');

  if (!endpoint || !bucket || !accessKey || !secretKey) return null;

  return getPublicVideoUrl(
    {
      endpoint,
      region,
      bucket,
      accessKeyId: accessKey,
      secretAccessKey: secretKey,
      customDomain: customDomain || undefined,
      useVercelProxy: false,
    },
    storageKey,
  );
}

/**
 * Pick the playback URL exposed to the browser per admin settings.
 */
export async function resolveVideoPlaybackUrl(
  token: string,
  video: VideoMedia,
): Promise<string> {
  const storageEnabled = (await getSetting('video_storage_enabled')) === 'true';
  const useVercelProxy = (await getSetting('video_storage_use_vercel_proxy')) === 'true';
  const proxyFailoverEnabled = (await getSetting('video_proxy_failover_enabled')) === 'true';
  const proxyBase = (await getSetting('video_proxy_url')).trim().replace(/\/$/, '');
  const storageKey = video.blobUrl?.replace(/^\//, '') ?? null;
  const storageKeyValid =
    storageKey && !isVideoStorageKeyStale(storageKey, video.originalUrl);

  if (storageEnabled && storageKeyValid && !useVercelProxy) {
    const publicUrl = await buildStoragePublicUrl(storageKey);
    if (publicUrl) return publicUrl;
  }

  const needsProxyVideo =
    (storageEnabled && !storageKeyValid) ||
    (storageEnabled && storageKeyValid && useVercelProxy) ||
    !proxyBase ||
    proxyFailoverEnabled;

  if (!needsProxyVideo) {
    return `${proxyBase}/${video.originalUrl}`;
  }

  return proxyVideoPath(token, video.id);
}