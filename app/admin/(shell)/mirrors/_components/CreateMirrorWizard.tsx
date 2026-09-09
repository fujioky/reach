// app/admin/mirrors/_components/CreateMirrorWizard.tsx
// 创建镜像向导 — Reach 品牌风格（D-70~D-73 重设计）。
//
// Stepper: 粘贴链接 → 预览确认 → 访问控制
// 抓取预览卡 + 评论筛选 + 底部浮动确认面板。
// 客户端组件，调用 server actions。

'use client';

import { useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { FetchedContent, Comment, MediaItem } from '@/lib/fetcher/types';
import {
  previewMirror,
  createMirror,
  type PreviewResult,
  type CreateMirrorResult,
} from '../actions';
import { CopyLinkButton } from './CopyLinkButton';
import {
  AccessControlPanel,
  type AccessControlValues,
} from './AccessControlPanel';

const MB = 1024 * 1024;

// ── 错误文案 ──
function getErrorMessage(result: PreviewResult): string {
  switch (result.kind) {
    case 'rate_limited': return '请求太频繁，请稍后重试';
    case 'not_found':
    case 'empty_item': return '内容不存在或已删除';
    case 'auth_required': return '源站需要登录，暂无法抓取';
    case 'unsupported':
    case 'unsupported_platform': return '不支持的平台，仅支持 X/推特 或 YouTube 链接';
    case 'invalid_url': return result.error || '链接格式无效';
    default: return '抓取失败，请检查链接或稍后重试';
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MB) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * MB) return `${(bytes / MB).toFixed(1)} MB`;
  return `${(bytes / (1024 * MB)).toFixed(2)} GB`;
}

function collectAllCommentIds(comments: Comment[]): string[] {
  const ids: string[] = [];
  for (const c of comments) {
    ids.push(c.id);
    if (c.replies) for (const r of c.replies) ids.push(r.id);
  }
  return ids;
}

// ── Stepper ──
type Step = 1 | 2 | 3;

