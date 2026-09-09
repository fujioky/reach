// app/api/analytics/ingest/__tests__/route.test.ts
// Tests for POST /api/analytics/ingest — the self-built analytics ingest.
//
// Covers the defense layers and the three write paths:
// - First batch (meta) + unknown contentItemId → 404
// - First batch (meta) + valid content → 204, session inserted
// - Follow-up batch without meta → 204, session counters updated
// - rrweb chunks inserted idempotently
// - Structured events inserted with real IP + UA
// - Invalid origin → 403; malformed payload → 400; oversized body → 413
//
// Mock pattern follows the old /api/track tests — sentinel table objects and
// a mock db supporting the used query chains.

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock DB state ──
let contentExists = true;
let insertedSessions: Record<string, unknown>[] = [];
let insertedChunks: Record<string, unknown>[] = [];
let insertedEvents: Record<string, unknown>[] = [];
let sessionUpdates: Record<string, unknown>[] = [];

const createSelectQuery = () => {
  const query = {
    from: (_t: unknown) => query,
    where: (_c: unknown) => query,
    orderBy: (..._c: unknown[]) => query,
    limit: (_n: number) =>
      Promise.resolve(contentExists ? [{ id: 'content-1' }] : []),
  };
  return query;
};

const createInsertQuery = (sink: Record<string, unknown>[]) => ({
  values: (rows: Record<string, unknown> | Record<string, unknown>[]) => {
    const arr = Array.isArray(rows) ? rows : [rows];
    sink.push(...arr);
    return {
      onConflictDoNothing: (_opts?: unknown) => Promise.resolve(),
      then: (resolve: (v: unknown) => void) => Promise.resolve().then(resolve),
    };
  },
});

const tables = {
  contentItems: { __table: 'content_items', id: 'id' },
  analyticsSessions: { __table: 'analytics_sessions', id: 'id', eventCount: 'event_count', chunkCount: 'chunk_count' },
  analyticsChunks: { __table: 'analytics_chunks' },
  visitEvents: { __table: 'visit_events' },
  shares: { __table: 'shares' },
};

const db = {
  select: (_f?: unknown) => createSelectQuery(),
  insert: (table: { __table: string }) => {
    if (table.__table === 'analytics_sessions') return createInsertQuery(insertedSessions);
    if (table.__table === 'analytics_chunks') return createInsertQuery(insertedChunks);
    return createInsertQuery(insertedEvents);
  },
  update: (_t: unknown) => ({
    set: (patch: Record<string, unknown>) => {
      sessionUpdates.push(patch);
      return { where: (_c: unknown) => Promise.resolve() };
    },
  }),
};

vi.mock('@/lib/db', () => ({ db, ...tables }));

// geo lookup hits ip.sb — stub it out in tests
vi.mock('@/lib/analytics/geo', () => ({
  lookupGeo: vi.fn(async () => ({ country: 'CN', region: 'Shanghai', city: 'Shanghai' })),
}));

const { POST } = await import('../route');

const SESSION_ID = '22222222-2222-4222-8222-222222222222';
const CONTENT_ID = '11111111-1111-4111-8111-111111111111';

function makeRequest(body: unknown, headers: Record<string, string> = {}): Request {
  const json = JSON.stringify(body);
  return new Request('https://reach.example.com/api/analytics/ingest', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'content-length': String(new TextEncoder().encode(json).length),
      origin: 'https://reach.example.com',
      'x-forwarded-for': '203.0.113.7, 10.0.0.1',
      'user-agent': 'test-agent',
      ...headers,
    },
    body: json,
  });
}

function validFirstBatch(visitorId = 'visitor-1') {
  return {
    sessionId: SESSION_ID,
    contentItemId: CONTENT_ID,
    shareId: null,
    visitorId,
    meta: { screenW: 1920, screenH: 1080, viewportW: 1280, viewportH: 720, dpr: 2, lang: 'zh-CN' },
    chunks: [{ seq: 0, events: [{ type: 4 }, { type: 2 }] }],
    events: [{ type: 'view', ts: new Date().toISOString() }],
    durationMs: 0,
  };
}

describe('POST /api/analytics/ingest', () => {
  beforeEach(() => {
    contentExists = true;
    insertedSessions = [];
    insertedChunks = [];
    insertedEvents = [];
    sessionUpdates = [];
  });

  it('first batch: 204 + session/chunk/events inserted with real IP', async () => {
    const res = await POST(makeRequest(validFirstBatch('visitor-a')));
    expect(res.status).toBe(204);
    expect(insertedSessions.length).toBe(1);
    expect(insertedSessions[0].ip).toBe('203.0.113.7');
    expect(insertedSessions[0].screenW).toBe(1920);
    expect(insertedChunks.length).toBe(1);
    expect(insertedEvents.length).toBe(1);
    expect(insertedEvents[0].ip).toBe('203.0.113.7');
    expect(insertedEvents[0].ua).toBe('test-agent');
    expect(insertedEvents[0].sessionId).toBe(SESSION_ID);
  });

  it('unknown contentItemId on first batch → 404', async () => {
    contentExists = false;
    const res = await POST(makeRequest(validFirstBatch('visitor-b')));
    expect(res.status).toBe(404);
    expect(insertedSessions.length).toBe(0);
  });

  it('follow-up batch without meta updates counters → 204', async () => {
    const body = {
      sessionId: SESSION_ID,
      contentItemId: CONTENT_ID,
      visitorId: 'visitor-c',
      events: [{ type: 'click', payload: { x: 10, y: 20, docW: 1280, docH: 4000 } }],
      durationMs: 12_000,
    };
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(204);
    expect(insertedSessions.length).toBe(0);
    expect(sessionUpdates.length).toBe(1);
    expect(sessionUpdates[0].durationMs).toBe(12_000);
    expect(insertedEvents.length).toBe(1);
  });

  it('cross-origin request → 403', async () => {
    const res = await POST(
      makeRequest(validFirstBatch('visitor-d'), { origin: 'https://evil.example' }),
    );
    expect(res.status).toBe(403);
  });

  it('malformed payload → 400', async () => {
    const res = await POST(makeRequest({ sessionId: 'not-a-uuid', visitorId: 'x' }));
    expect(res.status).toBe(400);
  });

  it('oversized body → 413', async () => {
    const res = await POST(
      makeRequest(validFirstBatch('visitor-e'), { 'content-length': String(4 * 1024 * 1024) }),
    );
    expect(res.status).toBe(413);
  });

  it('video event type accepted', async () => {
    const body = {
      sessionId: SESSION_ID,
      contentItemId: CONTENT_ID,
      visitorId: 'visitor-f',
      events: [
        { type: 'video', payload: { action: 'play', position: 1.2, duration: 60 } },
        { type: 'scroll', payload: { scrollY: 900, depthPct: 40 } },
      ],
    };
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(204);
    expect(insertedEvents.length).toBe(2);
  });

  it('rate limit: 61st batch from one visitor → 429', async () => {
    for (let i = 0; i < 60; i++) {
      const res = await POST(
        makeRequest({
          sessionId: SESSION_ID,
          contentItemId: CONTENT_ID,
          visitorId: 'flooder',
          events: [{ type: 'view' }],
        }),
      );
      expect(res.status).toBe(204);
    }
    const res = await POST(
      makeRequest({
        sessionId: SESSION_ID,
        contentItemId: CONTENT_ID,
        visitorId: 'flooder',
        events: [{ type: 'view' }],
      }),
    );
    expect(res.status).toBe(429);
  });
});
