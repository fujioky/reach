// lib/fetcher/__tests__/x-reply-tree.test.ts — nesting X replies by in_reply_to.
import { describe, it, expect } from 'vitest';
import { buildReplyTree } from '@/lib/fetcher/platforms/twitter';
import type { AgentReachComment, Comment } from '@/lib/fetcher/types';

function raw(id: string, inReplyTo: string | null): AgentReachComment {
  return {
    id,
    content: id,
    author: { id: id, name: id, handle: id, url: '', avatar_url: '' } as AgentReachComment['author'],
    created_at: '',
    stats: { likes: 0, comments: 0, reposts: 0, views: 0, collects: 0 },
    in_reply_to: inReplyTo,
  };
}

function normalized(list: AgentReachComment[]): Comment[] {
  return list.map((c) => ({
    id: c.id,
    content: c.content,
    author: { id: c.id, name: c.id, handle: c.id, url: '', avatarUrl: '' },
    createdAt: '',
    stats: { likes: 0, replies: 0 },
  }));
}

describe('buildReplyTree', () => {
  it('nests replies under the reply they answer and keeps the rest top level', () => {
    const list = [raw('a', 'post'), raw('a1', 'a'), raw('a1x', 'a1'), raw('b', 'post'), raw('orphan', 'gone')];
    const tree = buildReplyTree('post', normalized(list), list);
    expect(tree.map((c) => c.id)).toEqual(['a', 'b', 'orphan']);
    expect(tree[0]!.replies!.map((c) => c.id)).toEqual(['a1']);
    expect(tree[0]!.replies![0]!.replies!.map((c) => c.id)).toEqual(['a1x']);
  });
});
