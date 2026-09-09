// lib/__tests__/mirror-refresh.test.ts
// Plan 05-04, Task 1 — unit tests for refreshMirror() orchestration (D-53, MIRR-05).
//
// The refreshMirror() function is tested with @/lib/db, @/lib/fetcher,
// @/lib/blob/download-image, @/lib/mirror/versioning, and @/lib/mirror/comments
// mocked so we can assert on call ordering, transaction contents, and the
// no-change vs change vs error code paths without a live Postgres or network.
// Validates:
// - No substantial change: stats-only update, no version, pruneVersions NOT called
// - Substantial change: createSnapshot BEFORE any contentItems/media/comments
//   writes (Pitfall 4 — snapshot-before-write)
// - Substantial change: downloadImageToBlob OUTSIDE db.transaction (Anti-Pattern)
// - Substantial change: version insert + prune + transactional writes, returns
//   { changed: true, version: N }
// - Error path: contentItem not found returns error without fetching
// - Error path: fetchContent throw propagates without partial writes
//
// Fills RESEARCH.md Wave 0 gap (line 721).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FetchedContent, MediaItem } from '@/lib/fetcher/types';

// ── Mock table sentinel objects (distinct references for assert) ──
// Properties mirror the column names accessed by refreshMirror via eq()/sql.
const contentItems = { __table: 'content_items', id: 'id' };
const media = { __table: 'media', contentItemId: 'content_item_id' };
const comments = { __table: 'comments', contentItemId: 'content_item_id' };
const mirrorVersions = {
  __table: 'mirror_versions',
  versionNumber: 'version_number',
  contentItemId: 'content_item_id',
};

const CONTENT_ITEM_ID = '22222222-2222-4222-8222-222222222222';
const SOURCE_URL = 'https://x.com/test/status/42';

// ── Recorded operations, reset per test ──
let recordedUpdates: Array<{
  table: unknown;
  values: Record<string, unknown>;
  cond: unknown;
}> = [];
let recordedInserts: Array<{ table: unknown; obj: Record<string, unknown> }> =
  [];
let recordedDeletes: Array<{ table: unknown; cond: unknown }> = [];
let txOperations: Array<{
  op: string;
  table: unknown;
  values?: Record<string, unknown>;
  cond?: unknown;
}> = [];
let callOrder: string[] = [];
let inTransaction = false;

// Per-test configurable select results keyed by table __table name.
let selectResultByTable: Record<string, unknown[]> = {};

// ── Mock tx: update/delete/insert record operations + call order ──
const mockTx = {
  update: (table: unknown) => ({
    set: (values: Record<string, unknown>) => ({
      where: (cond: unknown) => {
        txOperations.push({ op: 'update', table, values, cond });
        callOrder.push(`tx.update.${(table as { __table?: string }).__table}`);
        return Promise.resolve();
      },
    }),
  }),
  delete: (table: unknown) => ({
    where: (cond: unknown) => {
      txOperations.push({ op: 'delete', table, cond });
      callOrder.push(`tx.delete.${(table as { __table?: string }).__table}`);
      return Promise.resolve();
    },
  }),
  insert: (table: unknown) => ({
    values: (obj: Record<string, unknown>) => {
      txOperations.push({ op: 'insert', table, values: obj });
      callOrder.push(`tx.insert.${(table as { __table?: string }).__table}`);
      return Promise.resolve();
    },
  }),
};

