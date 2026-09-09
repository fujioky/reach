// app/admin/(shell)/mirrors/_components/ContentPreviewPanel.tsx
// 内容预览面板 — 在内容详情页内联展示当前版本的正文、媒体和评论。
// 'use client' — 管理展开/收起状态。

'use client';

import { useState } from 'react';

interface MediaRow {
  id: string;
  type: string | null;
  originalUrl: string;
  blobUrl: string | null;
}

interface CommentRow {
  id: string;
  author: { name: string; handle: string };
  text: string;
  likes: number | null;
  postedAt: Date | null;
}

interface ContentPreviewPanelProps {
  body: string;
  platform: string | null | undefined;
  mediaRows: MediaRow[];
  commentRows: CommentRow[];
}

export function ContentPreviewPanel({
  body,
  platform,
  mediaRows,
  commentRows,
}: ContentPreviewPanelProps) {
  const [open, setOpen] = useState(false);

  const images = mediaRows.filter((m) => m.type === 'image');
  const videos = mediaRows.filter((m) => m.type === 'video');

  return (
    <div className="mt-4 border-t border-border pt-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="text-sm font-medium text-ink">内容预览</span>
        <span className="flex items-center gap-1.5 text-xs text-muted">
          {open ? '收起' : '展开预览'}
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
            aria-hidden="true"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </span>
      </button>

      {open && (
        <div className="mt-4 flex flex-col gap-5">
          {/* 正文 */}
          <div>
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-subtle">
              {platform === 'youtube' ? '视频描述' : '正文'}
            </div>
            <div className="whitespace-pre-wrap rounded-lg bg-surface-2 px-4 py-3 text-[13px] leading-relaxed text-ink">
              {body || <span className="text-subtle italic">（无正文）</span>}
            </div>
          </div>

          {/* 媒体 */}
          {(images.length > 0 || videos.length > 0) && (
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-subtle">
                媒体 {mediaRows.length} 个
              </div>
              <div className="flex flex-wrap gap-2">
                {images.map((img) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={img.id}
                    src={img.blobUrl ?? img.originalUrl}
                    alt="媒体图片"
                    className="h-24 w-24 rounded-lg object-cover"
                    loading="lazy"
                  />
                ))}
                {videos.map((vid) => (
                  // Native <video> preview — muted + preload="metadata" shows
                  // first frame without autoplay or extra network cost.
                  <video
                    key={vid.id}
                    src={vid.blobUrl ?? vid.originalUrl}
                    className="h-24 w-40 rounded-lg object-cover bg-black"
                    muted
                    preload="metadata"
                    playsInline
                    controls
                  />
                ))}
              </div>
            </div>
          )}

          {/* 评论 */}
          {commentRows.length > 0 && (
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-subtle">
                评论 {commentRows.length} 条
              </div>
              <div className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border">
                {commentRows.slice(0, 10).map((c) => (
                  <div key={c.id} className="flex items-start gap-2.5 px-3.5 py-2.5">
                    <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-surface-2 text-[11px] font-bold text-muted">
                      {c.author.name.charAt(0)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-[12px]">
                        <span className="font-semibold text-ink">{c.author.name}</span>
                        <span className="text-subtle">@{c.author.handle}</span>
                        {c.likes != null && c.likes > 0 && (
                          <span className="ml-auto text-subtle">👍 {c.likes}</span>
                        )}
                      </div>
                      <div className="mt-0.5 text-[12px] leading-relaxed text-muted">{c.text}</div>
                    </div>
                  </div>
                ))}
                {commentRows.length > 10 && (
                  <div className="px-3.5 py-2 text-[12px] text-subtle">
                    还有 {commentRows.length - 10} 条评论…
                  </div>
                )}
              </div>
            </div>
          )}

          {commentRows.length === 0 && mediaRows.length === 0 && (
            <div className="text-[13px] text-subtle">无媒体和评论</div>
          )}
        </div>
      )}
    </div>
  );
}
