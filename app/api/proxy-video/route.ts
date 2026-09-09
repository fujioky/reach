// app/api/proxy-video/route.ts
// Streaming proxy Route Handler — token+mediaId validated (D-41, SHRE-08).
//
// SECURITY (D-41, SHRE-08):
// - No `url` query param accepted (SSRF protection — TM-04-02-T1).
// - videoUrl is ONLY sourced from DB media.originalUrl (createMirror already
//   validated the source URL via zod whitelist).
// - Caller must present a valid token (active share) + mediaId that belongs
//   to that share's contentItem AND is type=video (TM-04-02-T2 traversal guard).
//
// URL freshness (D-13/D-14):
// - media.meta.fetchedAt is an ISO string; if older than ~6h, refreshVideoUrl
//   re-fetches fresh googlevideo URLs and updates the DB. Refresh failure
//   degrades gracefully to the stale URL (let upstream return the error).
//
// PATTERNS landmine #16: refreshVideoUrl(url) is fetchContent(url) — needs
//   the original post URL (contentItems.sourceUrl), NOT the googlevideo URL.
// PATTERNS landmine #11: meta.fetchedAt is an ISO string — parse with new Date().

export const runtime = 'nodejs'; // Use Node.js runtime, NOT edge (need full fetch + streaming)
export const maxDuration = 300; // Hobby Fluid Compute max (seconds)

import { db, shares, contentItems, media } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { refreshVideoUrl } from '@/lib/fetcher';
import { getSetting, recordProxyError, clearProxyErrorIfSet } from '@/lib/settings';
import { checkShareMediaAccess, parseVisitorFromRequest } from '@/lib/access/share-media';
import {
  createS3Client,
  downloadAndUploadVideo,
  getPublicVideoUrl,
  isVideoStorageKeyStale,
  videoStorageKey,
} from '@/lib/storage/s3';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import {
  buildVideoProxyChain,
  fetchVideoUpstream,
} from '@/lib/video/failover';
import { buildStreamResponseHeaders } from '@/lib/video/stream-http';
import { parseRangeHeader } from '@/lib/video/chunked-fetch';
import { resolveVideoFetchUrl } from '@/lib/video/playback-url';

