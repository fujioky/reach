// app/admin/(shell)/mirrors/[id]/page.tsx
// 内容详情页 — 以内容为中心，整合预览 + 分享管理 + 版本历史。
//
// 布局：
//   ① 面包屑 ← 内容管理
//   ② 内容信息卡（平台、源链接、抓取时间、操作按钮）
//      └─ ContentPreviewPanel（折叠展开：正文 + 媒体 + 评论）
//   ③ 分享管理区块（全部分享列表 + 新增分享按钮）
//   ④ 版本历史区块（VersionHistoryPanel：每行可展开查看快照）

import { notFound } from 'next/navigation';
import { eq, desc } from 'drizzle-orm';
import Link from 'next/link';
import { db, contentItems, media, comments, mirrorVersions, shares } from '@/lib/db';
import { ContentPreviewPanel } from '../_components/ContentPreviewPanel';
import { VersionHistoryPanel } from '../_components/VersionHistoryPanel';
import { MirrorPasswordPanel } from '../_components/MirrorPasswordPanel';
import { getSitePasswordHash, readPasswordMode } from '@/lib/content/password';
import { CopyLinkButton } from '../_components/CopyLinkButton';
import { CreateShareDialog } from '../_components/CreateShareDialog';
import { RefreshMirrorButton } from '../_components/RefreshMirrorButton';
import { RefreshTranscriptButton } from '../_components/RefreshTranscriptButton';
import { DeleteMirrorButton } from '../_components/DeleteMirrorButton';
import { EditAccessControlDialog } from '../../shares/_components/EditAccessControlDialog';
import { RevokeShareButton } from '../../shares/_components/RevokeShareButton';

// ── 状态标签 ──────────────────────────────────────────────────
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

function platformLabel(p: string | null | undefined) {
  if (p === 'x') return 'X / 推特';
  if (p === 'youtube') return 'YouTube';
  return p ?? '—';
}

