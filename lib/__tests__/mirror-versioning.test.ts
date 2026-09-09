// lib/__tests__/mirror-versioning.test.ts
// Plan 05-03, Task 2 — unit tests for mirror versioning helpers (D-53).
//
// Tests detectSubstantialChange (body/comments/media only — Pitfall 5),
// pruneVersions (max 3, deletes oldest), and rollbackVersion (writes
// snapshot back to content_items + media + comments in a transaction).
// Mock-db pattern follows lib/__tests__/mirror-actions.test.ts.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { MirrorSnapshot } from '@/lib/mirror/versioning';
import type { FetchedContent } from '@/lib/fetcher/types';

// ── Mock table sentinel objects (distinct references for assert) ──
const contentItems = { __table: 'content_items' };
const media = { __table: 'media' };
const comments = { __table: 'comments' };
const mirrorVersions = { __table: 'mirror_versions' };

// Recorded transaction operations, reset per test.
let recordedInserts: Array<{ table: unknown; obj: Record<string, unknown> }> = [];
let recordedDeletes: Array<{ table: unknown; cond: unknown }> = [];
let recordedUpdates: Array<{ table: unknown; set: Record<string, unknown> }> = [];

const CONTENT_ITEM_ID = '22222222-2222-4222-8222-222222222222';

// Mock tx: insert/delete/update return thenables with the chain methods.
const mockTx = {
  insert: (table: unknown) => ({
    values: (obj: Record<string, unknown>) => {
      recordedInserts.push({ table, obj });
      return Promise.resolve();
    },
  }),
  delete: (table: unknown) => ({
    where: (cond: unknown) => {
      recordedDeletes.push({ table, cond });
      return Promise.resolve();
    },
  }),
  update: (table: unknown) => ({
    set: (setObj: Record<string, unknown>) => {
      recordedUpdates.push({ table, set: setObj });
      return {
        where: () => Promise.resolve(),
      };
    },
  }),
};

// Mock db: select returns a flexible thenable chain; transaction invokes callback.
// We control select results via `selectResult` (reset per test).
let selectResult: unknown = undefined;
const db = {
  transaction: async (fn: (tx: typeof mockTx) => Promise<unknown>) =>
    fn(mockTx),
  select: () => {
    const chain: Record<string, unknown> = {};
    const resolve = () => Promise.resolve(selectResult ?? []);
    chain.from = () => chain;
    chain.where = () => chain;
    chain.orderBy = () => chain;
    chain.limit = () => resolve();
    chain.then = (onFulfilled: (v: unknown) => unknown) =>
      resolve().then(onFulfilled);
    return chain;
  },
  delete: (table: unknown) => ({
    where: () => {
      recordedDeletes.push({ table, cond: 'db-level' });
      return Promise.resolve();
    },
  }),
};

vi.mock('@/lib/db', () => ({
  db,
  contentItems,
  media,
  comments,
  mirrorVersions,
}));

vi.mock('drizzle-orm', () => ({
  eq: () => ({}),
  desc: () => ({}),
  notInArray: () => ({}),
  and: () => ({}),
  sql: (strings: TemplateStringsArray, ...vals: unknown[]) => ({ raw: strings, vals }),
}));

// Import after mocks are registered.
const {
  detectSubstantialChange,
  pruneVersions,
  rollbackVersion,
} = await import('@/lib/mirror/versioning');

// ── Test fixtures ──────────────────────────────────────────────

function makeSnapshot(overrides: Partial<MirrorSnapshot> = {}): MirrorSnapshot {
  return {
    contentItem: {
      title: 'Test tweet',
      body: 'hello world',
      author: { name: 'Test', handle: 'test', avatarUrl: null },
      publishedAt: '2026-06-26T00:00:00.000Z',
      stats: { likes: 10, comments: 5, reposts: 2, views: 100, collects: 0 },
      platformData: null,
      fetchedAt: '2026-06-26T00:00:00.000Z',
    },
    media: [
      { type: 'image', originalUrl: 'https://example.com/img1.jpg', blobUrl: 'blob://1', size: 100, meta: null },
    ],
    comments: [
      { platformCommentId: 'c1', author: { name: 'A', handle: 'a', avatarUrl: null }, text: 'nice', postedAt: '2026-06-26T01:00:00.000Z', likes: 1, retained: true },
    ],
    ...overrides,
  };
}

function makeFetchedContent(overrides: Partial<FetchedContent> = {}): FetchedContent {
  return {
    platform: 'x',
    sourceId: '123',
    sourceUrl: 'https://x.com/test/status/1',
    title: 'Test tweet',
    content: 'hello world',
    body: 'hello world',
    author: { id: '1', name: 'Test', handle: 'test', url: '', avatarUrl: '' },
    publishedAt: '2026-06-26T00:00:00.000Z',
    media: [{ type: 'image', originalUrl: 'https://example.com/img1.jpg' }],
    stats: { likes: 10, comments: 5, reposts: 2, views: 100, collects: 0 },
    comments: [{ id: 'c1', content: 'nice', author: { id: 'a', name: 'A', handle: 'a', url: '', avatarUrl: '' }, createdAt: '2026-06-26T01:00:00.000Z', stats: { likes: 1, replies: 0 } }],
    platformData: {},
    fetchedAt: '2026-06-26T00:00:00.000Z',
    ...overrides,
  };
}

// ── detectSubstantialChange tests (Pitfall 5) ──────────────────

