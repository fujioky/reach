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

  // Padding puts the avatars' centre on the same vertical as the post card's
  // avatar below (card padding 20/24px + half of a 44/48px avatar = 42/48px),
  // so the thread line runs straight from the parent to the post.
  const boxPadding = 'px-[24px] md:px-[30px]';
  const lineX = 'left-[41px] md:left-[47px]';

  if (!expanded) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className={`group relative block w-full overflow-hidden rounded-2xl border border-border/70 bg-surface/60 ${boxPadding} pt-4 text-left`}
          aria-label="展开上文"
        >
          {/* From the parent's avatar down to the bottom of the box. */}
          {direct && <span aria-hidden="true" className={`absolute ${lineX} bottom-0 top-[56px] w-0.5 bg-border`} />}
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
        <GapLine />
      </div>
    );
  }

  return (
    <div>
      <div className={`relative rounded-2xl border border-border/70 bg-surface/60 ${boxPadding}`}>
        <div className="flex justify-end pt-3">
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="text-[12px] text-muted transition-colors hover:text-ink"
          >
            收起上文
          </button>
        </div>
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
          <div key={post.id} className="pt-2 first:pt-1">
            {/* Thread line down to the next tweet (and the post below), as on X. */}
            <CommentBody node={post} threadLine>
              <Link
                href={`/s/${token}/x/${post.id}`}
                className="mt-1.5 inline-block text-[12px] text-muted transition-colors hover:text-brand"
              >
                打开这条帖子 →
              </Link>
            </CommentBody>
          </div>
        ))}
        {/* The last parent's line continues to the bottom of the box. */}
        <div className="relative h-4">
          <span aria-hidden="true" className="absolute bottom-0 left-[17px] top-0 w-0.5 bg-border" />
        </div>
      </div>
      <GapLine />
    </div>
  );
}

/** The line across the gap between the chain and the post card. */
function GapLine() {
  return <div aria-hidden="true" className="ml-[41px] h-3 w-0.5 bg-border md:ml-[47px]" />;
}
