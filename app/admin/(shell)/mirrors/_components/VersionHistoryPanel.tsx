// app/admin/(shell)/mirrors/_components/VersionHistoryPanel.tsx
// 版本历史面板 — 列出所有版本，每行可展开查看该版本快照的正文/媒体/评论预览。
// 点「查看」展开内联快照；点「回滚」调用 rollbackMirror server action。

'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { rollbackMirror } from '../actions';

// 版本快照结构（与 lib/mirror/versioning.ts 中写入的 snapshot 对应）
interface VersionSnapshot {
  contentItem: {
    title?: string;
    body?: string;
    platform?: string;
    author?: { name: string; handle: string };
    publishedAt?: string | null;
  };
  media?: Array<{
    type: string;
    originalUrl: string;
    blobUrl?: string | null;
  }>;
  comments?: Array<{
    id: string;
    author: { name: string; handle: string };
    text: string;
    likes?: number | null;
  }>;
}

interface MirrorVersion {
  id: string;
  versionNumber: number;
  snapshot: unknown;
  createdAt: Date;
}

function formatDate(d: Date) {
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function SnapshotPreview({ snapshot }: { snapshot: VersionSnapshot }) {
  const { contentItem, media = [], comments = [] } = snapshot;
  const images = media.filter((m) => m.type === 'image');
  const videos = media.filter((m) => m.type === 'video');

  return (
    <div className="flex flex-col gap-4 ds-card-2 p-4">
      {/* 作者 + 发布时间 */}
      {contentItem.author && (
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand/15 text-[11px] font-bold text-brand">
            {contentItem.author.name.charAt(0)}
          </div>
          <div>
            <span className="text-[13px] font-semibold text-ink">{contentItem.author.name}</span>
            <span className="ml-1.5 text-[12px] text-subtle">@{contentItem.author.handle}</span>
          </div>
          {contentItem.publishedAt && (
            <span className="ml-auto text-[11px] text-subtle">
              {new Date(contentItem.publishedAt).toLocaleDateString('zh-CN')}
            </span>
          )}
        </div>
      )}

      {/* 正文 */}
      {contentItem.body && (
        <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink line-clamp-6">
          {contentItem.body}
        </div>
      )}

      {/* 媒体 */}
      {(images.length > 0 || videos.length > 0) && (
        <div className="flex flex-wrap gap-2">
          {images.map((img, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={img.blobUrl ?? img.originalUrl}
              alt="媒体图片"
              className="h-20 w-20 rounded-md object-cover"
              loading="lazy"
            />
          ))}
          {videos.map((_, i) => (
            <div
              key={i}
              className="flex h-20 w-36 items-center justify-center rounded-md bg-surface text-xs text-subtle"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="mr-1 text-muted"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="9" />
                <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none" />
              </svg>
              视频
            </div>
          ))}
        </div>
      )}

      {/* 评论摘要 */}
      {comments.length > 0 && (
        <div className="text-[12px] text-subtle">
          {comments.length} 条评论 · {comments[0]?.author.name}：{comments[0]?.text?.slice(0, 40)}{comments[0]?.text && comments[0].text.length > 40 ? '…' : ''}
        </div>
      )}
    </div>
  );
}

function VersionRow({
  version,
  isLatest,
  contentItemId,
}: {
  version: MirrorVersion;
  isLatest: boolean;
  contentItemId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleRollback = useCallback(async () => {
    setRolling(true);
    setError(null);
    const result = await rollbackMirror(contentItemId, version.versionNumber);
    setRolling(false);
    if (!result.ok) {
      setError(result.error ?? '回滚失败');
      return;
    }
    router.refresh();
  }, [contentItemId, version.versionNumber, router]);

  const snapshot = version.snapshot as VersionSnapshot;

  return (
    <div className="border-b border-border last:border-0">
      {/* 行主体 */}
      <div className="flex items-center gap-3 px-2 py-2.5">
        {/* 版本号 */}
        <div className="flex items-center gap-2 min-w-[60px]">
          <span className="text-sm font-medium text-ink">v{version.versionNumber}</span>
          {isLatest && (
            <span className="rounded-full bg-brand/10 px-1.5 py-0.5 text-[10px] font-semibold text-brand">
              当前
            </span>
          )}
        </div>

        {/* 创建时间 */}
        <span className="flex-1 whitespace-nowrap text-sm text-muted">
          {formatDate(version.createdAt)}
        </span>

        {/* 操作 */}
        <div className="flex items-center gap-2">
          {/* 查看快照 */}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[12px] text-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            {expanded ? '收起' : '查看'}
          </button>

          {/* 回滚（仅非当前版本） */}
          {!isLatest && (
            error ? (
              <span className="text-[12px] text-danger">{error}</span>
            ) : (
              <button
                type="button"
                onClick={handleRollback}
                disabled={rolling}
                className={`inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[12px] text-muted transition-colors ${
                  rolling ? 'cursor-wait opacity-60' : 'hover:bg-surface-2 hover:text-ink'
                }`}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className={rolling ? 'animate-spin' : ''}
                  aria-hidden="true"
                >
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                </svg>
                {rolling ? '回滚中…' : '回滚'}
              </button>
            )
          )}
        </div>
      </div>

      {/* 展开的快照预览 */}
      {expanded && (
        <div className="px-2 pb-3">
          <SnapshotPreview snapshot={snapshot} />
        </div>
      )}
    </div>
  );
}

interface VersionHistoryPanelProps {
  contentItemId: string;
  versions: MirrorVersion[];
}

export function VersionHistoryPanel({ contentItemId, versions }: VersionHistoryPanelProps) {
  const latestVersionNumber = versions[0]?.versionNumber ?? null;

  if (versions.length === 0) {
    return (
      <div className="py-4 text-sm text-muted">
        暂无历史版本。刷新镜像且内容有实质变化时会创建新版本。
      </div>
    );
  }

  return (
    <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
      {versions.map((v) => (
        <VersionRow
          key={v.id}
          version={v}
          isLatest={v.versionNumber === latestVersionNumber}
          contentItemId={contentItemId}
        />
      ))}
    </div>
  );
}
