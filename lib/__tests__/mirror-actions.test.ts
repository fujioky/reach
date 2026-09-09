// lib/__tests__/mirror-actions.test.ts
// Plan 04-01, Task 3 — RED phase unit tests for createMirror/deleteMirror
// share-link coordination (D-29/D-38, SHRE-01, PATTERNS landmine #1/#3).
//
// The server actions are tested with @/lib/db, @/auth, @/lib/fetcher,
// @/lib/blob/download-image, @/lib/quota, and @/lib/mirror/comments
// mocked so we can assert on the transaction's tx.insert/tx.delete calls
// without a live Postgres or network. Validates:
// - createMirror inserts a shares row with status='active' and the
//   contentItemId returned by the content_items insert (D-29/D-38)
// - createMirror result.shareToken is a 21-char URL-safe token (D-33)
// - deleteMirror deletes shares BEFORE media/comments/contentItems
//   (FK ON DELETE NO ACTION — PATTERNS landmine #1)

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock table sentinel objects (distinct references for assert) ──
const contentItems = { __table: 'content_items' };
const media = { __table: 'media' };
const comments = { __table: 'comments' };
const shares = { __table: 'shares' };
const mirrorVersions = { __table: 'mirror_versions' };
const refreshPreviews = { __table: 'refresh_previews' };

// Recorded transaction operations, reset per test.
let recordedInserts: Array<{ table: unknown; obj: Record<string, unknown> }> = [];
let recordedDeletes: Array<{ table: unknown; cond: unknown }> = [];

// Mock tx: insert returns a thenable with .returning(); delete returns
// a thenable with .where(). The content_items insert returns a fixed id.
const CONTENT_ITEM_ID = '11111111-1111-4111-8111-111111111111';
const mockTx = {
  insert: (table: unknown) => ({
    values: (obj: Record<string, unknown>) => {
      recordedInserts.push({ table, obj });
      return {
        returning: () => Promise.resolve([{ id: CONTENT_ITEM_ID }]),
      };
    },
  }),
  delete: (table: unknown) => ({
    where: (cond: unknown) => {
      recordedDeletes.push({ table, cond });
      return Promise.resolve();
    },
  }),
  // createSnapshot (mirror versioning) reads contentItems/media/comments
  // inside the transaction. The where() result is awaited directly for
  // media/comments and chained with .limit(1) for contentItems.
  select: () => ({
    from: (table: unknown) => {
      const rows =
        table === contentItems
          ? [{
              title: 'Test tweet',
              body: 'hello',
              author: {},
              publishedAt: null,
              stats: {},
              platformData: null,
              fetchedAt: null,
            }]
          : [];
      return {
        where: (_cond: unknown) =>
          Object.assign(Promise.resolve(rows), {
            limit: (_n: number) => Promise.resolve(rows),
          }),
      };
    },
  }),
};

// Mock db: transaction invokes the callback with mockTx and returns its value.
const db = {
  transaction: async (fn: (tx: typeof mockTx) => Promise<unknown>) =>
    fn(mockTx),
};

vi.mock('@/lib/db', () => ({
  db,
  contentItems,
  media,
  comments,
  shares,
  mirrorVersions,
  refreshPreviews,
}));

// Post-transaction video storage upload is gated on this setting — return
// null so the test never reaches the (unmocked) S3 path.
vi.mock('@/lib/settings', () => ({
  getSetting: async () => null,
}));

vi.mock('@/auth', () => ({
  auth: async () => ({ user: { name: 'tester' } }),
}));

vi.mock('@/lib/fetcher', () => ({
  fetchContent: async () => ({
    sourceUrl: 'https://x.com/test/status/1',
    platform: 'x',
    title: 'Test tweet',
    author: { name: 'Test', handle: 'test', avatarUrl: null },
    content: 'hello',
    stats: { likes: 0, comments: 0, reposts: 0, views: 0 },
    platformData: null,
    fetchedAt: '2026-06-26T00:00:00.000Z',
    media: [],
    comments: [],
  }),
}));

vi.mock('@/lib/fetcher/errors', () => ({
  FetcherError: class extends Error {},
  ReachErrorKind: {},
}));

vi.mock('@/lib/blob/download-image', () => ({
  downloadImageToBlob: async () => ({ blobUrl: 'blob://x', size: 0 }),
}));

vi.mock('@/lib/quota', () => ({
  getStorageUsage: async () => 0,
  evaluateQuota: () => ({ warnings: { totalQuota: false, perImage: false, perMirror: false } }),
  LIMITS: { totalQuota: 0, perImage: 0, perMirror: 0 },
}));

vi.mock('@/lib/mirror/comments', () => ({
  buildCommentRecords: () => [],
}));

vi.mock('next/cache', () => ({
  revalidatePath: () => {},
}));

// Import after mocks are registered.
const { createMirror, deleteMirror } = await import('@/app/admin/(shell)/mirrors/actions');

describe('createMirror share-link coordination (D-29/D-38, SHRE-01)', () => {
  beforeEach(() => {
    recordedInserts = [];
    recordedDeletes = [];
  });

  it('inserts a shares row with status="active" and the new contentItemId', async () => {
    const result = await createMirror({
      url: 'https://x.com/test/status/1',
      selectedCommentIds: [],
    });

    expect(result.ok).toBe(true);
    const shareInsert = recordedInserts.find((i) => i.table === shares);
    expect(shareInsert).toBeDefined();
    expect(shareInsert!.obj.status).toBe('active');
    expect(shareInsert!.obj.contentItemId).toBe(CONTENT_ITEM_ID);
    expect(typeof shareInsert!.obj.token).toBe('string');
  });

  it('returns a 21-char URL-safe shareToken (D-33, landmine #3)', async () => {
    const result = await createMirror({
      url: 'https://x.com/test/status/1',
      selectedCommentIds: [],
    });

    expect(result.ok).toBe(true);
    expect(result.shareToken).toBeDefined();
    expect(result.shareToken).toMatch(/^[A-Za-z0-9_-]{21}$/);
  });
});

describe('deleteMirror deletes shares before media (landmine #1, FK NO ACTION)', () => {
  beforeEach(() => {
    recordedInserts = [];
    recordedDeletes = [];
  });

  it('deletes shares, media, comments, then contentItems (shares first)', async () => {
    const result = await deleteMirror(CONTENT_ITEM_ID);

    expect(result.ok).toBe(true);
    const tables = recordedDeletes.map((d) => d.table);
    // shares must appear and must come before media and contentItems.
    const sharesIdx = tables.indexOf(shares);
    const mediaIdx = tables.indexOf(media);
    const contentItemsIdx = tables.indexOf(contentItems);
    expect(sharesIdx).toBeGreaterThanOrEqual(0);
    expect(mediaIdx).toBeGreaterThan(sharesIdx);
    expect(contentItemsIdx).toBeGreaterThan(sharesIdx);
  });
});
