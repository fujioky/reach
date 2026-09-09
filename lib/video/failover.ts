// lib/video/failover.ts
// Failover helpers for video reverse-proxy and storage Vercel proxy.

import { fetchInChunks, type ByteRange, type ChunkedFetchResult } from '@/lib/video/chunked-fetch';

export const PROXY_BLOCK_STATUSES = new Set([403, 429, 451]);

export type VideoProxyHop = { type: 'direct' } | { type: 'external'; base: string };

/**
 * Hop order for a playback request: the configured external proxy first and,
 * when failover is on, the raw upstream URL as the last resort. With no
 * external proxy configured the app fetches upstream directly.
 */
export function buildVideoProxyChain(
  primaryUrl: string,
  failoverEnabled: boolean,
): VideoProxyHop[] {
  const primary = primaryUrl.trim().replace(/\/$/, '');
  if (!primary) return [{ type: 'direct' }];
  return failoverEnabled
    ? [{ type: 'external', base: primary }, { type: 'direct' }]
    : [{ type: 'external', base: primary }];
}

export function buildProxyFetchUrl(hop: VideoProxyHop, videoUrl: string): string {
  if (hop.type === 'direct') return videoUrl;
  return `${hop.base}/${videoUrl}`;
}

export function videoProxyHopLabel(hop: VideoProxyHop): string {
  return hop.type === 'direct' ? 'direct' : hop.base;
}

export function isRetryableProxyFailure(status: number): boolean {
  return PROXY_BLOCK_STATUSES.has(status) || (status >= 500 && status < 600);
}

export type UpstreamFetchResult =
  | { ok: true; stream: Extract<ChunkedFetchResult, { ok: true }>; hop: VideoProxyHop }
  | { ok: false; lastError: string; lastStatus?: number };

/**
 * Try each hop in order until one serves the requested byte range. Bytes are
 * pulled in bounded chunks (see chunked-fetch) — the whole range streams from
 * whichever hop answered the first chunk.
 */
export async function fetchVideoUpstream(
  videoUrl: string,
  hops: VideoProxyHop[],
  requestHeaders: Record<string, string>,
  range: ByteRange | null,
): Promise<UpstreamFetchResult> {
  let lastError = 'No upstream hops configured';
  let lastStatus: number | undefined;

  for (let i = 0; i < hops.length; i++) {
    const hop = hops[i];
    const fetchUrl = buildProxyFetchUrl(hop, videoUrl);
    const hasNextHop = i < hops.length - 1;

    try {
      const result = await fetchInChunks(fetchUrl, { range, headers: requestHeaders });
      if (result.ok) return { ok: true, stream: result, hop };

      lastStatus = result.status;
      lastError = `HTTP ${result.status} from ${videoProxyHopLabel(hop)}`;

      if (!hasNextHop || !isRetryableProxyFailure(result.status)) {
        return { ok: false, lastError, lastStatus };
      }
    } catch (err) {
      // undici 的 fetch 把真实原因（ECONNREFUSED/ETIMEDOUT/证书错误…）藏在
      // cause 里，只说 "fetch failed" —— 排障必须把 cause 带出来
      const cause = (err as Error & { cause?: Error }).cause;
      const detail = cause ? `${(err as Error).message} (${cause.message})` : (err as Error).message;
      lastError = `Network error via ${videoProxyHopLabel(hop)}: ${detail}`;
      if (!hasNextHop) {
        return { ok: false, lastError, lastStatus };
      }
    }
  }

  return { ok: false, lastError, lastStatus };
}

export function describeVideoProxyFailoverChain(primaryUrl: string): string {
  const chain = buildVideoProxyChain(primaryUrl, true)
    .map((hop) => (hop.type === 'direct' ? '直连上游' : hop.base))
    .join(' → ');
  return chain;
}