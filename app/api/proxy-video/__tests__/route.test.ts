// app/api/proxy-video/__tests__/route.test.ts
// Plan 04-02, Task 2 — RED phase unit tests for proxy-video token+mediaId
// hardening (D-41, SHRE-08).
//
// Validates all SHRE-08/D-41 edges:
// - Missing token or mediaId → 400
// - Non-existent token → 404
// - status !== 'active' → 403
// - Non-existent mediaId → 404
// - mediaId not belonging to share's contentItem → 403
// - type !== 'video' → 400
// - fetchedAt not expired → refreshVideoUrl NOT called
// - fetchedAt expired → refreshVideoUrl called + DB updated
// - refreshVideoUrl throws → falls back to old URL (proxy still works)
// - url param → ignored (SSRF protection)
// - token case-flip → 404 (case-sensitive)
//
// db, refreshVideoUrl, and global.fetch are mocked.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock data constants ──────────────────────────────────────
const VALID_TOKEN = 'V1StGXR8_Z5jdHi6B-myT';
const SHARE_CONTENT_ITEM_ID = '11111111-1111-4111-8111-111111111111';
const MEDIA_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_CONTENT_ITEM_ID = '33333333-3333-4333-8333-333333333333';
const IMAGE_MEDIA_ID = '44444444-4444-4444-8444-444444444444';
const VIDEO_URL = 'https://rr.googlevideo.com/videoplayback?expire=123';
const SOURCE_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const FRESH_FETCHED_AT = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(); // 1h ago
const STALE_FETCHED_AT = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(); // 8h ago

// ── Mock table sentinel objects + mutable state (vi.hoisted for vi.mock) ──
const { shares, mediaTable, contentItems, state, updateCalls, refreshVideoUrl, mockFetch } =
  vi.hoisted(() => {
    const shares = { __table: 'shares' };
    const mediaTable = { __table: 'media' };
    const contentItems = { __table: 'content_items' };
    const state = {
      shareResult: [] as Array<{ status: string; contentItemId: string }>,
      mediaResult: [] as Array<{
        id: string;
        contentItemId: string;
        type: string;
        originalUrl: string;
        meta: { fetchedAt?: string; selectedSource?: unknown } | null;
      }>,
      contentItemResult: [] as Array<{ sourceUrl: string | null }>,
    };
    const updateCalls: Array<{ values: Record<string, unknown>; cond: unknown }> = [];
    const refreshVideoUrl = vi.fn();
    const mockFetch = vi.fn();
    return { shares, mediaTable, contentItems, state, updateCalls, refreshVideoUrl, mockFetch };
  });

// ── Mock db ──────────────────────────────────────────────────
vi.mock('@/lib/db', () => ({
  db: {
    select: () => ({
      from: (table: unknown) => {
        let result: unknown[] = [];
        if (table === shares) result = state.shareResult;
        else if (table === mediaTable) result = state.mediaResult;
        else if (table === contentItems) result = state.contentItemResult;
        return {
          where: () => ({
            limit: async () => result.slice(0, 1),
          }),
        };
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: (cond: unknown) => {
          updateCalls.push({ values, cond });
          return Promise.resolve();
        },
      }),
    }),
  },
  shares,
  media: mediaTable,
  contentItems,
}));

// ── Mock refreshVideoUrl ─────────────────────────────────────
vi.mock('@/lib/fetcher', () => ({
  refreshVideoUrl,
}));

// ── Mock global.fetch (for upstream proxy) ───────────────────
const mockUpstreamBody = { pipeTo: vi.fn() } as unknown as ReadableStream<Uint8Array>;
vi.stubGlobal('fetch', mockFetch);

// ── Import the route handler ─────────────────────────────────
import { GET } from '@/app/api/proxy-video/route';

function makeRequest(params: Record<string, string>): Request {
  const url = new URL('http://localhost/api/proxy-video');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Request(url);
}

