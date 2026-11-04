'use client';

// app/s/[token]/_components/ThreadParents.tsx
// The tweets an X post replies to, shown above it like X's conversation view.
// Collapsed by default; when the stored chain stops short of its root, the
// visitor can load the earlier tweets (/api/x-thread), which are saved into
// the mirror for the next visitor.

import { useState } from 'react';
import type { ThreadNode } from '@/lib/mirror/thread-view';
import { CommentBody } from './CommentListClient';

export function ThreadParents({
  parents: initial,
  parentMissing: initialMissing,
  token,
}: {
  parents: ThreadNode[];
  parentMissing: string | null;
  token: string;
}) {
  const [parents, setParents] = useState(initial);
  const [parentMissing, setParentMissing] = useState(initialMissing);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadEarlier() {
    if (!parentMissing) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/x-thread', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, id: parentMissing, direction: 'parents' }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; nodes?: ThreadNode[]; parentMissing?: string | null }
        | null;
      if (res.status === 429) throw new Error('操作太频繁，请稍后再试');
      if (!res.ok || !data?.ok) throw new Error('加载失败，请稍后再试');
      setParents((current) => [...(data.nodes ?? []), ...current]);
      setParentMissing(data.parentMissing ?? null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const replyingTo = parents[parents.length - 1]?.author.handle;

  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 text-[13px] text-muted transition-colors hover:text-ink"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d={expanded ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} />
        </svg>
        {expanded
          ? '收起上文'
          : replyingTo
            ? `回复 @${replyingTo} · 查看上文（${parents.length} 条）`
            : '这是一条回复 · 查看上文'}
      </button>

      {expanded && (
        <div className="mt-2 rounded-2xl border border-border/70 bg-surface/60 px-4">
          {parentMissing && (
            <div className="border-b border-border/60 py-3">
              <button
                type="button"
                onClick={() => void loadEarlier()}
                disabled={loading}
                className="text-[13px] font-medium text-brand transition-colors hover:text-brand-hover disabled:opacity-60"
              >
                {loading ? '加载中…' : '加载更早的帖子'}
              </button>
              {error && <div className="mt-1 text-[13px] text-danger">{error}</div>}
            </div>
          )}
          {parents.map((post, index) => (
            <div key={post.id} className="relative py-4">
              {/* Thread line down to the next post, as on X. */}
              <span
                aria-hidden="true"
                className="absolute bottom-0 left-[17px] top-14 w-0.5 bg-border/70"
              />
              <CommentBody node={post} />
              {index === parents.length - 1 && <span className="sr-only">以下是被镜像的回复</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
