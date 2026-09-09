// lib/__tests__/access-control.test.ts
// Plan 05-01, Task 2 — unit tests for the access control engine.
//
// checkAccess() is tested with @/lib/db mocked so we can assert on the
// db.select/update/insert calls without a live Postgres. Validates all
// 5 control types (SHRE-03/04/05/06/07), atomic viewCount increment
// (Pitfall 2), burn-after-read first-view-allowed semantics (Pitfall 3),
// non-active status short-circuit (Pitfall 7), and unique-visitor
// dedup (cookie-first, IP-fallback — D-51).

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock table sentinel objects (distinct references for assert) ──
const shares = {
  __table: 'shares',
  id: 'shares.id',
  token: 'shares.token',
  viewCount: 'shares.viewCount',
  uniqueVisitorCount: 'shares.uniqueVisitorCount',
};
const shareVisits = {
  __table: 'share_visits',
  shareId: 'share_visits.shareId',
  visitorCookie: 'share_visits.visitorCookie',
  visitorIp: 'share_visits.visitorIp',
};

// ── Mock drizzle-orm operators ──
// eq(column, value) → sentinel that encodes the column + value so the
// mock db can resolve rows. and(...) → { __and: [...] }. sql`...` →
// { __sqlIncrement: fieldName } for the atomic increment patterns.
function eq(column: string, value: unknown): { column: string; value: unknown } {
  return { column, value };
}
function and(...conds: Array<{ column: string; value: unknown }>): {
  __and: typeof conds;
} {
  return { __and: conds };
}
// sql template tag — detect `viewCount + 1` / `uniqueVisitorCount + 1`
function sql(
  strings: TemplateStringsArray,
  ...exprs: unknown[]
): { __sqlIncrement?: string } {
  const raw = strings.join('');
  for (const e of exprs) {
    if (e === shares.viewCount) return { __sqlIncrement: 'viewCount' };
    if (e === shares.uniqueVisitorCount)
      return { __sqlIncrement: 'uniqueVisitorCount' };
  }
  // Fallback: parse from raw string
  if (raw.includes('view_count')) return { __sqlIncrement: 'viewCount' };
  if (raw.includes('unique_visitor_count'))
    return { __sqlIncrement: 'uniqueVisitorCount' };
  return {};
}

vi.mock('drizzle-orm', () => ({ eq, and, sql }));

// ── Mock state (reset per test) ──
// The "database" is a map of token → share row. select().from().where()
// .limit(1) returns the matching row (or undefined). update().set()
// .where().returning() mutates the row and returns it. insert().values()
// records the visit.
let dbRows: Record<string, Record<string, unknown>> = {};
let recordedUpdates: Array<{
  table: unknown;
  set: Record<string, unknown>;
  cond: unknown;
  returned?: Record<string, unknown>;
}> = [];
let recordedInserts: Array<{ table: unknown; obj: Record<string, unknown> }> = [];
// Visits "stored" in share_visits — array of { shareId, visitorCookie, visitorIp }
let recordedVisits: Array<{
  shareId: string;
  visitorCookie: string;
  visitorIp: string;
}> = [];

// Helper to build a share row with sensible defaults.
function makeShare(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'share-uuid-1',
    token: 'test-token',
    contentItemId: 'content-uuid-1',
    status: 'active',
    createdAt: new Date('2026-01-01'),
    expiresAt: null,
    maxViews: null,
    maxUniqueVisitors: null,
    burnAfterRead: false,
    viewCount: 0,
    uniqueVisitorCount: 0,
    ...overrides,
  };
}