describe('proxy-video token+mediaId validation (D-41, SHRE-08)', () => {
  beforeEach(() => {
    state.shareResult = [];
    state.mediaResult = [];
    state.contentItemResult = [];
    updateCalls.length = 0;
    refreshVideoUrl.mockReset();
    mockFetch.mockReset();
    // Default upstream response
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: mockUpstreamBody,
      headers: new Headers({ 'Content-Type': 'video/mp4', 'Content-Length': '12345' }),
    });
  });

  // ── 400: missing params ───────────────────────────────────
  it('returns 400 when token is missing', async () => {
    const res = await GET(makeRequest({ mediaId: MEDIA_ID }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when mediaId is missing', async () => {
    const res = await GET(makeRequest({ token: VALID_TOKEN }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when both token and mediaId are missing', async () => {
    const res = await GET(makeRequest({}));
    expect(res.status).toBe(400);
  });

  // ── 404: non-existent token ───────────────────────────────
  it('returns 404 for non-existent token', async () => {
    state.shareResult = []; // no share found
    const res = await GET(makeRequest({ token: 'nonexistent', mediaId: MEDIA_ID }));
    expect(res.status).toBe(404);
  });

  // ── 403: status !== 'active' ──────────────────────────────
  it('returns 403 when share status is not active', async () => {
    state.shareResult = [{ status: 'revoked', contentItemId: SHARE_CONTENT_ITEM_ID }];
    const res = await GET(makeRequest({ token: VALID_TOKEN, mediaId: MEDIA_ID }));
    expect(res.status).toBe(403);
  });

  // ── 404: non-existent mediaId ─────────────────────────────
  it('returns 404 for non-existent mediaId', async () => {
    state.shareResult = [{ status: 'active', contentItemId: SHARE_CONTENT_ITEM_ID }];
    state.mediaResult = []; // no media found
    const res = await GET(makeRequest({ token: VALID_TOKEN, mediaId: 'nonexistent-media' }));
    expect(res.status).toBe(404);
  });

  // ── 403: mediaId not belonging to share's contentItem ─────
  it('returns 403 when mediaId belongs to a different contentItem', async () => {
    state.shareResult = [{ status: 'active', contentItemId: SHARE_CONTENT_ITEM_ID }];
    state.mediaResult = [
      {
        id: MEDIA_ID,
        contentItemId: OTHER_CONTENT_ITEM_ID, // different!
        type: 'video',
        originalUrl: VIDEO_URL,
        meta: { fetchedAt: FRESH_FETCHED_AT },
      },
    ];
    const res = await GET(makeRequest({ token: VALID_TOKEN, mediaId: MEDIA_ID }));
    expect(res.status).toBe(403);
  });

  // ── 400: non-video media ──────────────────────────────────
  it('returns 400 when media type is image (not video)', async () => {
    state.shareResult = [{ status: 'active', contentItemId: SHARE_CONTENT_ITEM_ID }];
    state.mediaResult = [
      {
        id: IMAGE_MEDIA_ID,
        contentItemId: SHARE_CONTENT_ITEM_ID,
        type: 'image',
        originalUrl: 'https://example.com/img.jpg',
        meta: null,
      },
    ];
    const res = await GET(makeRequest({ token: VALID_TOKEN, mediaId: IMAGE_MEDIA_ID }));
    expect(res.status).toBe(400);
  });

  // ── Happy path: fresh fetchedAt → no refresh ──────────────
  it('proxies directly when fetchedAt is fresh (no refreshVideoUrl call)', async () => {
    state.shareResult = [{ status: 'active', contentItemId: SHARE_CONTENT_ITEM_ID }];
    state.mediaResult = [
      {
        id: MEDIA_ID,
        contentItemId: SHARE_CONTENT_ITEM_ID,
        type: 'video',
        originalUrl: VIDEO_URL,
        meta: { fetchedAt: FRESH_FETCHED_AT },
      },
    ];
    const res = await GET(makeRequest({ token: VALID_TOKEN, mediaId: MEDIA_ID }));
    expect(res.status).toBe(200);
    expect(refreshVideoUrl).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledWith(VIDEO_URL, expect.any(Object));
  });

  // ── Stale fetchedAt → refresh + DB update ─────────────────
  it('calls refreshVideoUrl and updates DB when fetchedAt is stale', async () => {
    state.shareResult = [{ status: 'active', contentItemId: SHARE_CONTENT_ITEM_ID }];
    state.mediaResult = [
      {
        id: MEDIA_ID,
        contentItemId: SHARE_CONTENT_ITEM_ID,
        type: 'video',
        originalUrl: VIDEO_URL,
        meta: { fetchedAt: STALE_FETCHED_AT },
      },
    ];
    state.contentItemResult = [{ sourceUrl: SOURCE_URL }];
    refreshVideoUrl.mockResolvedValue({
      fetchedAt: new Date().toISOString(),
      media: [
        {
          type: 'video',
          originalUrl: 'https://rr.googlevideo.com/videoplayback?expire=999',
          selectedSource: { quality: '720p' },
        },
      ],
    });
    const res = await GET(makeRequest({ token: VALID_TOKEN, mediaId: MEDIA_ID }));
    expect(res.status).toBe(200);
    expect(refreshVideoUrl).toHaveBeenCalledWith(SOURCE_URL);
    const refreshUpdate = updateCalls.find((c) => c.values.originalUrl);
    expect(refreshUpdate?.values.originalUrl).toBe(
      'https://rr.googlevideo.com/videoplayback?expire=999',
    );
    // The refreshed URL should be used for the proxy fetch.
    expect(mockFetch).toHaveBeenCalledWith(
      'https://rr.googlevideo.com/videoplayback?expire=999',
      expect.any(Object),
    );
  });

  // ── Refresh failure → fallback to old URL ─────────────────
  it('falls back to old URL when refreshVideoUrl throws', async () => {
    state.shareResult = [{ status: 'active', contentItemId: SHARE_CONTENT_ITEM_ID }];
    state.mediaResult = [
      {
        id: MEDIA_ID,
        contentItemId: SHARE_CONTENT_ITEM_ID,
        type: 'video',
        originalUrl: VIDEO_URL,
        meta: { fetchedAt: STALE_FETCHED_AT },
      },
    ];
    state.contentItemResult = [{ sourceUrl: SOURCE_URL }];
    refreshVideoUrl.mockRejectedValue(new Error('Network error'));
    const res = await GET(makeRequest({ token: VALID_TOKEN, mediaId: MEDIA_ID }));
    expect(res.status).toBe(200);
    // Old URL used for proxy.
    expect(mockFetch).toHaveBeenCalledWith(VIDEO_URL, expect.any(Object));
  });

  // ── SSRF: url param ignored ───────────────────────────────
  it('ignores url param (SSRF protection) — returns 400 for missing token/mediaId', async () => {
    const res = await GET(makeRequest({ url: 'https://evil.com/video.mp4' }));
    expect(res.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('ignores url param even with valid token+mediaId — uses DB URL not url param', async () => {
    state.shareResult = [{ status: 'active', contentItemId: SHARE_CONTENT_ITEM_ID }];
    state.mediaResult = [
      {
        id: MEDIA_ID,
        contentItemId: SHARE_CONTENT_ITEM_ID,
        type: 'video',
        originalUrl: VIDEO_URL,
        meta: { fetchedAt: FRESH_FETCHED_AT },
      },
    ];
    const res = await GET(
      makeRequest({
        token: VALID_TOKEN,
        mediaId: MEDIA_ID,
        url: 'https://evil.com/video.mp4',
      }),
    );
    expect(res.status).toBe(200);
    // Should fetch the DB URL, NOT the url param.
    expect(mockFetch).toHaveBeenCalledWith(VIDEO_URL, expect.any(Object));
    expect(mockFetch).not.toHaveBeenCalledWith('https://evil.com/video.mp4', expect.any(Object));
  });

  // ── Token case-sensitivity ────────────────────────────────
  it('returns 404 for case-flipped token (case-sensitive lookup)', async () => {
    state.shareResult = []; // case-flipped token won't match
    const res = await GET(
      makeRequest({ token: VALID_TOKEN.toUpperCase(), mediaId: MEDIA_ID }),
    );
    expect(res.status).toBe(404);
  });
});
