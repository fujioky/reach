// app/api/video-status/route.ts
// Lightweight polling endpoint — returns the current proxyStatus of a video.
//
// Used by VideoPlayer to show visitors what the system is doing when a video
// is slow to load (URL refresh, storage upload, etc.).
//
// GET /api/video-status?token=<token>&mediaId=<mediaId>
// Response: { status: string, label: string, done: boolean }
//
// status values:
//   'fresh'       — URL is valid, streaming directly
//   'ready'       — stored in bucket, serving from there
//   'refreshing'  — URL expired, re-fetching from source
//   'downloading' — downloading video from upstream (before upload to storage)
//   'uploading'   — uploading video to storage bucket
//   'error'       — something failed (video may still play via proxy fallback)
//
// Stale blobUrl (key no longer matches originalUrl) re-enters this same pipeline:
// refreshing → downloading → uploading.
//   (empty)       — no status recorded yet (first access in progress)
//
// The endpoint also infers 'ready' or 'fresh' from the media row (blobUrl /
// fetchedAt TTL) so that cached proxy-video responses do not leave the player
// stuck on 'loading' forever.

export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { db, shares, media } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { getSetting } from '@/lib/settings';
import { checkShareMediaAccess, parseVisitorFromRequest } from '@/lib/access/share-media';
import { isVideoStorageKeyStale } from '@/lib/storage/s3';
import { resolveVideoPlaybackUrl } from '@/lib/video/playback-url';


// googlevideo URLs expire ~6h; mirror the proxy-video TTL.
const VIDEO_URL_TTL_MS = 6 * 60 * 60 * 1000;

const STATUS_LABELS: Record<string, { label: string; done: boolean }> = {
  fresh:       { label: '视频准备就绪',              done: true  },
  ready:       { label: '视频已存储，加载中…',        done: true  },
  refreshing:  { label: '正在更新视频链接…',          done: false },
  downloading: { label: '正在从源站下载视频…',        done: false },
  uploading:   { label: '正在上传至存储桶…',          done: false },
  error:       { label: '视频加载遇到问题',           done: false },
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');
  const mediaId = searchParams.get('mediaId');

  if (!token || !mediaId) {
    return NextResponse.json({ error: 'Missing params' }, { status: 400 });
  }

  const { cookie: visitorCookie, ip: visitorIp } = parseVisitorFromRequest(req);
  const access = await checkShareMediaAccess(token, visitorCookie, visitorIp);
  if (!access.allowed) {
    const status = access.reason === 'not_found' ? 404 : 403;
    return NextResponse.json({ error: 'Invalid token' }, { status });
  }
  const share = access.share;

  // Fetch media row
  const [mediaRow] = await db.select().from(media).where(eq(media.id, mediaId)).limit(1);
  if (!mediaRow || mediaRow.contentItemId !== share.contentItemId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const meta = mediaRow.meta as { fetchedAt?: string; proxyStatus?: string; proxyStatusAt?: string; proxyError?: string; proxyProgress?: number } | null;

  // Infer effective status from media state. blobUrl takes precedence, then a
  // fresh URL, then the recorded proxyStatus. This prevents a stale cached
  // proxy-video response from leaving the player stuck on 'loading'.
  const storageEnabled = (await getSetting('video_storage_enabled')) === 'true';
  const blobKey = mediaRow.blobUrl?.replace(/^\//, '') ?? null;
  const blobStale = Boolean(
    blobKey && storageEnabled && isVideoStorageKeyStale(blobKey, mediaRow.originalUrl),
  );
  const blobMatchesUrl =
    blobKey && !isVideoStorageKeyStale(blobKey, mediaRow.originalUrl);

  let status: string;
  if (blobMatchesUrl) {
    status = 'ready';
  } else if (blobStale) {
    if (
      meta?.proxyStatus === 'refreshing' ||
      meta?.proxyStatus === 'downloading' ||
      meta?.proxyStatus === 'uploading'
    ) {
      status = meta.proxyStatus;
    } else if (meta?.fetchedAt && Date.now() - new Date(meta.fetchedAt).getTime() <= VIDEO_URL_TTL_MS) {
      // URL still valid — skip refresh, re-upload starts at downloading.
      status = 'downloading';
    } else {
      status = meta?.proxyStatus || 'refreshing';
    }
  } else if (meta?.fetchedAt && Date.now() - new Date(meta.fetchedAt).getTime() <= VIDEO_URL_TTL_MS) {
    status = 'fresh';
  } else {
    status = meta?.proxyStatus || 'refreshing';
  }

  const info = STATUS_LABELS[status] ?? { label: '视频加载中…', done: false };
  const playbackUrl = await resolveVideoPlaybackUrl(token, {
    id: mediaRow.id,
    originalUrl: mediaRow.originalUrl,
    blobUrl: mediaRow.blobUrl,
  });

  return NextResponse.json({
    status,
    label: info.label,
    done: info.done,
    updatedAt: meta?.proxyStatusAt ?? null,
    hasStorage: Boolean(blobMatchesUrl),
    storageEnabled,
    storageStale: blobStale,
    playbackUrl,
    // Only expose byte progress during active transfer stages — stale values
    // from a completed upload would otherwise show on the play step.
    progress:
      (status === 'downloading' || status === 'uploading') &&
      typeof meta?.proxyProgress === 'number'
        ? meta.proxyProgress
        : null,
    errorDetail: status === 'error' ? (meta?.proxyError ?? null) : null,
  });
}
