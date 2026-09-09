// app/admin/(shell)/mirrors/[id]/refresh/[previewId]/_components/RefreshPreview.tsx
// Client component for the refresh preview page: diff visualization, comment
// selection, and apply/discard actions.

'use client';

import { useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import type { FetchedContent, Comment, MediaItem } from '@/lib/fetcher/types';
import { applyRefreshAction, discardRefreshAction } from '../../../../actions';

interface RefreshPreviewProps {
  mirrorId: string;
  previewId: string;
  currentContent: FetchedContent;
  newContent: FetchedContent;
}

function collectAllCommentIds(comments: Comment[]): string[] {
  const ids: string[] = [];
  for (const c of comments) {
    ids.push(c.id);
    if (c.replies) for (const r of c.replies) ids.push(r.id);
  }
  return ids;
}

function MediaThumb({ item }: { item: MediaItem }) {
  if (item.type === 'image') {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={item.originalUrl} alt="媒体" className="aspect-[16/10] w-full rounded-md object-cover" />
    );
  }
  // Video: use native <video> element with the direct URL for preview.
  // muted + preload="metadata" gives a first-frame poster without autoplay.
  const videoUrl = (item as { blobUrl?: string | null }).blobUrl ?? item.originalUrl;
  return (
    <video
      src={videoUrl}
      className="aspect-[16/10] w-full rounded-md object-cover bg-black"
      muted
      preload="metadata"
      playsInline
      controls
    />
  );
}