// Mock db: supports select().from().where().limit(), update().set()
// .where().returning(), and insert().values(). The sql template tag
// for atomic increment is handled by detecting the set value shape.
// Conditions are sentinel objects from the mocked drizzle-orm eq/and.
const db = {
  select: () => ({
    from: (table: unknown) => ({
      where: (cond: { column: string; value: unknown } | { __and: Array<{ column: string; value: unknown }> }) => ({
        limit: (_n: number) => {
          // shares lookup by token: eq(shares.token, token)
          if (table === shares && 'column' in cond && cond.column === shares.token) {
            const row = dbRows[cond.value as string];
            return Promise.resolve(row ? [row] : []);
          }
          // share_visits dedup query: and(eq(shareId, ...), eq(visitorCookie|visitorIp, ...))
          if (table === shareVisits && '__and' in cond) {
            const shareIdCond = cond.__and.find((c) => c.column === shareVisits.shareId);
            const cookieCond = cond.__and.find((c) => c.column === shareVisits.visitorCookie);
            const ipCond = cond.__and.find((c) => c.column === shareVisits.visitorIp);
            const shareId = shareIdCond?.value as string;
            const cookie = cookieCond?.value as string | undefined;
            const ip = ipCond?.value as string | undefined;
            const found = recordedVisits.some(
              (v) =>
                v.shareId === shareId &&
                (cookie !== undefined ? v.visitorCookie === cookie : v.visitorIp === ip),
            );
            return Promise.resolve(found ? [{ exists: true }] : []);
          }
          return Promise.resolve([]);
        },
      }),
    }),
  }),
  update: (table: unknown) => ({
    set: (patch: Record<string, unknown>) => ({
      where: (cond: { column: string; value: unknown }) => {
        // Return a thenable that also has .returning(). Status updates
        // (no increment) await the thenable directly; increment updates
        // call .returning() to get the post-increment row.
        const applyPatch = () => {
          const row = dbRows['__byId__' + cond.value];
          if (!row) return null;
          for (const [k, v] of Object.entries(patch)) {
            if (v && typeof v === 'object' && '__sqlIncrement' in (v as object)) {
              const field = (v as { __sqlIncrement: string }).__sqlIncrement;
              (row as Record<string, unknown>)[field] =
                ((row as Record<string, unknown>)[field] as number) + 1;
            } else {
              (row as Record<string, unknown>)[k] = v;
            }
          }
          return { ...row };
        };
        const record = (returned: Record<string, unknown> | null) => {
          recordedUpdates.push({
            table,
            set: { ...patch },
            cond,
            returned: returned ?? undefined,
          });
        };
        const thenable = {
          then: (resolve: (v: void) => void) => {
            const returned = applyPatch();
            record(returned);
            resolve(undefined);
            return Promise.resolve(undefined);
          },
          returning: () => {
            const returned = applyPatch();
            record(returned);
            return Promise.resolve(returned ? [returned] : []);
          },
        };
        return thenable;
      },
    }),
  }),
  insert: (table: unknown) => ({
    values: (obj: Record<string, unknown>) => {
      recordedInserts.push({ table, obj });
      if (table === shareVisits) {
        recordedVisits.push({
          shareId: obj.shareId as string,
          visitorCookie: obj.visitorCookie as string,
          visitorIp: obj.visitorIp as string,
        });
      }
      return Promise.resolve();
    },
  }),
};

vi.mock('@/lib/db', () => ({
  db,
  shares,
  shareVisits,
}));

vi.mock('next/headers', () => ({
  headers: async () => new Headers(mockHeaders),
  cookies: async () => ({
    get: (name: string) =>
      mockCookies[name] ? { value: mockCookies[name] } : undefined,
  }),
}));

// Mock header/cookie state for visitor helper tests.
let mockHeaders: Record<string, string> = {};
let mockCookies: Record<string, string> = {};

// Import after mocks are registered.
const { checkAccess } = await import('@/lib/access/control');
const { extractVisitorIp, getVisitorCookie } = await import(
  '@/lib/access/visitor'
);

describe('checkAccess — not found', () => {
  beforeEach(() => {
    dbRows = {};
    recordedUpdates = [];
    recordedInserts = [];
    recordedVisits = [];
  });

  it('returns { allowed: false, reason: "not_found" } for unknown token', async () => {
    const result = await checkAccess('not-found-token', 'cookie-1', '1.2.3.4');
    expect(result).toEqual({ allowed: false, reason: 'not_found' });
  });
});

describe('checkAccess — revoked (Pitfall 7: no increment)', () => {
  beforeEach(() => {
    dbRows = {
      'revoked-token': makeShare({
        id: 'share-revoked',
        token: 'revoked-token',
        status: 'revoked',
        viewCount: 5,
      }),
    };
    // index by id for update().where(eq(id)).returning()
    dbRows['__byId__share-revoked'] = dbRows['revoked-token'];
    recordedUpdates = [];
    recordedInserts = [];
    recordedVisits = [];
  });

  it('returns { allowed: false, reason: "revoked" } without incrementing viewCount', async () => {
    const result = await checkAccess('revoked-token', 'cookie-1', '1.2.3.4');
    expect(result).toEqual({ allowed: false, reason: 'revoked' });
    // No update should have been recorded (no increment, no status change)
    expect(recordedUpdates).toHaveLength(0);
  });
});

