// lib/mirror/__tests__/comments.test.ts
// Plan 03-01, Task 2 — RED unit test for @/lib/mirror/comments (implemented in 03-04).
// Covers D-24 (default all retained), D-25 (replies follow parent), D-27 (all stored).
import { describe, it, expect } from 'vitest';
import { buildCommentRecords } from '@/lib/mirror/comments';
import type { Comment } from '@/lib/fetcher/types';

// Helper: build a minimal Comment tree for tests.
function makeComment(
  id: string,
  replies: Comment[] = [],
): Comment {
  return {
    id,
    content: `content-${id}`,
    author: {
      id: `author-${id}`,
      name: `name-${id}`,
      handle: `handle-${id}`,
      url: `https://example.com/${id}`,
      avatarUrl: `https://example.com/avatar-${id}.png`,
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    stats: { likes: 0, replies: replies.length },
    replies: replies.length > 0 ? replies : undefined,
  };
}

const tree: Comment[] = [
  makeComment('c1', [makeComment('c1r1'), makeComment('c1r2')]),
  makeComment('c2', [makeComment('c2r1')]),
  makeComment('c3'),
];

describe('buildCommentRecords — D-24 default all retained', () => {
  it('marks every comment retained=true when all parent ids selected', () => {
    const records = buildCommentRecords(tree, ['c1', 'c2', 'c3']);
    for (const r of records) {
      expect(r.retained).toBe(true);
    }
  });
});

describe('buildCommentRecords — D-25 replies follow parent', () => {
  it('unselecting a parent marks the parent and all its replies retained=false', () => {
    const records = buildCommentRecords(tree, ['c2', 'c3']);
    const byId = new Map(records.map((r) => [r.id, r]));
    expect(byId.get('c1')?.retained).toBe(false);
    expect(byId.get('c1r1')?.retained).toBe(false);
    expect(byId.get('c1r2')?.retained).toBe(false);
    expect(byId.get('c2')?.retained).toBe(true);
    expect(byId.get('c2r1')?.retained).toBe(true);
    expect(byId.get('c3')?.retained).toBe(true);
  });
});

describe('buildCommentRecords — D-27 all comments stored', () => {
  it('includes every comment and reply (flattened) regardless of retained', () => {
    const records = buildCommentRecords(tree, ['c3']);
    const ids = records.map((r) => r.id).sort();
    expect(ids).toEqual(
      ['c1', 'c1r1', 'c1r2', 'c2', 'c2r1', 'c3'].sort(),
    );
  });
});
