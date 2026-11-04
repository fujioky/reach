'use client';

// app/s/[token]/_components/CommentListClient.tsx
// Comments laid out like X's conversation view. Translation is controlled
// globally by PageTranslationShell — no local toggle here.
//
// Each top-level comment starts a group; its replies (at any depth) follow in
// thread order at one indent level, avatars joined by a line, with 「回复 @…」
// where a reply answers someone other than the post right above it — no
// staircase of ever-deeper indents. A group shows the comment and its first
// reply; 「展开更多回复」 shows the rest. Where X reports replies the mirror has
// not stored, 「查看 N 条回复」 loads them (/api/x-thread), which also saves
// them for later visitors.

import { useMemo, useState } from 'react';
import type { ThreadNode } from '@/lib/mirror/thread-view';
import { TranslatedBody } from './TranslatedBody';
import { XImageGrid } from './XImageGrid';
import { proxyAvatar } from './proxy-avatar';

export type CommentData = ThreadNode;

interface CommentListClientProps {
  comments: CommentData[];
  /** Share token; set on X pages, where more replies can be loaded on demand. */
  token?: string;
}

export function CommentListClient({ comments: initial, token }: CommentListClientProps) {
  const [nodes, setNodes] = useState(initial);

  const { roots, children, byId } = useMemo(() => {
    const ids = new Map(nodes.map((n) => [n.id, n]));
    const childMap = new Map<string, CommentData[]>();
    const top: CommentData[] = [];
    for (const node of nodes) {
      if (node.inReplyTo && ids.has(node.inReplyTo)) {
        childMap.set(node.inReplyTo, [...(childMap.get(node.inReplyTo) ?? []), node]);
      } else {
        top.push(node);
      }
    }
    return { roots: top, children: childMap, byId: ids };
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
      {roots.map((root, index) => (
        <div key={root.id} className={index < roots.length - 1 ? 'border-b border-border/60' : ''}>
          <Conversation root={root} childMap={children} byId={byId} token={token} onLoaded={merge} />
        </div>
      ))}
    </div>
  );
}

/** Replies under `id`, depth first: each reply followed by its own replies. */
function descendants(id: string, childMap: Map<string, CommentData[]>): CommentData[] {
  return (childMap.get(id) ?? []).flatMap((child) => [child, ...descendants(child.id, childMap)]);
}

function Conversation({
  root,
  childMap,
  byId,
  token,
  onLoaded,
}: {
  root: CommentData;
  childMap: Map<string, CommentData[]>;
  byId: Map<string, CommentData>;
  token?: string;
  onLoaded: (nodes: CommentData[]) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [fetched, setFetched] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const thread = descendants(root.id, childMap);
  const shown = [root, ...(expanded ? thread : thread.slice(0, 1))];
  const hidden = thread.length - (shown.length - 1);

  async function load(id: string) {
    if (!token) return;
    setLoadingId(id);
    setError(null);
    try {
      const res = await fetch('/api/x-thread', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, id, direction: 'replies' }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; nodes?: CommentData[] } | null;
      if (res.status === 429) throw new Error('操作太频繁，请稍后再试');
      if (!res.ok || !data?.ok) throw new Error('加载失败，请稍后再试');
      onLoaded(data.nodes ?? []);
      setExpanded(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setFetched((current) => new Set(current).add(id));
      setLoadingId(null);
    }
  }

  return (
    <div className="py-4">
      {shown.map((node, i) => {
        const previous = shown[i - 1];
        const parent = node.inReplyTo ? byId.get(node.inReplyTo) : undefined;
        const stored = childMap.get(node.id)?.length ?? 0;
        // X reports replies the mirror has none of yet: offer to load them.
        const unloaded = token && !fetched.has(node.id) && stored === 0 ? node.replyCount : 0;
        return (
          <div key={node.id} className={i > 0 ? 'pt-3' : ''}>
            <CommentBody
              node={node}
              threadLine={i < shown.length - 1}
              replyingTo={i > 0 && parent && parent.id !== previous?.id ? parent.author.handle : undefined}
            >
              {unloaded > 0 && (
                <button
                  type="button"
                  onClick={() => void load(node.id)}
                  disabled={loadingId !== null}
                  className="mt-1.5 inline-flex items-center gap-1.5 text-[13px] font-medium text-brand transition-colors hover:text-brand-hover disabled:opacity-60"
                >
                  {loadingId === node.id && <Spinner />}
                  {loadingId === node.id ? '正在加载回复…' : `查看 ${unloaded} 条回复`}
                </button>
              )}
            </CommentBody>
          </div>
        );
      })}

      {(hidden > 0 || (expanded && thread.length > 1) || error) && (
        <div className="ml-12 flex flex-wrap items-center gap-x-4">
          {hidden > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="mt-2 text-[13px] font-medium text-brand transition-colors hover:text-brand-hover"
            >
              展开更多回复（还有 {hidden} 条）
            </button>
          )}
          {expanded && thread.length > 1 && (
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="mt-2 text-[13px] text-muted transition-colors hover:text-ink"
            >
              收起回复
            </button>
          )}
          {error && <span className="mt-2 text-[13px] text-danger">{error}</span>}
        </div>
      )}
    </div>
  );
}

export function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent"
    />
  );
}

/**
 * Avatar, name, text and images of one post; shared with the parent chain.
 * `threadLine` draws the conversation line from the avatar down to the next
 * post; `replyingTo` labels a reply that answers someone other than the post
 * right above it.
 */
export function CommentBody({
  node,
  threadLine = false,
  replyingTo,
  children,
}: {
  node: CommentData;
  threadLine?: boolean;
  replyingTo?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <div className="relative flex shrink-0 flex-col items-center">
        {node.author.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={proxyAvatar(node.author.avatarUrl)}
            alt={node.author.name}
            className="h-9 w-9 rounded-full ring-1 ring-border/50"
          />
        ) : (
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 text-[13px] font-bold text-muted">
            {node.author.name.charAt(0)}
          </div>
        )}
        {threadLine && <span aria-hidden="true" className="-mb-3 mt-1 w-0.5 flex-1 rounded-full bg-border" />}
      </div>
      <div className="min-w-0 flex-1 pb-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-semibold text-ink">{node.author.name}</span>
          <span className="text-sm text-subtle">@{node.author.handle}</span>
        </div>
        {replyingTo && <div className="text-[12px] text-subtle">回复 @{replyingTo}</div>}
        <TranslatedBody
          text={node.text}
          className="mt-1 text-sm text-ink"
          splitByParagraph={false}
          initialTranslations={node.initialTranslations}
        />
        {node.images.length > 0 && (
          <div className="max-w-[420px]">
            <XImageGrid images={node.images.map((src, i) => ({ src, alt: `评论图片 ${i + 1}` }))} />
          </div>
        )}
        <ThreadVideos srcs={node.videos} className="mt-2 max-w-[420px]" />
        {children}
      </div>
    </div>
  );
}

/** Videos of a thread post, played through the share's video route. */
export function ThreadVideos({ srcs, className = '' }: { srcs: string[]; className?: string }) {
  if (srcs.length === 0) return null;
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {srcs.map((src) => (
        <video
          key={src}
          src={src}
          controls
          playsInline
          preload="metadata"
          className="max-h-[480px] w-full rounded-xl bg-black ring-1 ring-border/50"
        />
      ))}
    </div>
  );
}