describe('checkAccess — expired (SHRE-03)', () => {
  beforeEach(() => {
    const past = new Date(Date.now() - 60_000);
    dbRows = {
      'expired-share-token': makeShare({
        id: 'share-expired',
        token: 'expired-share-token',
        status: 'active',
        expiresAt: past,
      }),
    };
    dbRows['__byId__share-expired'] = dbRows['expired-share-token'];
    recordedUpdates = [];
    recordedInserts = [];
    recordedVisits = [];
  });

  it('returns { allowed: false, reason: "expired" } and updates status to "expired"', async () => {
    const result = await checkAccess('expired-share-token', 'cookie-1', '1.2.3.4');
    expect(result).toEqual({ allowed: false, reason: 'expired' });
    // status should be updated to 'expired'
    const statusUpdate = recordedUpdates.find(
      (u) => u.set.status === 'expired',
    );
    expect(statusUpdate).toBeDefined();
  });
});

describe('checkAccess — max views (SHRE-04)', () => {
  beforeEach(() => {
    dbRows = {
      'maxed-views-token': makeShare({
        id: 'share-maxed-views',
        token: 'maxed-views-token',
        status: 'active',
        maxViews: 10,
        viewCount: 10,
      }),
    };
    dbRows['__byId__share-maxed-views'] = dbRows['maxed-views-token'];
    recordedUpdates = [];
    recordedInserts = [];
    recordedVisits = [];
  });

  it('returns { allowed: false, reason: "max_views" } and updates status to "max_views"', async () => {
    const result = await checkAccess('maxed-views-token', 'cookie-1', '1.2.3.4');
    expect(result).toEqual({ allowed: false, reason: 'max_views' });
    const statusUpdate = recordedUpdates.find(
      (u) => u.set.status === 'max_views',
    );
    expect(statusUpdate).toBeDefined();
  });
});

describe('checkAccess — max unique visitors (SHRE-05, D-51)', () => {
  beforeEach(() => {
    dbRows = {
      'maxed-visitors-token': makeShare({
        id: 'share-maxed-visitors',
        token: 'maxed-visitors-token',
        status: 'active',
        maxUniqueVisitors: 3,
        uniqueVisitorCount: 3,
      }),
    };
    dbRows['__byId__share-maxed-visitors'] = dbRows['maxed-visitors-token'];
    recordedUpdates = [];
    recordedInserts = [];
    recordedVisits = [];
  });

  it('blocks a NEW visitor with { allowed: false, reason: "max_visitors" } and updates status', async () => {
    // No prior visit from this cookie → new visitor → blocked
    recordedVisits = [];
    const result = await checkAccess(
      'maxed-visitors-token',
      'new-cookie',
      '9.9.9.9',
    );
    expect(result).toEqual({ allowed: false, reason: 'max_visitors' });
    const statusUpdate = recordedUpdates.find(
      (u) => u.set.status === 'max_visitors',
    );
    expect(statusUpdate).toBeDefined();
  });

  it('allows an EXISTING visitor (already counted) — limit only blocks NEW visitors', async () => {
    // Simulate a prior visit from the same cookie
    recordedVisits = [
      { shareId: 'share-maxed-visitors', visitorCookie: 'existing-cookie', visitorIp: '1.1.1.1' },
    ];
    const result = await checkAccess(
      'maxed-visitors-token',
      'existing-cookie',
      '1.1.1.1',
    );
    expect(result.allowed).toBe(true);
  });
});

describe('checkAccess — burn after read (SHRE-07, Pitfall 3)', () => {
  beforeEach(() => {
    dbRows = {
      'burn-after-read-token': makeShare({
        id: 'share-burn',
        token: 'burn-after-read-token',
        status: 'active',
        burnAfterRead: true,
        viewCount: 0,
      }),
    };
    dbRows['__byId__share-burn'] = dbRows['burn-after-read-token'];
    recordedUpdates = [];
    recordedInserts = [];
    recordedVisits = [];
  });

  it('first view: allowed=true, sets status to "burned"', async () => {
    const result = await checkAccess(
      'burn-after-read-token',
      'cookie-1',
      '1.2.3.4',
    );
    expect(result.allowed).toBe(true);
    // After increment, viewCount becomes 1 → status set to 'burned'
    const burnUpdate = recordedUpdates.find((u) => u.set.status === 'burned');
    expect(burnUpdate).toBeDefined();
  });

  it('second view: blocked with reason "burned" (status already burned)', async () => {
    // Simulate the share already being burned (viewCount=1, status=burned)
    dbRows['burn-after-read-token'] = makeShare({
      id: 'share-burn',
      token: 'burn-after-read-token',
      status: 'burned',
      burnAfterRead: true,
      viewCount: 1,
    });
    dbRows['__byId__share-burn'] = dbRows['burn-after-read-token'];
    recordedUpdates = [];
    const result = await checkAccess(
      'burn-after-read-token',
      'cookie-1',
      '1.2.3.4',
    );
    expect(result).toEqual({ allowed: false, reason: 'burned' });
    // Pitfall 7: no increment for non-active status
    expect(recordedUpdates).toHaveLength(0);
  });
});

