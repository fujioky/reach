// lib/__tests__/analytics-queries.test.ts
// Plan 06-01, Task 1 — Wave 0 TDD tests for analytics aggregation queries.
//
// These tests validate the aggregation query contracts for ANLY-01~04.
// They are written FIRST (TDD red phase) and will FAIL until 06-02 creates
// `lib/analytics/queries.ts`. They validate:
// - ANLY-01 (view): getOverviewStats returns { totalViews, uniqueVisitors }
// - ANLY-02 (dwell): getBlockDwellTimes returns [{ blockId, dwellMs }] grouped by blockId
// - ANLY-03 (media): getMediaInteractions returns [{ mediaId, clicks }] grouped by mediaId
// - ANLY-04 (outlink): getOutlinkClicks returns [{ url, clicks }] grouped by url
//
// The mock-db pattern follows lib/__tests__/mirror-actions.test.ts — sentinel
// table objects and a mock db that supports the query chain.

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock table sentinel objects ──
const visitEvents = { __table: 'visit_events' };

// ── Mock query result data ──
let mockSelectResult: unknown[] = [];

// ── Mock db: supports select().from().where().groupBy().orderBy().limit()
//    and select({ ... }).from().where() ──
const createMockQuery = () => {
  const query = {
    from: (_table: unknown) => query,
    where: (_cond: unknown) => query,
    groupBy: (..._cols: unknown[]) => query,
    orderBy: (..._cols: unknown[]) => query,
    limit: (_n: number) => query,
    then: (resolve: (val: unknown) => void) =>
      Promise.resolve(mockSelectResult).then(resolve),
  };
  return query;
};

const db = {
  select: (_fields?: unknown) => createMockQuery(),
};

vi.mock('@/lib/db', () => ({
  db,
  visitEvents,
}));

// Mock drizzle-orm sql template (for jsonb path access)
vi.mock('drizzle-orm', () => ({
  eq: () => ({}),
  count: () => ({}),
  countDistinct: () => ({}),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    sql: strings.join('?'),
    values,
  }),
  desc: () => ({}),
}));

// Import after mocks — these don't exist yet (TDD red phase).
// The dynamic import will fail, which is expected.
// We use a try/catch to provide a meaningful test failure message.
let getOverviewStats: (shareId: string) => Promise<unknown>;
let getBlockDwellTimes: (shareId: string) => Promise<unknown>;
let getMediaInteractions: (shareId: string) => Promise<unknown>;
let getOutlinkClicks: (shareId: string) => Promise<unknown>;

try {
  const mod = await import('@/lib/analytics/queries');
  getOverviewStats = mod.getOverviewStats;
  getBlockDwellTimes = mod.getBlockDwellTimes;
  getMediaInteractions = mod.getMediaInteractions;
  getOutlinkClicks = mod.getOutlinkClicks;
} catch {
  // Module doesn't exist yet — TDD red phase. Tests will fail with
  // "getOverviewStats is not a function" which is the expected red signal.
  getOverviewStats = undefined as unknown as (shareId: string) => Promise<unknown>;
  getBlockDwellTimes = undefined as unknown as (shareId: string) => Promise<unknown>;
  getMediaInteractions = undefined as unknown as (shareId: string) => Promise<unknown>;
  getOutlinkClicks = undefined as unknown as (shareId: string) => Promise<unknown>;
}

const SHARE_ID = '11111111-1111-4111-8111-111111111111';

describe('ANLY-01: getOverviewStats — view count + unique visitors', () => {
  beforeEach(() => {
    mockSelectResult = [{ totalViews: 42, uniqueVisitors: 7 }];
  });

  it('returns { totalViews, uniqueVisitors } for a share', async () => {
    const result = await getOverviewStats(SHARE_ID);
    expect(result).toBeDefined();
    expect((result as { totalViews: number }).totalViews).toBe(42);
    expect((result as { uniqueVisitors: number }).uniqueVisitors).toBe(7);
  });
});

describe('ANLY-02: getBlockDwellTimes — dwell sum per block', () => {
  beforeEach(() => {
    mockSelectResult = [
      { blockId: 'body', dwellMs: 15000 },
      { blockId: 'gallery', dwellMs: 8000 },
      { blockId: 'video', dwellMs: 30000 },
      { blockId: 'comments', dwellMs: 5000 },
    ];
  });

  it('returns [{ blockId, dwellMs }] grouped by blockId', async () => {
    const result = (await getBlockDwellTimes(SHARE_ID)) as Array<{
      blockId: string;
      dwellMs: number;
    }>;
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(4);
    expect(result[0].blockId).toBe('body');
    expect(result[0].dwellMs).toBe(15000);
  });
});

describe('ANLY-03: getMediaInteractions — media click/play count', () => {
  beforeEach(() => {
    mockSelectResult = [
      { mediaId: 'media-uuid-1', clicks: 5 },
      { mediaId: 'media-uuid-2', clicks: 3 },
    ];
  });

  it('returns [{ mediaId, clicks }] grouped by mediaId', async () => {
    const result = (await getMediaInteractions(SHARE_ID)) as Array<{
      mediaId: string;
      clicks: number;
    }>;
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(2);
    expect(result[0].mediaId).toBe('media-uuid-1');
    expect(result[0].clicks).toBe(5);
  });
});

describe('ANLY-04: getOutlinkClicks — outlink click count', () => {
  beforeEach(() => {
    mockSelectResult = [
      { url: 'https://x.com/test/status/1', clicks: 10 },
      { url: 'https://example.com', clicks: 2 },
    ];
  });

  it('returns [{ url, clicks }] grouped by url', async () => {
    const result = (await getOutlinkClicks(SHARE_ID)) as Array<{
      url: string;
      clicks: number;
    }>;
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(2);
    expect(result[0].url).toBe('https://x.com/test/status/1');
    expect(result[0].clicks).toBe(10);
  });
});