// ── Mock db: chainable select/update/insert/delete + transaction ──
const db = {
  select: (_columns?: unknown) => ({
    from: (table: unknown) => ({
      where: (_cond: unknown) => {
        const tableName = (table as { __table?: string }).__table ?? '';
        const result = selectResultByTable[tableName] ?? [];
        // Thenable with .limit() so both await ... and await ... .limit(n) work.
        const thenable = {
          limit: (n: number) => Promise.resolve(result.slice(0, n)),
          then: <T>(
            resolve: (v: unknown[]) => T | Promise<T>,
            reject: (e: unknown) => T | Promise<T>,
          ) => Promise.resolve(result).then(resolve, reject),
        };
        return thenable;
      },
    }),
  }),
  update: (table: unknown) => ({
    set: (values: Record<string, unknown>) => ({
      where: (cond: unknown) => {
        recordedUpdates.push({ table, values, cond });
        callOrder.push(`db.update.${(table as { __table?: string }).__table}`);
        return Promise.resolve();
      },
    }),
  }),
  insert: (table: unknown) => ({
    values: (obj: Record<string, unknown>) => {
      recordedInserts.push({ table, obj });
      callOrder.push(`db.insert.${(table as { __table?: string }).__table}`);
      return Promise.resolve();
    },
  }),
  delete: (table: unknown) => ({
    where: (cond: unknown) => {
      recordedDeletes.push({ table, cond });
      return Promise.resolve();
    },
  }),
  transaction: async (fn: (tx: typeof mockTx) => Promise<unknown>) => {
    callOrder.push('transaction-start');
    inTransaction = true;
    try {
      return await fn(mockTx);
    } finally {
      inTransaction = false;
      callOrder.push('transaction-end');
    }
  },
};

vi.mock('@/lib/db', () => ({
  db,
  contentItems,
  media,
  comments,
  mirrorVersions,
}));

const fetchContentMock = vi.fn();
vi.mock('@/lib/fetcher', () => ({
  fetchContent: fetchContentMock,
}));

const downloadImageToBlobMock = vi.fn();
vi.mock('@/lib/blob/download-image', () => ({
  downloadImageToBlob: downloadImageToBlobMock,
}));

const createSnapshotMock = vi.fn();
const detectSubstantialChangeMock = vi.fn();
const pruneVersionsMock = vi.fn();
vi.mock('@/lib/mirror/versioning', () => ({
  createSnapshot: createSnapshotMock,
  detectSubstantialChange: detectSubstantialChangeMock,
  pruneVersions: pruneVersionsMock,
  rollbackVersion: vi.fn(),
}));

const buildCommentRecordsMock = vi.fn();
vi.mock('@/lib/mirror/comments', () => ({
  buildCommentRecords: buildCommentRecordsMock,
}));

// Import after mocks are registered.
const { refreshMirror } = await import('@/lib/mirror/refresh');

// ── Helpers: minimal mock data ──────────────────────────────────

function makeContentItemRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: CONTENT_ITEM_ID,
    sourceUrl: SOURCE_URL,
    title: 'Test tweet',
    body: 'hello world',
    author: { name: 'Test', handle: 'test' },
    publishedAt: null,
    stats: { likes: 1, comments: 0, reposts: 0, views: 10, collects: 0 },
    platformData: null,
    fetchedAt: null,
    refreshedAt: null,
    ...overrides,
  };
}

function makeFetchedContent(overrides: Partial<FetchedContent> = {}): FetchedContent {
  return {
    platform: 'x',
    sourceId: '42',
    sourceUrl: SOURCE_URL,
    title: 'Test tweet',
    content: 'hello world',
    body: 'hello world',
    author: {
      id: 'a1',
      name: 'Test',
      handle: 'test',
      url: 'https://x.com/test',
      avatarUrl: 'https://x.com/avatar.png',
    },
    publishedAt: '2026-06-26T00:00:00.000Z',
    media: [],
    stats: { likes: 5, comments: 0, reposts: 0, views: 20, collects: 0 },
    comments: [],
    platformData: {},
    fetchedAt: '2026-06-27T00:00:00.000Z',
    ...overrides,
  };
}

function makeImageMediaItem(url = 'https://pbs.twimg.com/img.jpg'): MediaItem {
  return { type: 'image', originalUrl: url };
}

// ── Tests ───────────────────────────────────────────────────────

