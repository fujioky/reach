// app/api/fetch/route.ts
// Thin API route wrapper for the Fetcher client.
// Plan 02-02, Task 3 — for testing via curl.
// Plan 02-03, Task 2 — structured error responses with kind/retryable/statusCode.
//
// Usage: GET /api/fetch?url=<post-url>
// Returns: { ok: true, content: FetchedContent }
//       or { ok: false, error, kind, retryable, statusCode, platform }

export const runtime = 'nodejs';
export const maxDuration = 300; // Hobby Fluid Compute max (D-08)

import { fetchContent } from '@/lib/fetcher';
import { FetcherError, ReachErrorKind } from '@/lib/fetcher/errors';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');

  if (!url) {
    return Response.json(
      { ok: false, error: 'Missing url param' },
      { status: 400 }
    );
  }

  try {
    const content = await fetchContent(url);
    return Response.json({ ok: true, content });
  } catch (err) {
    if (err instanceof FetcherError) {
      // Map FetcherError to HTTP status
      const httpStatus = mapKindToHttpStatus(err.kind);
      return Response.json(
        {
          ok: false,
          error: err.message,
          kind: err.kind,
          retryable: err.retryable ?? false,
          statusCode: err.statusCode,
          platform: err.platform,
        },
        { status: httpStatus }
      );
    }
    // Unexpected non-FetcherError
    return Response.json(
      { ok: false, error: (err as Error).message, kind: 'unknown' },
      { status: 500 }
    );
  }
}

/**
 * Map FetcherError kind to HTTP status code for the API response.
 * Callers (Phase 3 admin UI) get the structured `kind` field regardless of
 * HTTP status — the HTTP status is for REST semantics / curl convenience.
 */
function mapKindToHttpStatus(kind: ReachErrorKind): number {
  switch (kind) {
    case ReachErrorKind.NOT_FOUND:
    case ReachErrorKind.EMPTY_ITEM:
      return 404;
    case ReachErrorKind.AUTH_REQUIRED:
      return 401;
    case ReachErrorKind.RATE_LIMITED:
      return 429;
    case ReachErrorKind.UNSUPPORTED_PLATFORM:
    case ReachErrorKind.UNSUPPORTED:
      return 400;
    case ReachErrorKind.NOT_CONFIGURED:
      return 503;
    case ReachErrorKind.TIMEOUT:
      return 504;
    case ReachErrorKind.NETWORK_ERROR:
      return 502;
    default:
      return 500;
  }
}