describe('checkAccess — already burned status', () => {
  beforeEach(() => {
    dbRows = {
      'burned-token': makeShare({
        id: 'share-burned',
        token: 'burned-token',
        status: 'burned',
        viewCount: 1,
      }),
    };
    dbRows['__byId__share-burned'] = dbRows['burned-token'];
    recordedUpdates = [];
    recordedInserts = [];
    recordedVisits = [];
  });

  it('returns { allowed: false, reason: "burned" } without incrementing', async () => {
    const result = await checkAccess('burned-token', 'cookie-1', '1.2.3.4');
    expect(result).toEqual({ allowed: false, reason: 'burned' });
    expect(recordedUpdates).toHaveLength(0);
  });
});

describe('checkAccess — active share with no limits', () => {
  beforeEach(() => {
    dbRows = {
      'active-token': makeShare({
        id: 'share-active',
        token: 'active-token',
        status: 'active',
        viewCount: 0,
        uniqueVisitorCount: 0,
      }),
    };
    dbRows['__byId__share-active'] = dbRows['active-token'];
    recordedUpdates = [];
    recordedInserts = [];
    recordedVisits = [];
  });

  it('returns { allowed: true } and atomically increments viewCount by 1', async () => {
    const result = await checkAccess('active-token', 'cookie-1', '1.2.3.4');
    expect(result.allowed).toBe(true);
    // The increment update uses sql`viewCount + 1` (detected as __sqlIncrement)
    const incrementUpdate = recordedUpdates.find(
      (u) =>
        u.set.viewCount &&
        typeof u.set.viewCount === 'object' &&
        '__sqlIncrement' in (u.set.viewCount as object),
    );
    expect(incrementUpdate).toBeDefined();
    // The returned share should have viewCount = 1
    if (result.allowed) {
      expect(result.share.viewCount).toBe(1);
    }
  });

  it('records a share_visits row with cookie + IP (D-51)', async () => {
    await checkAccess('active-token', 'cookie-1', '1.2.3.4');
    const visitInsert = recordedInserts.find((i) => i.table === shareVisits);
    expect(visitInsert).toBeDefined();
    expect(visitInsert!.obj.shareId).toBe('share-active');
    expect(visitInsert!.obj.visitorCookie).toBe('cookie-1');
    expect(visitInsert!.obj.visitorIp).toBe('1.2.3.4');
  });

  it('increments uniqueVisitorCount for a new visitor', async () => {
    recordedVisits = []; // no prior visits → new visitor
    await checkAccess('active-token', 'cookie-new', '5.6.7.8');
    const uniqueIncrement = recordedUpdates.find(
      (u) =>
        u.set.uniqueVisitorCount &&
        typeof u.set.uniqueVisitorCount === 'object' &&
        '__sqlIncrement' in (u.set.uniqueVisitorCount as object),
    );
    expect(uniqueIncrement).toBeDefined();
  });

  it('does NOT increment uniqueVisitorCount for a returning visitor', async () => {
    // Simulate a prior visit from the same cookie
    recordedVisits = [
      { shareId: 'share-active', visitorCookie: 'cookie-returning', visitorIp: '5.6.7.8' },
    ];
    await checkAccess('active-token', 'cookie-returning', '5.6.7.8');
    const uniqueIncrement = recordedUpdates.find(
      (u) =>
        u.set.uniqueVisitorCount &&
        typeof u.set.uniqueVisitorCount === 'object' &&
        '__sqlIncrement' in (u.set.uniqueVisitorCount as object),
    );
    expect(uniqueIncrement).toBeUndefined();
  });
});

describe('extractVisitorIp (D-51)', () => {
  beforeEach(() => {
    mockHeaders = {};
  });

  it('returns the first segment of x-forwarded-for, trimmed', async () => {
    mockHeaders['x-forwarded-for'] = '  1.2.3.4 , 5.6.7.8  ';
    const ip = await extractVisitorIp();
    expect(ip).toBe('1.2.3.4');
  });

  it('returns "unknown" when x-forwarded-for is absent', async () => {
    const ip = await extractVisitorIp();
    expect(ip).toBe('unknown');
  });
});

describe('getVisitorCookie (D-51)', () => {
  beforeEach(() => {
    mockCookies = {};
  });

  it('returns the visitor_id cookie value when present', async () => {
    mockCookies['visitor_id'] = 'abc123';
    const val = await getVisitorCookie();
    expect(val).toBe('abc123');
  });

  it('returns undefined when visitor_id cookie is absent', async () => {
    const val = await getVisitorCookie();
    expect(val).toBeUndefined();
  });
});