describe('refreshMirror() — no-change path (stats-only, no new version)', () => {
  beforeEach(() => {
    recordedUpdates = [];
    recordedInserts = [];
    recordedDeletes = [];
    txOperations = [];
    callOrder = [];
    inTransaction = false;
    selectResultByTable = {
      content_items: [makeContentItemRow()],
    };
    vi.clearAllMocks();
    createSnapshotMock.mockResolvedValue({
      contentItem: { title: 'Test tweet', body: 'hello world' },
      media: [],
      comments: [],
    });
    fetchContentMock.mockResolvedValue(makeFetchedContent());
    detectSubstantialChangeMock.mockReturnValue(false);
  });

  it('updates only stats + refreshedAt, does NOT create a version, does NOT prune', async () => {
    const result = await refreshMirror(CONTENT_ITEM_ID);

    expect(result.changed).toBe(false);

    // stats-only update on contentItems
    const update = recordedUpdates.find((u) => u.table === contentItems);
    expect(update).toBeDefined();
    expect(update!.values).toHaveProperty('stats');
    expect(update!.values).toHaveProperty('refreshedAt');
    // body/title NOT updated in the no-change path
    expect(update!.values).not.toHaveProperty('body');

    // no mirror_versions insert
    const versionInsert = recordedInserts.find(
      (i) => i.table === mirrorVersions,
    );
    expect(versionInsert).toBeUndefined();

    // pruneVersions NOT called
    expect(pruneVersionsMock).not.toHaveBeenCalled();
  });
});

describe('refreshMirror() — change path (substantial change detected)', () => {
  beforeEach(() => {
    recordedUpdates = [];
    recordedInserts = [];
    recordedDeletes = [];
    txOperations = [];
    callOrder = [];
    inTransaction = false;
    selectResultByTable = {
      content_items: [makeContentItemRow()],
      mirror_versions: [{ max: 2 }],
    };
    vi.clearAllMocks();
    createSnapshotMock.mockImplementation(async () => {
      callOrder.push('createSnapshot');
      return {
        contentItem: { title: 'Test tweet', body: 'hello world' },
        media: [],
        comments: [],
      };
    });
    fetchContentMock.mockResolvedValue(
      makeFetchedContent({ body: 'CHANGED body text' }),
    );
    detectSubstantialChangeMock.mockReturnValue(true);
    downloadImageToBlobMock.mockImplementation(async () => {
      callOrder.push('downloadImageToBlob');
      return {
        blobUrl: 'blob://img/1',
        size: 1024,
        pathname: 'images/abc.jpg',
        contentType: 'image/jpeg',
      };
    });
    buildCommentRecordsMock.mockReturnValue([
      {
        id: 'c1',
        platformCommentId: 'c1',
        author: { name: 'Commenter' },
        text: 'nice post',
        postedAt: '2026-06-26T12:00:00.000Z',
        likes: 1,
        retained: true,
      },
    ]);
  });

  it('calls createSnapshot BEFORE any db.update/db.insert on contentItems/media/comments (Pitfall 4)', async () => {
    await refreshMirror(CONTENT_ITEM_ID);

    const snapshotIdx = callOrder.indexOf('createSnapshot');
    expect(snapshotIdx).toBeGreaterThanOrEqual(0);

    // The first write to contentItems/media/comments happens inside the
    // transaction (tx.update.content_items). createSnapshot must precede it.
    const txUpdateContentIdx = callOrder.indexOf('tx.update.content_items');
    expect(txUpdateContentIdx).toBeGreaterThanOrEqual(0);
    expect(snapshotIdx).toBeLessThan(txUpdateContentIdx);

    // Also before the mirror_versions insert (snapshot captured before any writes)
    const versionInsertIdx = callOrder.indexOf('db.insert.mirror_versions');
    expect(versionInsertIdx).toBeGreaterThanOrEqual(0);
    expect(snapshotIdx).toBeLessThan(versionInsertIdx);
  });

  it('calls downloadImageToBlob OUTSIDE the db.transaction callback (Anti-Pattern)', async () => {
    // Provide an image media item so downloadImageToBlob is invoked.
    fetchContentMock.mockResolvedValue(
      makeFetchedContent({
        body: 'CHANGED',
        media: [makeImageMediaItem()],
      }),
    );

    // downloadImageToBlob mock records whether it runs inside the transaction.
    downloadImageToBlobMock.mockImplementation(async () => {
      callOrder.push('downloadImageToBlob');
      expect(inTransaction).toBe(false);
      return {
        blobUrl: 'blob://img/1',
        size: 1024,
        pathname: 'images/x.jpg',
        contentType: 'image/jpeg',
      };
    });

    await refreshMirror(CONTENT_ITEM_ID);

    expect(downloadImageToBlobMock).toHaveBeenCalled();
    // downloadImageToBlob must be called before transaction-start
    const downloadIdx = callOrder.indexOf('downloadImageToBlob');
    const txStartIdx = callOrder.indexOf('transaction-start');
    expect(downloadIdx).toBeGreaterThanOrEqual(0);
    expect(txStartIdx).toBeGreaterThanOrEqual(0);
    expect(downloadIdx).toBeLessThan(txStartIdx);
  });

  it('writes new data in transaction + creates version + prunes, returns { changed: true, version: N }', async () => {
    // Include an image media item so tx.insert(media) is exercised.
    fetchContentMock.mockResolvedValue(
      makeFetchedContent({
        body: 'CHANGED body text',
        media: [makeImageMediaItem()],
      }),
    );

    const result = await refreshMirror(CONTENT_ITEM_ID);

    expect(result.changed).toBe(true);
    expect(result.version).toBe(3); // max=2 → nextVersion=3

    // mirror_versions insert with correct versionNumber
    const versionInsert = recordedInserts.find(
      (i) => i.table === mirrorVersions,
    );
    expect(versionInsert).toBeDefined();
    expect(versionInsert!.obj.versionNumber).toBe(3);
    expect(versionInsert!.obj.contentItemId).toBe(CONTENT_ITEM_ID);

    // pruneVersions called with (contentItemId, 3)
    expect(pruneVersionsMock).toHaveBeenCalledWith(CONTENT_ITEM_ID, 3);

    // Transaction writes: tx.update on contentItems
    const txUpdateContent = txOperations.find(
      (o) => o.op === 'update' && o.table === contentItems,
    );
    expect(txUpdateContent).toBeDefined();
    expect(txUpdateContent!.values).toHaveProperty('body', 'CHANGED body text');

    // Transaction writes: tx.delete + tx.insert on media
    const txDeleteMedia = txOperations.find(
      (o) => o.op === 'delete' && o.table === media,
    );
    expect(txDeleteMedia).toBeDefined();
    const txInsertMedia = txOperations.find(
      (o) => o.op === 'insert' && o.table === media,
    );
    expect(txInsertMedia).toBeDefined();

    // Transaction writes: tx.delete + tx.insert on comments
    const txDeleteComments = txOperations.find(
      (o) => o.op === 'delete' && o.table === comments,
    );
    expect(txDeleteComments).toBeDefined();
    const txInsertComments = txOperations.find(
      (o) => o.op === 'insert' && o.table === comments,
    );
    expect(txInsertComments).toBeDefined();
  });
});

