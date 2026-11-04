'use client';

// app/s/[token]/_components/ThreadParents.tsx
// The tweets an X post replies to, shown above it like X's conversation view.
//
// Collapsed, only the tweet directly above shows, its lower half faded out;
// clicking expands the whole chain, root first. Each tweet can be opened on its
// own page under the same share (/s/<token>/x/<id>) — still read from this
// mirror, never turned into a new mirror. When the stored chain stops short of
// its root, the earlier tweets can be loaded (main page, saved into the
// mirror) or opened (an opened post's page).

import { useState } from 'react';
import Link from 'next/link';
import type { ThreadNode } from '@/lib/mirror/thread-view';
import { CommentBody } from './CommentListClient';

export function ThreadParents({
  parents: initial,
  parentMissing: initialMissing,
  token,
  earlierMode = 'load',
}: {
  parents: ThreadNode[];
  parentMissing: string | null;
  token: string;
  /** 'load' fetches earlier tweets into the mirror; 'open' links to the earliest one's page. */
  earlierMode?: 'load' | 'open';
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

  const direct = parents[parents.length - 1];
  if (!direct && !parentMissing) return null;

  if (!expanded) {
    return (
      <div className="mb-3">
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="group relative block w-full overflow-hidden rounded-2xl border border-border/70 bg-surface/60 px-4 pt-4 text-left"
          aria-label="展开上文"
        >
          {direct ? (
            <div className="max-h-28 overflow-hidden">
              <CommentBody node={direct} />
            </div>
          ) : (
            <div className="pb-4 text-[13px] text-muted">这是一条回复，上文未保存</div>
          )}
          <span className="pointer-events-none absolute inset-x-0 bottom-0 flex h-16 items-end justify-center bg-gradient-to-b from-transparent to-paper pb-2 text-[13px] font-medium text-brand group-hover:text-brand-hover">
            展开上文{parents.length > 1 ? `（${parents.length} 条）` : ''}
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="mb-3">
      <div className="rounded-2xl border border-border/70 bg-surface/60 px-4">
        {parentMissing && (
          <div className="border-b border-border/60 py-3">
            {earlierMode === 'open' ? (
              <Link
                href={`/s/${token}/x/${parentMissing}`}
                className="text-[13px] font-medium text-brand transition-colors hover:text-brand-hover"
              >
                打开更早的帖子
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => void loadEarlier()}
                disabled={loading}
                className="text-[13px] font-medium text-brand transition-colors hover:text-brand-hover disabled:opacity-60"
              >
                {loading ? '加载中…' : '加载更早的帖子'}
              </button>
            )}
            {error && <div className="mt-1 text-[13px] text-danger">{error}</div>}
          </div>
        )}
        {parents.map((post) => (
          <div key={post.id} className="relative py-4">
            {/* Thread line down to the next tweet, as on X. */}
            <span aria-hidden="true" className="absolute bottom-0 left-[17px] top-14 w-0.5 bg-border/70" />
            <CommentBody node={post} />
            <div className="ml-12 mt-1.5">
              <Link
                href={`/s/${token}/x/${post.id}`}
                className="text-[12px] text-muted transition-colors hover:text-brand"
              >
                打开这条帖子 →
              </Link>
            </div>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setExpanded(false)}
        className="mt-1.5 text-[13px] text-muted transition-colors hover:text-ink"
      >
        收起上文
      </button>
    </div>
  );
}