function CommentRow({
  comment,
  checked,
  onToggle,
}: {
  comment: Comment;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-start gap-2.5 border-t border-border py-2">
      <button
        type="button"
        onClick={onToggle}
        className={`mt-0.5 flex h-[17px] w-[17px] flex-shrink-0 items-center justify-center rounded-[5px] transition-colors ${
          checked ? 'bg-brand' : 'border-[1.5px] border-border'
        }`}
        aria-checked={checked}
        role="checkbox"
      >
        {checked && (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[12px]">
          <span className="font-semibold text-ink">{comment.author.name}</span>
          <span className="text-subtle">@{comment.author.handle}</span>
        </div>
        <div className="mt-0.5 text-[12px] leading-relaxed text-muted">{comment.content}</div>
      </div>
    </div>
  );
}

function ContentCard({
  title,
  content,
  highlight,
}: {
  title: string;
  content: FetchedContent;
  highlight?: boolean;
}) {
  return (
    <div className={`rounded-lg border bg-surface p-[18px] ${highlight ? 'border-brand' : 'border-border'}`}>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-subtle">{title}</span>
        {highlight && <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[11px] text-brand">新版本</span>}
      </div>

      <div className="flex items-center gap-2.5">
        {content.author.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={content.author.avatarUrl} alt={content.author.name} className="h-[38px] w-[38px] rounded-full" />
        ) : (
          <div className="flex h-[38px] w-[38px] items-center justify-center rounded-full bg-gradient-to-br from-brand to-brand-dark text-sm font-bold text-white">
            {content.author.name.charAt(0)}
          </div>
        )}
        <div>
          <div className="text-[13px] font-bold text-ink">
            {content.author.name} <span className="font-normal text-muted">@{content.author.handle}</span>
          </div>
          <div className="text-[11px] text-subtle">
            {content.platform === 'youtube' ? 'YouTube' : 'X / Twitter'}
            {content.publishedAt && ` · ${new Date(content.publishedAt).toLocaleDateString('zh-CN')}`}
          </div>
        </div>
      </div>

      <div className="mt-3 whitespace-pre-wrap text-[13px] leading-relaxed text-ink">{content.content}</div>

      {content.media.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-1 overflow-hidden rounded-[10px]">
          {content.media.slice(0, 4).map((item, idx) => (
            <MediaThumb key={idx} item={item} />
          ))}
        </div>
      )}

      <div className="mt-3 flex gap-3 text-[11px] text-subtle">
        <span>👍 {content.stats.likes}</span>
        <span>💬 {content.stats.comments}</span>
        <span>🔄 {content.stats.reposts}</span>
        <span>👁 {content.stats.views}</span>
      </div>
    </div>
  );
}

export function RefreshPreview({
  mirrorId,
  previewId,
  currentContent,
  newContent,
}: RefreshPreviewProps) {
  const router = useRouter();
  const [selectedCommentIds, setSelectedCommentIds] = useState<Set<string>>(
    () => new Set(collectAllCommentIds(newContent.comments)),
  );
  const [applying, setApplying] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allCommentIds = useMemo(() => collectAllCommentIds(newContent.comments), [newContent.comments]);
  const allSelected = selectedCommentIds.size === allCommentIds.length && allCommentIds.length > 0;

  const toggleComment = useCallback((id: string) => {
    setSelectedCommentIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelectedCommentIds(allSelected ? new Set() : new Set(allCommentIds));
  }, [allSelected, allCommentIds]);

  const bodyChanged = currentContent.body !== newContent.body;
  const titleChanged = currentContent.title !== newContent.title;
  const mediaChanged =
    JSON.stringify(currentContent.media.map((m) => ({ type: m.type, url: m.originalUrl })).sort()) !==
    JSON.stringify(newContent.media.map((m) => ({ type: m.type, url: m.originalUrl })).sort());

  const handleApply = useCallback(async () => {
    setApplying(true);
    setError(null);
    const result = await applyRefreshAction({
      mirrorId,
      previewId,
      selectedCommentIds: Array.from(selectedCommentIds),
    });
    setApplying(false);
    if (!result.ok) {
      setError(result.error ?? '应用失败');
      return;
    }
    router.push(`/admin/mirrors/${mirrorId}`);
    router.refresh();
  }, [mirrorId, previewId, selectedCommentIds, router]);

  const handleDiscard = useCallback(async () => {
    setDiscarding(true);
    setError(null);
    const result = await discardRefreshAction(mirrorId, previewId);
    setDiscarding(false);
    if (!result.ok) {
      setError(result.error ?? '放弃失败');
      return;
    }
    router.push(`/admin/mirrors/${mirrorId}`);
    router.refresh();
  }, [mirrorId, previewId, router]);

  return (
    <div className="flex flex-col gap-5">
      {/* Diff summary */}
      <div className="ds-card p-4">
        <div className="text-[13px] font-semibold text-ink">变化摘要</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {titleChanged && <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] text-warning">标题变更</span>}
          {bodyChanged && <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] text-warning">正文变更</span>}
          {mediaChanged && <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] text-warning">媒体变更</span>}
          {!titleChanged && !bodyChanged && !mediaChanged && (
            <span className="text-[12px] text-subtle">内容主体未变化，仅可能评论或统计数据有变化</span>
          )}
        </div>
      </div>

      {/* Side-by-side comparison */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ContentCard title="当前版本" content={currentContent} />
        <ContentCard title="新版本" content={newContent} highlight />
      </div>

      {/* Comment selection */}
      {newContent.comments.length > 0 && (
        <div className="ds-card p-4">
          <div className="mb-2.5 flex items-center justify-between">
            <span className="text-[13px] font-semibold text-ink">保留评论（新版本）</span>
            <button
              type="button"
              onClick={toggleAll}
              className="text-[11px] text-subtle hover:text-muted"
            >
              已选 {selectedCommentIds.size} / {allCommentIds.length} · {allSelected ? '取消全选' : '全选'}
            </button>
          </div>
          {newContent.comments.map((comment) => (
            <CommentRow
              key={comment.id}
              comment={comment}
              checked={selectedCommentIds.has(comment.id)}
              onToggle={() => toggleComment(comment.id)}
            />
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger" role="alert">
          {error}
        </div>
      )}

      {/* Actions */}
      <div className="sticky bottom-0 mt-2 rounded-t-[18px] border border-b-0 border-border bg-surface px-5 pb-5 pt-3 shadow-[0_-10px_40px_rgba(23,22,27,0.16)]">
        <div className="mx-auto mb-1 h-1 w-[38px] rounded-full bg-border" />
        <div className="flex items-center justify-between">
          <div className="text-[13px] text-subtle">
            应用后当前版本会保存为历史版本，可随时回滚。
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDiscard}
              disabled={discarding || applying}
              className="rounded-md border border-border bg-surface px-4 py-2 text-[13px] text-muted transition-colors hover:bg-surface-2 disabled:opacity-60"
            >
              {discarding ? '放弃中…' : '放弃'}
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={applying || discarding}
              className="rounded-md bg-brand px-4 py-2 text-[13px] font-semibold text-white shadow-brand transition-colors hover:bg-brand-hover disabled:cursor-wait disabled:opacity-60"
            >
              {applying ? '应用中…' : '应用新版本'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