describe('refreshMirror() — error paths', () => {
  beforeEach(() => {
    recordedUpdates = [];
    recordedInserts = [];
    recordedDeletes = [];
    txOperations = [];
    callOrder = [];
    inTransaction = false;
    selectResultByTable = {};
    vi.clearAllMocks();
    createSnapshotMock.mockResolvedValue({
      contentItem: { title: 'Test', body: 'hello' },
      media: [],
      comments: [],
    });
    fetchContentMock.mockResolvedValue(makeFetchedContent());
    detectSubstantialChangeMock.mockReturnValue(false);
  });

  it('returns an error result when contentItem is not found (no fetch, no snapshot)', async () => {
    selectResultByTable = { content_items: [] };

    const result = await refreshMirror('nonexistent-id');

    expect(result.changed).toBe(false);
    expect(result.error).toBeDefined();
    expect(fetchContentMock).not.toHaveBeenCalled();
    expect(createSnapshotMock).not.toHaveBeenCalled();
  });

  it('propagates fetchContent error without partial writes', async () => {
    selectResultByTable = {
      content_items: [makeContentItemRow()],
    };
    fetchContentMock.mockRejectedValue(new Error('Network timeout'));

    const result = await refreshMirror(CONTENT_ITEM_ID);

    expect(result.changed).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('Re-fetch failed');

    // No partial writes: no mirror_versions insert
    const versionInsert = recordedInserts.find(
      (i) => i.table === mirrorVersions,
    );
    expect(versionInsert).toBeUndefined();

    // No contentItems/media/comments updates or transaction writes
    const contentUpdate = recordedUpdates.find(
      (u) => u.table === contentItems,
    );
    expect(contentUpdate).toBeUndefined();
    expect(txOperations).toHaveLength(0);

    // pruneVersions NOT called
    expect(pruneVersionsMock).not.toHaveBeenCalled();
  });
});
