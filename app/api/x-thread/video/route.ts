// app/api/x-thread/video/route.ts
// Plays a video from an X thread post shown on a share page: a parent above
// the mirrored post, or a post opened from the thread (x_post_cache).
//
// No URL comes from the request: it is looked up among the videos stored for
// this share's mirror (?post=<tweet id>&i=<index>) and must be a
// video.twimg.com file. Access follows the mirror's own media
// (checkShareMediaAccess), and the bytes go through the same proxy chain and
// bounded-range fetching as /api/proxy-video, since visitors usually cannot
// reach video.twimg.com directly.

export const runtime = 'nodejs';
export const maxDuration = 300;

import { and, eq } from 'drizzle-orm';
import { db, contentItems, xPostCache } from '@/lib/db';
import { checkShareMediaAccess, parseVisitorFromRequest } from '@/lib/access/share-media';
import { getSetting } from '@/lib/settings';
import { buildVideoProxyChain, fetchVideoUpstream } from '@/lib/video/failover';
import { buildStreamResponseHeaders } from '@/lib/video/stream-http';
import { parseRangeHeader } from '@/lib/video/chunked-fetch';
import { readThread, withMirroredMedia, type StoredPost } from '@/lib/mirror/x-thread';
import type { XPostCachePayload } from '@/lib/mirror/x-post-cache';

const TWIMG_VIDEO = /^https:\/\/video\.twimg\.com\//;

/** Videos stored for `postId` on this mirror's thread, if any. */
async function storedVideos(item: typeof contentItems.$inferSelect, postId: string): Promise<string[]> {
  const parent = readThread(item.platformData)?.parents.find((p) => p.platformId === postId);
  if (parent) {
    const [filled] = await withMirroredMedia([parent]);
    if (filled!.videos?.length) return filled!.videos!;
  }
  const cached = await db
    .select({ payload: xPostCache.payload })
    .from(xPostCache)
    .where(eq(xPostCache.contentItemId, item.id));
  for (const { payload } of cached) {
    const p = payload as XPostCachePayload;
    const posts: StoredPost[] = [p.post, ...p.parents, ...p.replies];
    const hit = posts.find((post) => post.platformId === postId && post.videos?.length);
    if (hit) return hit.videos!;
  }
  return [];
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token') ?? '';
  const postId = searchParams.get('post') ?? '';
  const index = Number(searchParams.get('i') ?? '0');
  if (!token || !/^\d{1,25}$/.test(postId) || !Number.isInteger(index) || index < 0) {
    return new Response('Bad request', { status: 400 });
  }

  const { cookie, ip } = parseVisitorFromRequest(request);
  const access = await checkShareMediaAccess(token, cookie, ip);
  if (!access.allowed) return new Response('Forbidden', { status: access.reason === 'not_found' ? 404 : 403 });

  const [item] = await db
    .select()
    .from(contentItems)
    .where(and(eq(contentItems.id, access.share.contentItemId), eq(contentItems.platform, 'x')))
    .limit(1);
  if (!item) return new Response('Not found', { status: 404 });

  const videoUrl = (await storedVideos(item, postId))[index];
  if (!videoUrl || !TWIMG_VIDEO.test(videoUrl)) return new Response('Not found', { status: 404 });

  const proxyBase = await getSetting('video_proxy_url');
  const failover = (await getSetting('video_proxy_failover_enabled')) === 'true';
  const upstream = await fetchVideoUpstream(
    videoUrl,
    buildVideoProxyChain(proxyBase, failover),
    // No Referer: X refuses video requests that carry a third-party one.
    { 'User-Agent': 'Mozilla/5.0 (compatible; ReachProxy/1.0)' },
    parseRangeHeader(request.headers.get('Range')),
  );
  if (!upstream.ok) return new Response(upstream.lastError, { status: upstream.lastStatus ?? 502 });
  return new Response(upstream.stream.body, {
    status: upstream.stream.status,
    headers: buildStreamResponseHeaders(upstream.stream),
  });
}
