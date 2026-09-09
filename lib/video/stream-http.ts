// lib/video/stream-http.ts
// Response headers for streaming upstream video bytes to the browser —
// keeps upstream URLs off the client.

import type { ChunkedFetchResult } from '@/lib/video/chunked-fetch';

export function buildStreamResponseHeaders(
  stream: Extract<ChunkedFetchResult, { ok: true }>,
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': stream.contentType,
    'Content-Disposition': 'inline',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache, must-revalidate',
  };
  if (stream.status === 206) {
    headers['Content-Range'] = `bytes ${stream.start}-${stream.end}/${stream.total || '*'}`;
    headers['Content-Length'] = String(stream.end - stream.start + 1);
  } else if (stream.total > 0) {
    headers['Content-Length'] = String(stream.total);
  }
  return headers;
}