function Stepper({ current }: { current: Step }) {
  const steps = [
    { n: 1, label: '粘贴链接' },
    { n: 2, label: '预览确认' },
    { n: 3, label: '访问控制' },
  ];
  return (
    <div className="flex items-center gap-2">
      {steps.map((s, i) => {
        const done = s.n < current;
        const active = s.n === current;
        return (
          <div key={s.n} className="flex items-center gap-2">
            <div className="flex items-center gap-1.75">
              <div
                className={`flex h-[22px] w-[22px] items-center justify-center rounded-full text-xs font-bold ${
                  done || active
                    ? 'bg-brand text-white'
                    : 'border-1.5 border-border bg-surface text-subtle'
                }`}
              >
                {done ? '✓' : s.n}
              </div>
              <span className={`text-[13px] ${active || done ? 'font-semibold text-ink' : 'text-subtle'}`}>
                {s.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={`h-[1.5px] w-7 ${done ? 'bg-brand' : 'bg-border'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Props ──
interface CreateMirrorWizardProps {
  usedBytes: number;
  totalQuota: number;
}

export function CreateMirrorWizard({ usedBytes, totalQuota }: CreateMirrorWizardProps) {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [fetching, setFetching] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [content, setContent] = useState<FetchedContent | null>(null);
  const [selectedCommentIds, setSelectedCommentIds] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createWarnings, setCreateWarnings] = useState<string[]>([]);
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [accessControlValues, setAccessControlValues] = useState<AccessControlValues>({
    expiresAt: null, maxViews: null, maxUniqueVisitors: null, burnAfterRead: false,
  });

  const step: Step = content ? 2 : 1;

  // ── 抓取 ──
  const handleFetch = useCallback(async () => {
    if (!url.trim()) return;
    setFetching(true);
    setPreviewError(null);
    setContent(null);
    setSelectedCommentIds(new Set());
    const result = await previewMirror(url.trim());
    setFetching(false);
    if (!result.ok || !result.content) {
      setPreviewError(getErrorMessage(result));
      return;
    }
    setContent(result.content);
    setSelectedCommentIds(new Set(collectAllCommentIds(result.content.comments)));
  }, [url]);

  // ── 评论选择 ──
  const allCommentIds = useMemo(
    () => (content ? collectAllCommentIds(content.comments) : []),
    [content],
  );
  const allSelected = allCommentIds.length > 0 && allCommentIds.every((id) => selectedCommentIds.has(id));

  const toggleAll = useCallback(() => {
    setSelectedCommentIds(allSelected ? new Set() : new Set(allCommentIds));
  }, [allSelected, allCommentIds]);

  const toggleComment = useCallback((comment: Comment) => {
    const ids = [comment.id, ...(comment.replies?.map((r) => r.id) ?? [])];
    setSelectedCommentIds((prev) => {
      const next = new Set(prev);
      if (next.has(comment.id)) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  }, []);

  // ── 媒体统计 ──
  const imageCount = content?.media.filter((m) => m.type === 'image').length ?? 0;
  const videoCount = content?.media.filter((m) => m.type === 'video').length ?? 0;
  const estimatedSize = imageCount * 1.7; // 粗估 ~1.7MB/图

  // ── 配额警告 ──
  const usagePercent = (usedBytes / totalQuota) * 100;
  const quotaWarning = usagePercent > 100
    ? `已超出存储配额（${formatBytes(usedBytes)} / ${formatBytes(totalQuota)}）`
    : usagePercent >= 80
      ? `接近存储配额（${formatBytes(usedBytes)} / ${formatBytes(totalQuota)}）`
      : null;

  // ── 创建 ──
  const handleCreate = useCallback(async () => {
    if (!content || !url.trim()) return;
    setCreating(true);
    setCreateError(null);
    setCreateWarnings([]);
    const result: CreateMirrorResult = await createMirror({
      url: url.trim(),
      selectedCommentIds: Array.from(selectedCommentIds),
      accessControl: accessControlValues,
    });
    setCreating(false);
    if (!result.ok) {
      setCreateError(result.error ?? '创建失败');
      if (result.warnings.length > 0) setCreateWarnings(result.warnings);
      return;
    }
    if (result.warnings.length > 0) setCreateWarnings(result.warnings);
    setShareToken(result.shareToken ?? null);
  }, [content, url, selectedCommentIds, accessControlValues]);

  return (
    <div className="flex flex-col">
      {/* 标题 + Stepper */}
      <h1 className="font-display text-2xl font-bold tracking-tight text-ink">创建镜像</h1>
      <div className="mt-4">
        <Stepper current={step} />
      </div>

      {/* ── Step 1: URL 输入 ── */}
      <div className="mt-6 max-w-[470px]">
        <div className="flex gap-2">
          <input
            type="url"
            placeholder="粘贴 X/推特 或 YouTube 链接"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !fetching) handleFetch(); }}
            className="flex-1 rounded-md border border-border bg-surface px-4 py-3 text-sm text-ink outline-none transition-colors placeholder:text-subtle focus:border-brand"
            disabled={fetching}
            aria-label="帖子链接"
          />
          <button
            type="button"
            onClick={handleFetch}
            disabled={fetching || !url.trim()}
            className={`rounded-md px-5 py-3 text-sm font-semibold transition-colors ${
              fetching || !url.trim()
                ? 'bg-surface-2 text-subtle cursor-not-allowed'
                : 'bg-brand text-white hover:bg-brand-hover'
            }`}
          >
            {fetching ? '抓取中…' : '抓取'}
          </button>
        </div>
      </div>

      {/* ── 抓取错误 ── */}
      {previewError && (
        <div className="mt-4 max-w-[470px] rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500" role="alert">
          无法抓取该链接 — {previewError}
        </div>
      )}

      {/* ── Step 2: 预览 + 评论 + 底部浮动面板 ── */}
      {content && (
        <>
          <div className="mt-5 max-w-[470px]">
            {/* 抓取预览卡 */}
            <div className="ds-card p-[18px]">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-subtle">抓取预览</span>
                <span className="rounded-pill bg-success/15 px-2.5 py-0.5 text-[11px] text-success">抓取成功</span>
              </div>

              {/* 作者 */}
              <div className="mt-3.5 flex items-center gap-2.5">
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
                    {content.publishedAt && ` · ${new Date(content.publishedAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}`}
                  </div>
                </div>
              </div>

              {/* 正文 */}
              <div className="mt-3 text-[13px] leading-relaxed text-ink">{content.content}</div>

              {/* 媒体网格 */}
              {content.media.length > 0 && (
                <div className="mt-2.5 grid grid-cols-2 gap-1 overflow-hidden rounded-[10px]">
                  {content.media.slice(0, 4).map((item, idx) => (
                    <MediaThumb key={idx} item={item} />
                  ))}
                </div>
              )}
            </div>

            {/* 保留评论卡 */}
            {content.comments.length > 0 && (
              <div className="mt-4 ds-card p-4">
                <div className="mb-2.5 flex items-center justify-between">
                  <span className="text-[13px] font-semibold text-ink">保留评论</span>
                  <button type="button" onClick={toggleAll} className="text-[11px] text-subtle hover:text-muted">
                    已选 {selectedCommentIds.size} / {allCommentIds.length} · {allSelected ? '取消全选' : '全选'}
                  </button>
                </div>
                {content.comments.map((comment) => (
                  <CommentRow
                    key={comment.id}
                    comment={comment}
                    checked={selectedCommentIds.has(comment.id)}
                    onToggle={() => toggleComment(comment)}
                  />
                ))}
              </div>
            )}

            {/* 访问控制 */}
            <div className="mt-4">
              <AccessControlPanel onChange={setAccessControlValues} />
            </div>

            {/* 配额警告 */}
            {quotaWarning && (
              <div className="mt-4 rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-muted">
                {quotaWarning}
              </div>
            )}

            {/* 创建错误 */}
            {createError && (
              <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500" role="alert">
                {createError}
              </div>
            )}

            {/* 创建警告 */}
            {createWarnings.length > 0 && (
              <div className="mt-4 rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-muted">
                <div className="mb-1 font-semibold">警告：</div>
                {createWarnings.map((w, i) => <div key={i}>{w}</div>)}
              </div>
            )}
          </div>

          {/* 底部浮动确认面板 */}
          <div className="sticky bottom-0 mt-6 max-w-[330px] self-end rounded-t-[18px] border border-b-0 border-border bg-surface pb-5 pt-3 shadow-[0_-10px_40px_rgba(23,22,27,0.16)]">
            {/* 拖拽指示器 */}
            <div className="mx-auto mb-1 h-1 w-[38px] rounded-pill bg-border" />
            <div className="px-5">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-bold text-ink">媒体落地 · 确认创建</span>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-subtle">
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </div>
              <div className="mt-3.5 flex items-center justify-between text-[13px] text-muted">
                <span>{imageCount > 0 ? `${imageCount} 张图片` : '无图片'}{videoCount > 0 && ` · ${videoCount} 个视频`}</span>
                <span className="font-semibold text-ink">~{estimatedSize.toFixed(1)} MB</span>
              </div>
              <div className="my-4 h-px bg-border" />
              <button
                type="button"
                onClick={handleCreate}
                disabled={creating}
                className={`w-full rounded-[10px] py-3 text-center text-sm font-semibold transition-colors ${
                  creating
                    ? 'bg-surface-2 text-subtle cursor-not-allowed'
                    : 'bg-brand text-white shadow-[0_4px_14px_rgba(91,79,233,0.3)] hover:bg-brand-hover'
                }`}
              >
                {creating ? '创建中…' : '确认创建镜像 →'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── 成功弹窗 ── */}
      {shareToken && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" role="dialog" aria-modal="true" aria-label="分享链接">
          <div className="w-[90%] max-w-md rounded-lg bg-surface p-6 shadow-lg">
            <h2 className="font-display text-xl font-bold text-ink">镜像创建成功</h2>
            <p className="mt-3 text-sm text-muted">复制下面的链接分享给朋友（免登录查看）：</p>
            <div className="mt-3 break-all rounded-md border border-border bg-surface-2 px-4 py-3 font-mono text-sm text-ink">
              {typeof window !== 'undefined' ? `${window.location.origin}/s/${shareToken}` : `/s/${shareToken}`}
            </div>
            <div className="mt-4 flex justify-end gap-3">
              <CopyLinkButton token={shareToken} />
              <button
                type="button"
                onClick={() => { setShareToken(null); router.push('/admin/mirrors'); }}
                className="rounded-md bg-brand px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-hover"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 媒体缩略图 ──
function MediaThumb({ item }: { item: MediaItem }) {
  if (item.type === 'image') {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={item.originalUrl} alt="媒体" className="aspect-[16/10] w-full object-cover" />;
  }
  return (
    <div className="flex aspect-[16/10] w-full items-center justify-center bg-surface-2 text-xs text-subtle">
      视频
    </div>
  );
}

// ── 评论行 ──
function CommentRow({ comment, checked, onToggle }: { comment: Comment; checked: boolean; onToggle: () => void }) {
  return (
    <div>
      <div className="flex items-start gap-2.25 border-t border-border py-2">
        {/* 复选框 */}
        <button
          type="button"
          onClick={onToggle}
          className={`mt-0.5 flex h-[17px] w-[17px] flex-shrink-0 items-center justify-center rounded-[5px] transition-colors ${
            checked ? 'bg-brand' : 'border-1.5 border-border'
          }`}
          aria-label={`选择评论: ${comment.author.name}`}
        >
          {checked && (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          )}
        </button>

        <div className="min-w-0 flex-1">
          <div className="text-xs leading-relaxed text-ink">
            <b>{comment.author.name}</b> <span className="text-subtle">@{comment.author.handle}</span>
          </div>
          <div className="mt-0.5 text-xs leading-relaxed text-ink">{comment.content}</div>
        </div>
      </div>

      {/* 回复（跟随父评论选中状态） */}
      {comment.replies?.map((reply) => (
        <div key={reply.id} className={`flex items-start gap-2.25 py-2 pl-10 ${checked ? '' : 'opacity-50'}`}>
          {reply.author.avatarUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={reply.author.avatarUrl} alt={reply.author.name} className="h-[24px] w-[24px] flex-shrink-0 rounded-full" />
          )}
          <div className="min-w-0 flex-1">
            <div className="text-xs leading-relaxed text-ink">
              <b>{reply.author.name}</b> <span className="text-subtle">@{reply.author.handle}</span>
            </div>
            <div className="mt-0.5 text-xs leading-relaxed text-muted">{reply.content}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
