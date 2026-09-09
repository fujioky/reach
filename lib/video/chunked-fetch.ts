// lib/video/chunked-fetch.ts
// Bounded-range upstream fetch for video bytes.
//
// googlevideo (YouTube CDN) rejects open-ended (`bytes=0-`) and oversized
// range requests with 403 and only serves bounded ranges up to ~2 MiB — the
// same reason yt-dlp downloads in fixed-size HTTP chunks. Browsers, however,
// always ask for `bytes=N-`, and a storage upload wants the whole file. This
// module bridges the two: whatever byte range the caller wants is fetched as
// a sequence of ≤ UPSTREAM_CHUNK_BYTES requests and exposed as one stream.
//
// Upstreams that ignore Range (reply 200 with the whole body) are passed
// through untouched.

/** Largest range googlevideo will serve in one request (verified 2026-08). */
export const UPSTREAM_CHUNK_BYTES = 2 * 1024 * 1024;

export type ByteRange = { start: number; end: number | null };

/** Parse `bytes=a-b` / `bytes=a-`. Anything else (multi-range, suffix) → null = whole file. */
export function parseRangeHeader(header: string | null): ByteRange | null {
  const m = header?.match(/^bytes=(\d+)-(\d*)$/);
  if (!m) return null;
  const start = Number(m[1]);
  const end = m[2] === '' ? null : Number(m[2]);
  if (end !== null && end < start) return null;
  return { start, end };
}

export type ChunkedFetchResult =
  | {
      ok: true;
      /** 206 when the upstream honoured Range, 200 when it sent the whole file. */
      status: 200 | 206;
      contentType: string;
      /** First and last byte offsets of `body`; total = full resource size (0 = unknown). */
      start: number;
      end: number;
      total: number;
      body: ReadableStream<Uint8Array>;
    }
  | { ok: false; status: number; error: string };

export interface ChunkedFetchOptions {
  range?: ByteRange | null;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  redirect?: RequestRedirect;
  chunkBytes?: number;
}

function parseContentRange(header: string | null): { start: number; end: number; total: number } | null {
  const m = header?.match(/^bytes (\d+)-(\d+)\/(\d+|\*)$/);
  if (!m) return null;
  return { start: Number(m[1]), end: Number(m[2]), total: m[3] === '*' ? 0 : Number(m[3]) };
}

export async function fetchInChunks(
  url: string,
  options: ChunkedFetchOptions = {},
): Promise<ChunkedFetchResult> {
  const { range = null, headers = {}, signal, redirect, chunkBytes = UPSTREAM_CHUNK_BYTES } = options;
  const start = range?.start ?? 0;
  const wantedEnd = range?.end ?? null;

  const fetchChunk = (from: number, to: number) =>
    fetch(url, {
      headers: { ...headers, Range: `bytes=${from}-${to}` },
      referrer: '',
      referrerPolicy: 'no-referrer',
      ...(redirect ? { redirect } : {}),
      ...(signal ? { signal } : {}),
    });

  const firstEnd = wantedEnd === null ? start + chunkBytes - 1 : Math.min(wantedEnd, start + chunkBytes - 1);
  const first = await fetchChunk(start, firstEnd);
  const contentType = first.headers.get('content-type') || 'video/mp4';

  if (first.status === 200) {
    // Upstream ignores Range: hand the whole body through as-is.
    const total = Number(first.headers.get('content-length') ?? 0);
    if (!first.body) return { ok: false, status: 502, error: 'Upstream response has no body' };
    return { ok: true, status: 200, contentType, start: 0, end: total > 0 ? total - 1 : -1, total, body: first.body };
  }
  if (first.status !== 206 || !first.body) {
    return { ok: false, status: first.status, error: `Upstream HTTP ${first.status}` };
  }

  const cr = parseContentRange(first.headers.get('content-range'));
  const total = cr?.total ?? 0;
  const firstChunkEnd = cr?.end ?? firstEnd;
  // Unknown total and no requested end → we cannot know when to stop; stream just this chunk.
  const end =
    wantedEnd !== null
      ? total > 0 ? Math.min(wantedEnd, total - 1) : wantedEnd
      : total > 0 ? total - 1 : firstChunkEnd;

  let reader = first.body.getReader();
  let next = firstChunkEnd + 1;

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        const { done, value } = await reader.read();
        if (!done) {
          controller.enqueue(value);
          return;
        }
        if (next > end) {
          controller.close();
          return;
        }
        const to = Math.min(end, next + chunkBytes - 1);
        const res = await fetchChunk(next, to);
        if (res.status !== 206 || !res.body) {
          throw new Error(`Upstream HTTP ${res.status} for bytes ${next}-${to}`);
        }
        reader = res.body.getReader();
        next = to + 1;
      }
    },
    cancel() {
      void reader.cancel().catch(() => {});
    },
  });

  return { ok: true, status: 206, contentType, start, end, total, body };
}