describe('detectSubstantialChange (D-53, Pitfall 5)', () => {
  it('returns false when only stats differ', () => {
    const snapshot = makeSnapshot();
    const content = makeFetchedContent({
      stats: { likes: 999, comments: 999, reposts: 999, views: 999, collects: 999 },
    });
    expect(detectSubstantialChange(snapshot, content)).toBe(false);
  });

  it('returns false when only fetchedAt differs', () => {
    const snapshot = makeSnapshot();
    const content = makeFetchedContent({ fetchedAt: '2026-07-01T00:00:00.000Z' });
    expect(detectSubstantialChange(snapshot, content)).toBe(false);
  });

  it('returns true when body text differs', () => {
    const snapshot = makeSnapshot();
    const content = makeFetchedContent({ body: 'hello world CHANGED', content: 'hello world CHANGED' });
    expect(detectSubstantialChange(snapshot, content)).toBe(true);
  });

  it('returns true when a new comment is added', () => {
    const snapshot = makeSnapshot();
    const content = makeFetchedContent({
      comments: [
        { id: 'c1', content: 'nice', author: { id: 'a', name: 'A', handle: 'a', url: '', avatarUrl: '' }, createdAt: '2026-06-26T01:00:00.000Z', stats: { likes: 1, replies: 0 } },
        { id: 'c2', content: 'new', author: { id: 'b', name: 'B', handle: 'b', url: '', avatarUrl: '' }, createdAt: '2026-06-26T02:00:00.000Z', stats: { likes: 0, replies: 0 } },
      ],
    });
    expect(detectSubstantialChange(snapshot, content)).toBe(true);
  });

  it('returns true when comment text changes', () => {
    const snapshot = makeSnapshot();
    const content = makeFetchedContent({
      comments: [
        { id: 'c1', content: 'nice CHANGED', author: { id: 'a', name: 'A', handle: 'a', url: '', avatarUrl: '' }, createdAt: '2026-06-26T01:00:00.000Z', stats: { likes: 1, replies: 0 } },
      ],
    });
    expect(detectSubstantialChange(snapshot, content)).toBe(true);
  });

  it('returns true when media list changes (image added)', () => {
    const snapshot = makeSnapshot();
    const content = makeFetchedContent({
      media: [
        { type: 'image', originalUrl: 'https://example.com/img1.jpg' },
        { type: 'image', originalUrl: 'https://example.com/img2.jpg' },
      ],
    });
    expect(detectSubstantialChange(snapshot, content)).toBe(true);
  });

  it('returns true when media list changes (image removed)', () => {
    const snapshot = makeSnapshot();
    const content = makeFetchedContent({ media: [] });
    expect(detectSubstantialChange(snapshot, content)).toBe(true);
  });
});

// ── pruneVersions tests (D-53: max 3) ──────────────────────────

describe('pruneVersions (D-53: max 3, deletes oldest)', () => {
  beforeEach(() => {
    recordedDeletes = [];
    selectResult = undefined;
  });

  it('keeps only the 3 newest versions when more than 3 exist', async () => {
    selectResult = [
      { id: 'v4', contentItemId: CONTENT_ITEM_ID, versionNumber: 4, snapshot: {}, createdAt: new Date() },
      { id: 'v3', contentItemId: CONTENT_ITEM_ID, versionNumber: 3, snapshot: {}, createdAt: new Date() },
      { id: 'v2', contentItemId: CONTENT_ITEM_ID, versionNumber: 2, snapshot: {}, createdAt: new Date() },
      { id: 'v1', contentItemId: CONTENT_ITEM_ID, versionNumber: 1, snapshot: {}, createdAt: new Date() },
    ];

    await pruneVersions(CONTENT_ITEM_ID, 3);

    // Should delete the oldest (version 1) via db.delete
    expect(recordedDeletes.length).toBeGreaterThanOrEqual(1);
  });

  it('does nothing when 3 or fewer versions exist', async () => {
    selectResult = [
      { id: 'v3', contentItemId: CONTENT_ITEM_ID, versionNumber: 3, snapshot: {}, createdAt: new Date() },
      { id: 'v2', contentItemId: CONTENT_ITEM_ID, versionNumber: 2, snapshot: {}, createdAt: new Date() },
      { id: 'v1', contentItemId: CONTENT_ITEM_ID, versionNumber: 1, snapshot: {}, createdAt: new Date() },
    ];

    await pruneVersions(CONTENT_ITEM_ID, 3);

    expect(recordedDeletes.length).toBe(0);
  });
});

// ── rollbackVersion tests (D-53: write snapshot back) ──────────

describe('rollbackVersion (D-53: writes snapshot back to 3 tables)', () => {
  beforeEach(() => {
    recordedInserts = [];
    recordedDeletes = [];
    recordedUpdates = [];
    selectResult = undefined;
  });

  it('writes snapshot data back to content_items, media, comments in a transaction', async () => {
    const snapshot = makeSnapshot();
    selectResult = [
      { id: 'rv1', contentItemId: CONTENT_ITEM_ID, versionNumber: 2, snapshot, createdAt: new Date() },
    ];

    await rollbackVersion(CONTENT_ITEM_ID, 2);

    // Should update content_items
    const contentUpdate = recordedUpdates.find((u) => u.table === contentItems);
    expect(contentUpdate).toBeDefined();
    expect(contentUpdate!.set.body).toBe('hello world');

    // Should delete old media and insert snapshot media
    const mediaDelete = recordedDeletes.find((d) => d.table === media);
    expect(mediaDelete).toBeDefined();
    const mediaInsert = recordedInserts.find((i) => i.table === media);
    expect(mediaInsert).toBeDefined();

    // Should delete old comments and insert snapshot comments
    const commentsDelete = recordedDeletes.find((d) => d.table === comments);
    expect(commentsDelete).toBeDefined();
    const commentsInsert = recordedInserts.find((i) => i.table === comments);
    expect(commentsInsert).toBeDefined();
  });
});