// D-13: googlevideo URLs expire ~6h; refresh if older than this threshold.
const VIDEO_URL_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');
  const mediaId = searchParams.get('mediaId');

  // Health check: the local Vercel function can be probed without a share token.
  // This is used by the settings page "检测" button for the Vercel proxy mode.
  if (searchParams.get('health') === '1') {
    return new Response('ok', { status: 200 });
  }

  // D-41: no url param — only token + mediaId accepted (SSRF protection)
  if (!token || !mediaId) {
    return new Response('Missing token or mediaId', { status: 400 });
  }

  const { cookie: visitorCookie, ip: visitorIp } = parseVisitorFromRequest(request);
  const access = await checkShareMediaAccess(token, visitorCookie, visitorIp);
  if (!access.allowed) {
    const status = access.reason === 'not_found' ? 404 : 403;
    return new Response(access.reason === 'not_found' ? 'Invalid token' : 'Link expired', {
      status,
    });
  }
  const share = access.share;

  // ② Validate mediaId — must belong to this share's contentItem and be a video
  const [mediaRow] = await db
    .select()
    .from(media)
    .where(eq(media.id, mediaId))
    .limit(1);
  if (!mediaRow) return new Response('Media not found', { status: 404 });
  if (mediaRow.contentItemId !== share.contentItemId)
    return new Response('Forbidden', { status: 403 });
  if (mediaRow.type !== 'video') return new Response('Not a video', { status: 400 });

  // ③ Source the googlevideo URL from DB (never from query params — SSRF guard)
  let videoUrl = mediaRow.originalUrl;

  // ④ Check fetchedAt staleness (D-13 ~6h threshold)
  // PATTERNS landmine #11: meta.fetchedAt is an ISO string
  type VideoMeta = {
    selectedSource?: unknown;
    fetchedAt?: string;
    proxyStatus?: string;  // observable stage: refreshing | downloading | uploading | fresh | ready | error
    proxyStatusAt?: string; // ISO timestamp of last status update
    proxyError?: string;  // technical error detail for visitor observability UI
    proxyProgress?: number; // 0-100 progress for the current stage
  };
  const meta = mediaRow.meta as VideoMeta | null;
  const fetchedAt = meta?.fetchedAt;

  // Helper: write proxyStatus to DB (fire-and-forget, best-effort).
  // When status is 'error', optionally store errorDetail for the frontend.
  // When status is non-error, clear any previous proxyError.
  const setStatus = (status: string, errorDetail?: string) => {
    const newMeta: VideoMeta = { ...meta, proxyStatus: status, proxyStatusAt: new Date().toISOString() };
    if (status === 'error' && errorDetail) {
      newMeta.proxyError = errorDetail;
    } else if (status !== 'error') {
      delete newMeta.proxyError;
    }
    // Reset progress when stage changes
    if (status !== 'downloading' && status !== 'uploading') {
      delete newMeta.proxyProgress;
    }
    return db.update(media).set({ meta: newMeta }).where(eq(media.id, mediaId)).catch(() => {});
  };

  // Throttled progress writer — only writes to DB when progress changes by >= 5%
  // to avoid hammering Postgres on every chunk.
  let lastWrittenProgress = -1;
  const setProgress = (percent: number) => {
    const pct = Math.max(0, Math.min(100, Math.round(percent)));
    if (Math.abs(pct - lastWrittenProgress) < 5) return;
    lastWrittenProgress = pct;
    const newMeta: VideoMeta = { ...meta, proxyProgress: pct, proxyStatusAt: new Date().toISOString() };
    // Preserve current proxyStatus
    if (meta?.proxyStatus) newMeta.proxyStatus = meta.proxyStatus;
    return db.update(media).set({ meta: newMeta }).where(eq(media.id, mediaId)).catch(() => {});
  };

  if (fetchedAt && Date.now() - new Date(fetchedAt).getTime() > VIDEO_URL_TTL_MS) {
    // Stale → refresh via the original post URL (PATTERNS landmine #16:
    // refreshVideoUrl needs contentItems.sourceUrl, not the googlevideo URL)
    const [contentItem] = await db
      .select()
      .from(contentItems)
      .where(eq(contentItems.id, share.contentItemId))
      .limit(1);
    if (contentItem?.sourceUrl) {
      void setStatus('refreshing'); // tell visitors we're re-fetching the URL
      try {
        const refreshed = await refreshVideoUrl(contentItem.sourceUrl);
        const newVideo = refreshed.media.find((m) => m.type === 'video');
        if (newVideo?.originalUrl) {
          videoUrl = newVideo.originalUrl;
          // Update DB with fresh URL + meta (clear refreshing status)
          await db
            .update(media)
            .set({
              originalUrl: videoUrl,
              meta: {
                ...meta,
                selectedSource: newVideo.selectedSource,
                fetchedAt: refreshed.fetchedAt,
                proxyStatus: 'fresh',
                proxyStatusAt: new Date().toISOString(),
              },
            })
            .where(eq(media.id, mediaId));
        }
      } catch {
        // Refresh failed → fall back to old (possibly expired) URL.
        void setStatus('error', 'URL refresh failed');
      }
    }
  }

  // ⑤ If storage backend is enabled, try to use a stored copy.
  //     When Vercel app proxy acceleration is enabled, the public URL routes
  //     through /api/storage/video so the app can cache / authenticate.
  let storageKey = mediaRow.blobUrl?.replace(/^\//, '') ?? null;
  const storageEnabled = (await getSetting('video_storage_enabled')) === 'true';

  if (storageKey && isVideoStorageKeyStale(storageKey, videoUrl)) {
    storageKey = null;
    void setStatus('restoring');
    await db
      .update(media)
      .set({ blobUrl: null })
      .where(eq(media.id, mediaId))
      .catch(() => {});
  }

  if (storageEnabled && !storageKey) {
    // Lazy upload: this video has not been stored yet. Try to download it and
    // upload to S3/R2 on the first access. If it succeeds, save the key and
    // redirect; if it fails or times out, fall through to the proxy.
    const storageEndpoint = await getSetting('video_storage_endpoint');
    const storageRegion = await getSetting('video_storage_region');
    const storageBucket = await getSetting('video_storage_bucket');
    const storageAccessKey = await getSetting('video_storage_access_key');
    const storageSecretKey = await getSetting('video_storage_secret_key');
    if (storageEndpoint && storageBucket && storageAccessKey && storageSecretKey) {
      const key = videoStorageKey(videoUrl);
      const upload = await downloadAndUploadVideo(
        { endpoint: storageEndpoint, region: storageRegion, bucket: storageBucket, accessKeyId: storageAccessKey, secretAccessKey: storageSecretKey },
        storageBucket,
        await resolveVideoFetchUrl(videoUrl),
        key,
        {
          timeoutMs: 240000,
          maxBytes: 300 * 1024 * 1024,
          onStage: (stage) => { lastWrittenProgress = -1; void setStatus(stage); },
          onProgress: (percent) => { void setProgress(percent); },
        },
      );
      if (upload.ok) {
        storageKey = key;
        await db.update(media).set({
          blobUrl: key,
          meta: { ...meta, proxyStatus: 'ready', proxyStatusAt: new Date().toISOString() },
        }).where(eq(media.id, mediaId));
      } else {
        void setStatus('error', upload.error);
      }
    }
  }

  if (storageEnabled && storageKey) {
    const storageEndpoint = await getSetting('video_storage_endpoint');
    const storageRegion = await getSetting('video_storage_region');
    const storageBucket = await getSetting('video_storage_bucket');
    const storageAccessKey = await getSetting('video_storage_access_key');
    const storageSecretKey = await getSetting('video_storage_secret_key');
    const storageCustomDomain = await getSetting('video_storage_custom_domain');
    const useVercelProxy = (await getSetting('video_storage_use_vercel_proxy')) === 'true';
    const storageFailoverEnabled =
      (await getSetting('video_storage_failover_enabled')) === 'true';

    if (storageEndpoint && storageBucket && storageAccessKey && storageSecretKey) {
      if (!useVercelProxy) {
        const publicUrl = getPublicVideoUrl(
          {
            endpoint: storageEndpoint,
            region: storageRegion,
            bucket: storageBucket,
            accessKeyId: storageAccessKey,
            secretAccessKey: storageSecretKey,
            customDomain: storageCustomDomain || undefined,
            useVercelProxy: false,
          },
          storageKey,
        );
        if (meta?.proxyStatus !== 'ready') void setStatus('ready');
        return Response.redirect(publicUrl, 302);
      }

      try {
        const s3 = createS3Client({
          endpoint: storageEndpoint,
          region: storageRegion,
          bucket: storageBucket,
          accessKeyId: storageAccessKey,
          secretAccessKey: storageSecretKey,
        });
        const obj = await s3.send(
          new GetObjectCommand({ Bucket: storageBucket, Key: storageKey }),
        );
        const headers: Record<string, string> = {
          'Content-Type': obj.ContentType || 'video/mp4',
          'Content-Disposition': 'inline',
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'public, max-age=31536000, immutable',
        };
        if (obj.ContentLength) headers['Content-Length'] = String(obj.ContentLength);
        if (meta?.proxyStatus !== 'ready') void setStatus('ready');
        return new Response(obj.Body as ReadableStream, { headers });
      } catch {
        if (storageFailoverEnabled) {
          const publicUrl = getPublicVideoUrl(
            {
              endpoint: storageEndpoint,
              region: storageRegion,
              bucket: storageBucket,
              accessKeyId: storageAccessKey,
              secretAccessKey: storageSecretKey,
              customDomain: storageCustomDomain || undefined,
              useVercelProxy: false,
            },
            storageKey,
          );
          if (meta?.proxyStatus !== 'ready') void setStatus('ready');
          return Response.redirect(publicUrl, 302);
        }
      }
    }
  }

  // ⑥ Stream-proxy the upstream response (no buffering)
  //
  // External proxy URL format:
  //   <proxyBase>/<raw-video-url>   e.g. https://video-proxy.example.com/https://video.twimg.com/...
  // When proxyBase is empty, fetch the video URL directly (Vercel function).
  const proxyBase = await getSetting('video_proxy_url');
  const proxyFailoverEnabled = (await getSetting('video_proxy_failover_enabled')) === 'true';
  const proxyHops = buildVideoProxyChain(proxyBase, proxyFailoverEnabled);

  // The browser's Range (`bytes=0-` for playback, `bytes=a-b` for seeks) is
  // honoured, but fetched upstream in bounded chunks: googlevideo returns 403
  // for open-ended or oversized ranges (see lib/video/chunked-fetch).
  const range = parseRangeHeader(request.headers.get('Range'));

  const upstreamReqHeaders: Record<string, string> = {
    // No Referer header — Twitter/X enforces Referer-based access control
    // and returns 403 when a third-party Referer is present.
    'User-Agent': 'Mozilla/5.0 (compatible; ReachProxy/1.0)',
  };

  const upstreamResult = await fetchVideoUpstream(videoUrl, proxyHops, upstreamReqHeaders, range);

  if (!upstreamResult.ok) {
    // 只有真的经过代理取流失败才算「代理封禁信号」；直连失败（典型如源
    // 视频 URL 过期返回 403）是源的问题，不该把矛头指向代理。
    if (proxyBase) {
      void recordProxyError(`${upstreamResult.lastError} · ${new Date().toISOString()}`);
    }
    void setStatus('error', upstreamResult.lastError);
    return new Response(upstreamResult.lastError, {
      status: upstreamResult.lastStatus ?? 502,
    });
  }

  const upstream = upstreamResult.stream;

  // 取流成功 → 之前的代理告警（若有）自动清除
  void clearProxyErrorIfSet();
  if (['', 'error'].includes(meta?.proxyStatus ?? '')) void setStatus('fresh');
  return new Response(upstream.body, {
    status: upstream.status,
    headers: buildStreamResponseHeaders(upstream),
  });
}
