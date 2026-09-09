// app/admin/(shell)/mirrors/_components/ContentRow.tsx
// 内容管理列表行 — 可展开，行内显示分享列表 + 操作。
// 'use client' — 管理展开/收起状态。数据由 RSC 父级预取后通过 props 传入。

'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { CopyLinkButton } from './CopyLinkButton';
import { RefreshMirrorButton } from './RefreshMirrorButton';
import { DeleteMirrorButton } from './DeleteMirrorButton';
import { EditAccessControlDialog } from '../../shares/_components/EditAccessControlDialog';
import { RevokeShareButton } from '../../shares/_components/RevokeShareButton';

// ── 状态标签 ─────────────────────────────────────────────────
// Matches system-wide pill style used in dashboard + share management.
const STATUS_STYLES: Record<string, string> = {
  active: 'bg-success/15 text-success',
  expired: 'bg-surface-2 text-muted',
  revoked: 'bg-danger/15 text-danger',
  burned: 'bg-[#ff6f00]/15 text-[#ff6f00]',
  max_views: 'bg-surface-2 text-muted',
  max_visitors: 'bg-surface-2 text-muted',
};
const STATUS_LABELS: Record<string, string> = {
  active: '有效',
  expired: '已过期',
  revoked: '已撤销',
  burned: '已销毁',
  max_views: '超次数',
  max_visitors: '超访客',
};

function accessSummary(share: ShareRow): string {
  const parts: string[] = [];
  if (share.expiresAt) parts.push(`${new Date(share.expiresAt).toLocaleDateString('zh-CN')} 到期`);
  if (share.maxViews !== null) parts.push(`${share.viewCount}/${share.maxViews} 次`);
  if (share.maxUniqueVisitors !== null) parts.push(`${share.uniqueVisitorCount}/${share.maxUniqueVisitors} 人`);
  if (share.burnAfterRead) parts.push('阅后销毁');
  return parts.length ? parts.join(' · ') : '无限制';
}

// ── 类型 ──────────────────────────────────────────────────────
export interface ShareRow {
  id: string;
  token: string;
  status: string;
  expiresAt: Date | null;
  maxViews: number | null;
  maxUniqueVisitors: number | null;
  burnAfterRead: boolean;
  viewCount: number;
  uniqueVisitorCount: number;
  createdAt: Date;
}

export interface ContentRowProps {
  mirror: {
    id: string;
    title: string;
    platform: string | null;
    createdAt: Date;
  };
  shares: ShareRow[];
  platformLabel: string;
}

// ── 分析链接图标 ──────────────────────────────────────────────
const ChartIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M3 3v18h18M7 14l4-4 3 3 5-6" />
  </svg>
);

// ── 主组件 ───────────────────────────────────────────────────
export function ContentRow({ mirror, shares, platformLabel }: ContentRowProps) {
  const [expanded, setExpanded] = useState(false);

  const toggle = useCallback(() => setExpanded((p) => !p), []);

  return (
    <>
      {/* ── 主行 ── */}
      <tr
        className="cursor-pointer bg-surface transition-colors hover:bg-surface-2"
        onClick={toggle}
        aria-expanded={expanded}
      >
        {/* 展开箭头 */}
        <td className="w-8 border-b border-border px-2 py-3 text-subtle">
          <svg
            width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" aria-hidden="true"
            className={`transition-transform ${expanded ? 'rotate-90' : ''}`}
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
        </td>
        {/* 标题 */}
        <td className="max-w-[280px] border-b border-border px-2 py-3">
          <div className="truncate text-sm font-medium text-ink">{mirror.title}</div>
          <div className="mt-0.5 text-xs text-muted">{platformLabel}</div>
        </td>
        {/* 分享数 */}
        <td className="border-b border-border px-2 py-3 text-sm text-muted">
          {shares.length > 0 ? (
            <span>
              {shares.filter(s => s.status === 'active').length} 有效
              {shares.length > 1 && ` / ${shares.length} 个`}
            </span>
          ) : (
            <span className="text-subtle">无分享</span>
          )}
        </td>
        {/* 创建时间 */}
        <td className="whitespace-nowrap border-b border-border px-2 py-3 text-sm text-muted">
          {mirror.createdAt.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
        </td>
        {/* 操作 — 阻止冒泡，避免触发行展开 */}
        <td className="border-b border-border px-2 py-3" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-2">
            <Link
              href={`/admin/mirrors/${mirror.id}`}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[12px] text-muted transition-colors hover:bg-surface-2 hover:text-ink"
              title="查看详情"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              详情
            </Link>
            <RefreshMirrorButton mirrorId={mirror.id} />
            <DeleteMirrorButton mirrorId={mirror.id} />
          </div>
        </td>
      </tr>

      {/* ── 展开区：分享列表 ── */}
      {expanded && (
        <tr className="bg-paper">
          <td colSpan={5} className="border-b border-border p-0">
            <div className="px-8 py-4">
              {shares.length === 0 ? (
                <div className="py-3 text-sm text-muted">
                  暂无分享链接。
                  <Link href={`/admin/mirrors/${mirror.id}`} className="ml-2 text-brand hover:text-brand-hover">
                    进入详情页创建分享 →
                  </Link>
                </div>
              ) : (
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className="border-b border-border pb-2 text-left font-normal text-xs text-muted">Token</th>
                      <th className="border-b border-border pb-2 text-left font-normal text-xs text-muted">状态</th>
                      <th className="border-b border-border pb-2 text-left font-normal text-xs text-muted">访问控制</th>
                      <th className="border-b border-border pb-2 text-left font-normal text-xs text-muted">访问</th>
                      <th className="border-b border-border pb-2 text-left font-normal text-xs text-muted">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shares.map((share) => (
                      <tr key={share.id}>
                        <td className="border-b border-border/50 py-2 pr-4 font-mono text-xs text-muted">
                          {share.token.slice(0, 8)}…
                        </td>
                        <td className="border-b border-border/50 py-2 pr-4">
                          <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[share.status] ?? 'bg-surface-2 text-muted'}`}>
                            {STATUS_LABELS[share.status] ?? share.status}
                          </span>
                        </td>
                        <td className="border-b border-border/50 py-2 pr-4 text-xs text-muted">
                          {accessSummary(share)}
                        </td>
                        <td className="border-b border-border/50 py-2 pr-4 text-xs text-muted">
                          {share.viewCount} 次 / {share.uniqueVisitorCount} 访客
                        </td>
                        <td className="border-b border-border/50 py-2">
                          <div className="flex items-center gap-2">
                            <CopyLinkButton token={share.token} compact />
                            <EditAccessControlDialog
                              shareId={share.id}
                              expiresAt={share.expiresAt}
                              maxViews={share.maxViews}
                              maxUniqueVisitors={share.maxUniqueVisitors}
                              burnAfterRead={share.burnAfterRead}
                              compact
                            />
                            <Link
                              href={`/admin/analytics/content/${mirror.id}`}
                              className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[12px] text-muted transition-colors hover:bg-surface-2 hover:text-ink"
                              title="查看分析"
                            >
                              <ChartIcon />
                              分析
                            </Link>
                            {share.status === 'active' && (
                              <RevokeShareButton shareId={share.id} compact />
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {/* 新增分享入口 */}
              <div className="mt-3 border-t border-border/50 pt-3">
                <Link
                  href={`/admin/mirrors/${mirror.id}`}
                  className="text-xs text-brand hover:text-brand-hover"
                >
                  + 新增分享 / 管理版本
                </Link>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
