'use client';

// app/s/[token]/_components/CommentListClient.tsx
// Renders the comments as a reply tree. Translation is controlled globally by
// PageTranslationShell — no local toggle here.
//
// Nodes arrive flat and nest by `inReplyTo`. Replies under a comment start
// collapsed; expanding shows the stored ones, and on X, when the platform
// reports more than are stored, offers to load them (/api/x-thread), which
// also saves them into the mirror for later visitors.

import { useMemo, useState } from 'react';
import type { ThreadNode } from '@/lib/mirror/thread-view';
import { TranslatedBody } from './TranslatedBody';
import { XImageGrid } from './XImageGrid';

export type CommentData = ThreadNode;

interface CommentListClientProps {
  comments: CommentData[];
  /** Share token; set on X pages, where more replies can be loaded on demand. */
  token?: string;
}

/** Indentation stops growing past this depth so deep threads stay readable. */
const MAX_INDENT_DEPTH = 4;

export function proxyAvatar(url: string | undefined): string | undefined {
  if (!url) return undefined;
  return `/api/proxy-avatar?url=${encodeURIComponent(url)}`;
}

export function CommentListClient({ comments: initial, token }: CommentListClientProps) {
  const [nodes, setNodes] = useState(initial);

  const { roots, children } = useMemo(() => {
    const ids = new Set(nodes.map((n) => n.id));
    const childMap = new Map<string, CommentData[]>();
    const top: CommentData[] = [];
    for (const node of nodes) {
      if (node.inReplyTo && ids.has(node.inReplyTo)) {
        childMap.set(node.inReplyTo, [...(childMap.get(node.inReplyTo) ?? []), node]);
      } else {
        top.push(node);
      }
    }
    return { roots: top, children: childMap };
  }, [nodes]);

  function merge(loaded: CommentData[]) {
    setNodes((current) => {
      const known = new Set(current.map((n) => n.id));
      return [...current, ...loaded.filter((n) => !known.has(n.id))];
    });
  }

  if (roots.length === 0) {
    return <div className="py-8 text-center text-[13px] text-muted">暂无精选评论</div>;
  }

  return (
    <div>
      {roots.map((comment, index) => (
        <div key={comment.id} className={index < roots.length - 1 ? 'border-b border-border/60' : ''}>
          <CommentNode node={comment} depth={0} childMap={children} token={token} onLoaded={merge} />
        </div>
      ))}
    </div>
  );
}

function CommentNode({
  node,
  depth,
  childMap,
  token,
  onLoaded,
}: {
  node: CommentData;
  depth: number;
  childMap: Map<string, CommentData[]>;
  token?: string;
  onLoaded: (nodes: CommentData[]) => void;
}) {
  const loaded = childMap.get(node.id) ?? [];
  const [expanded, setExpanded] = useState(false);
  const [fetched, setFetched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = Math.max(node.replyCount, loaded.length);
  const canLoadMore = Boolean(token) && !fetched && node.replyCount > loaded.length;

  async function loadMore() {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/x-thread', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, id: node.id, direction: 'replies' }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; nodes?: CommentData[] } | null;
      if (res.status === 429) throw new Error('操作太频繁，请稍后再试');
      if (!res.ok || !data?.ok) throw new Error('加载失败，请稍后再试');
      onLoaded(data.nodes ?? []);
      setFetched(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function toggle() {
    const next = !expanded;
    setExpanded(next);
    // Nothing stored yet: expanding is the same as asking for the replies.
    if (next && loaded.length === 0 && canLoadMore) void loadMore();
  }

  return (
    <div className="py-4">
      <CommentBody node={node} />
      {(total > 0 || loaded.length > 0) && (
        <div className={depth < MAX_INDENT_DEPTH ? 'ml-12' : ''}>
          <button
            type="button"
            onClick={toggle}
            className="mt-2 text-[13px] font-medium text-brand transition-colors hover:text-brand-hover"
          >
            {expanded ? '收起回复' : `展开 ${total} 条回复`}
          </button>
          {expanded && (
            <div className="mt-1 border-l-2 border-border/70 pl-3">
              {loaded.map((child) => (
                <CommentNode
                  key={child.id}
                  node={child}
                  depth={depth + 1}
                  childMap={childMap}
                  token={token}
                  onLoaded={onLoaded}
                />
              ))}
              {canLoadMore && loaded.length > 0 && (
                <button
                  type="button"
                  onClick={() => void loadMore()}
                  disabled={loading}
                  className="py-2 text-[13px] text-muted transition-colors hover:text-ink disabled:opacity-60"
                >
                  {loading ? '加载中…' : `加载更多回复（共 ${node.replyCount} 条）`}
                </button>
              )}
              {loading && loaded.length === 0 && <div className="py-2 text-[13px] text-muted">加载中…</div>}
              {!loading && fetched && loaded.length === 0 && (
                <div className="py-2 text-[13px] text-subtle">没有可显示的回复</div>
              )}
              {error && <div className="py-2 text-[13px] text-danger">{error}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Avatar, name, text and images of one post; shared with the parent chain. */
export function CommentBody({ node }: { node: CommentData }) {
  return (
    <div className="flex gap-3">
      {node.author.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={proxyAvatar(node.author.avatarUrl)}
          alt={node.author.name}
          className="h-9 w-9 shrink-0 rounded-full ring-1 ring-border/50"
        />
      ) : (
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[13px] font-bold text-muted">
          {node.author.name.charAt(0)}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-ink">{node.author.name}</span>
          <span className="text-sm text-subtle">@{node.author.handle}</span>
        </div>
        <TranslatedBody
          text={node.text}
          className="mt-1 text-sm text-ink"
          splitByParagraph={false}
          initialTranslations={node.initialTranslations}
        />
        {node.images.length > 0 && (
          <div className="max-w-[360px]">
            <XImageGrid images={node.images.map((src, i) => ({ src, alt: `评论图片 ${i + 1}` }))} />
          </div>
        )}
      </div>
    </div>
  );
}