function formatDate(d: Date | null | undefined) {
  if (!d) return '—';
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function accessSummary(s: typeof shares.$inferSelect): string {
  const parts: string[] = [];
  if (s.expiresAt) parts.push(`${s.expiresAt.toLocaleDateString('zh-CN')} 到期`);
  if (s.maxViews !== null) parts.push(`${s.viewCount}/${s.maxViews} 次`);
  if (s.maxUniqueVisitors !== null) parts.push(`${s.uniqueVisitorCount}/${s.maxUniqueVisitors} 人`);
  if (s.burnAfterRead) parts.push('阅后销毁');
  return parts.length ? parts.join(' · ') : '无限制';
}

export default async function ContentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // 并行查询所有数据
  const [[item], mediaRows, commentRows, mirrorVersionRows, shareRows] = await Promise.all([
    db.select().from(contentItems).where(eq(contentItems.id, id)).limit(1),
    db.select().from(media).where(eq(media.contentItemId, id)),
    db.select().from(comments).where(eq(comments.contentItemId, id)),
    db
      .select()
      .from(mirrorVersions)
      .where(eq(mirrorVersions.contentItemId, id))
      .orderBy(desc(mirrorVersions.versionNumber)),
    db
      .select()
      .from(shares)
      .where(eq(shares.contentItemId, id))
      .orderBy(desc(shares.createdAt)),
  ]);

  if (!item) notFound();

  return (
    <div className="flex flex-col gap-6">
      {/* ① 面包屑 */}
      <div className="flex items-center gap-2 text-sm text-muted">
        <Link href="/admin/mirrors" className="text-brand hover:text-brand-hover">
          内容管理
        </Link>
        <span>/</span>
        <span className="max-w-[320px] truncate text-ink">{item.title}</span>
      </div>

      {/* ② 内容信息卡 */}
      <div className="ds-card p-6">
        {/* 标题行 + 操作按钮 */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold leading-snug text-ink">{item.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
              {/* 平台徽章 */}
              <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted">
                {platformLabel(item.platform)}
              </span>
              {item.sourceUrl && (
                <a
                  href={item.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand hover:text-brand-hover"
                >
                  查看原文 ↗
                </a>
              )}
              <span>抓取于 {formatDate(item.fetchedAt)}</span>
              {item.refreshedAt && <span>最后刷新 {formatDate(item.refreshedAt)}</span>}
            </div>
          </div>

          {/* 操作：刷新 + 刷新字幕（仅含视频的镜像）+ 删除 */}
          <div className="flex flex-shrink-0 items-center gap-2">
            <RefreshMirrorButton mirrorId={id} />
            {mediaRows.some((m) => m.type === 'video') && (
              <RefreshTranscriptButton mirrorId={id} />
            )}
            <DeleteMirrorButton mirrorId={id} />
          </div>
        </div>

        {/* 统计摘要 */}
        <div className="mt-4 flex flex-wrap gap-4 text-xs text-subtle">
          <span>媒体 {mediaRows.length} 个</span>
          <span>评论 {commentRows.length} 条</span>
          <span>版本历史 {mirrorVersionRows.length} 个</span>
          <span>分享链接 {shareRows.length} 个</span>
        </div>

        {/* 内容预览（折叠，展开显示正文 + 媒体 + 评论）*/}
        <ContentPreviewPanel
          body={item.body}
          platform={item.platform}
          mediaRows={mediaRows.map((m) => ({
            id: m.id,
            type: m.type,
            originalUrl: m.originalUrl,
            blobUrl: m.blobUrl,
          }))}
          commentRows={commentRows.map((c) => ({
            id: c.id,
            author: c.author as { name: string; handle: string },
            text: c.text,
            likes: c.likes,
            postedAt: c.postedAt,
          }))}
        />
      </div>

      {/* ③ 分享管理 */}
      <div className="ds-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink">分享链接</h2>
          <CreateShareDialog contentItemId={id} />
        </div>

        {shareRows.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted">
            暂无分享链接，点击「新增分享」创建。
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse">
              <thead>
                <tr>
                  <th className="border-b border-border pb-2 text-left text-xs font-normal text-muted">
                    Token
                  </th>
                  <th className="border-b border-border pb-2 text-left text-xs font-normal text-muted">
                    状态
                  </th>
                  <th className="border-b border-border pb-2 text-left text-xs font-normal text-muted">
                    访问控制
                  </th>
                  <th className="border-b border-border pb-2 text-left text-xs font-normal text-muted">
                    访问量
                  </th>
                  <th className="border-b border-border pb-2 text-left text-xs font-normal text-muted">
                    创建时间
                  </th>
                  <th className="border-b border-border pb-2 text-left text-xs font-normal text-muted">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody>
                {shareRows.map((share) => (
                  <tr key={share.id}>
                    <td className="border-b border-border/60 py-3 pr-4 font-mono text-sm text-muted">
                      {share.token.slice(0, 8)}…
                    </td>
                    <td className="border-b border-border/60 py-3 pr-4">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                          STATUS_STYLES[share.status] ?? 'bg-surface-2 text-muted'
                        }`}
                      >
                        {STATUS_LABELS[share.status] ?? share.status}
                      </span>
                    </td>
                    <td className="border-b border-border/60 py-3 pr-4 text-sm text-muted">
                      {accessSummary(share)}
                    </td>
                    <td className="border-b border-border/60 py-3 pr-4 text-sm text-muted">
                      {share.viewCount} 次 / {share.uniqueVisitorCount} 访客
                    </td>
                    <td className="whitespace-nowrap border-b border-border/60 py-3 pr-4 text-sm text-muted">
                      {formatDate(share.createdAt)}
                    </td>
                    <td className="border-b border-border/60 py-3">
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
                          href={`/admin/analytics/content/${id}`}
                          className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[12px] text-muted transition-colors hover:bg-surface-2 hover:text-ink"
                          title="查看分析"
                        >
                          <svg
                            width="13"
                            height="13"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            aria-hidden="true"
                          >
                            <path d="M3 3v18h18M7 14l4-4 3 3 5-6" />
                          </svg>
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
          </div>
        )}
      </div>

      {/* ④ 访问密码 */}
      <MirrorPasswordPanel
        contentItemId={id}
        initialMode={readPasswordMode(item.passwordMode)}
        hasStoredPassword={Boolean(item.passwordHash)}
        sitePasswordConfigured={Boolean(await getSitePasswordHash())}
      />

      {/* ⑤ 版本历史 */}
      <div className="ds-card p-6">
        <h2 className="mb-4 text-lg font-semibold text-ink">版本历史</h2>
        <VersionHistoryPanel
          contentItemId={id}
          versions={mirrorVersionRows.map((v) => ({
            id: v.id,
            versionNumber: v.versionNumber,
            snapshot: v.snapshot,
            createdAt: v.createdAt,
          }))}
        />
      </div>
    </div>
  );
}
