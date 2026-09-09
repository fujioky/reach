// app/admin/(shell)/page.tsx
// Dashboard — 业务概览与流量分析融为一体的唯一总览页。
//
// 结构：代理告警 → 统计卡（镜像/分享/本周访问/总打开）→ 30 日趋势 + 设备
// 分布 → Top 内容 + 访问来源 → 最近访问（可回放）→ 最近镜像 + 存储用量。
// 原 /admin/analytics 已并入此页并 redirect 至此；深度页面（访问记录、
// 单内容分析、会话回放）保持独立 URL，面包屑指回这里。

import Link from 'next/link';
import { AdminPageHeader } from '@/app/_components/admin/AdminPageHeader';
import { LIMITS, getStorageUsage } from '@/lib/quota';
import { db, contentItems, shares } from '@/lib/db';
import { desc, eq, count, sql } from 'drizzle-orm';
import { getAllSettings } from '@/lib/settings';
import {
  getViewsBetween,
  startOfWeek,
  daysAgo,
  getOverviewStats,
  getOverviewOutlinkClicks,
  getOverviewMediaInteractions,
  getOverviewDailyViews,
  getDeviceBreakdown,
  getReferrerBreakdown,
  getTopContents,
  listRecentSessions,
} from '@/lib/analytics/queries';
import { SessionListRow } from './analytics/_components/SessionListRow';

const MB = 1024 * 1024;

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 KB';
  const mbValue = bytes / MB;
  if (mbValue < 1) return `${(bytes / 1024).toFixed(0)} KB`;
  if (mbValue < 1024) return `${mbValue.toFixed(1)} MB`;
  return `${(mbValue / 1024).toFixed(2)} GB`;
}

/** Format ISO timestamp to a human-readable relative or absolute label. */
function formatErrorTime(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    const diffMs = Date.now() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return '刚刚';
    if (diffMin < 60) return `${diffMin} 分钟前`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH} 小时前`;
    return d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return isoStr;
  }
}

/** Tiny inline sparkline (pure SVG, no library) */
function Sparkline({ data }: { data: { day: string; views: number }[] }) {
  if (data.length < 2) return <span className="text-[11px] text-subtle">暂无趋势数据</span>;
  const max = Math.max(...data.map((d) => d.views), 1);
  const w = 200;
  const h = 40;
  const step = w / (data.length - 1);
  const pts = data.map((d, i) => `${i * step},${h - (d.views / max) * (h - 4)}`).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="w-full overflow-visible" preserveAspectRatio="none">
      <polyline
        points={pts}
        fill="none"
        stroke="var(--color-brand)"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default async function DashboardPage() {
  const weekStart = startOfWeek();
  const twoWeeksAgo = daysAgo(14);

  const [
    usedBytes,
    activeMirrorsResult,
    activeSharesResult,
    recentItems,
    settings,
    thisWeek,
    lastWeek,
    overview,
    outlinkClicks,
    mediaInteractions,
    dailyViews,
    deviceBreakdown,
    referrers,
    topContents,
    recentSessions,
  ] = await Promise.all([
    getStorageUsage(),
    db
      .select({ count: count() })
      .from(contentItems)
      .where(sql`${contentItems.type} IS DISTINCT FROM 'article'`),
    db.select({ count: count() }).from(shares).where(eq(shares.status, 'active')),
    db
      .select({
        id: contentItems.id,
        title: contentItems.title,
        platform: contentItems.platform,
        fetchedAt: contentItems.fetchedAt,
      })
      .from(contentItems)
      .where(sql`${contentItems.type} IS DISTINCT FROM 'article'`)
      .orderBy(desc(contentItems.fetchedAt))
      .limit(5),
    getAllSettings(),
    getViewsBetween(weekStart),
    getViewsBetween(twoWeeksAgo, weekStart),
    getOverviewStats(),
    getOverviewOutlinkClicks(),
    getOverviewMediaInteractions(),
    getOverviewDailyViews(30),
    getDeviceBreakdown(),
    getReferrerBreakdown(8),
    getTopContents(8),
    listRecentSessions(15),
  ]);

  const quotaMB = LIMITS.totalQuota / MB;
  const percentage = (usedBytes / LIMITS.totalQuota) * 100;
  const barWidth = Math.min(percentage, 100);

  const activeMirrors = activeMirrorsResult[0]?.count ?? 0;
  const activeShares = activeSharesResult[0]?.count ?? 0;
  const deviceTotal = deviceBreakdown.reduce((sum, d) => sum + d.sessions, 0) || 1;

  const today = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });

  // 代理告警：proxy_error_at 有值说明最近发生了封禁
  const proxyError = settings.proxy_error_at ? {
    detail: settings.proxy_last_error,
    at: settings.proxy_error_at,
    usingExternal: !!settings.video_proxy_url,
  } : null;

  const statusLabel = proxyError ? '⚠ 代理异常' : '一切正常';

  const weekDiff = lastWeek.views > 0
    ? ((thisWeek.views - lastWeek.views) / lastWeek.views) * 100
    : 0;

  return (
    <div className="flex flex-col gap-4">
      {/* ── 代理告警横幅 ── */}
      {proxyError && (
        <div className="flex items-start gap-3 rounded-lg border border-[#f59e0b]/40 bg-[#fffbeb] px-4 py-3.5">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2" className="mt-0.5 flex-shrink-0" aria-hidden="true">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <div className="flex-1">
            <div className="text-[13px] font-semibold text-[#92400e]">
              视频代理检测到封禁信号
              <span className="ml-2 text-[11px] font-normal text-[#a16207]">
                {formatErrorTime(proxyError.at)}
              </span>
            </div>
            <div className="mt-0.5 text-[12px] text-[#a16207]">
              {proxyError.detail || '上游返回 403/429，Google 可能正在限制当前 IP'}
            </div>
            <div className="mt-2 flex items-center gap-3">
              <Link
                href="/admin/settings"
                className="rounded-md bg-[#d97706] px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-[#b45309]"
              >
                去切换代理
              </Link>
              <span className="text-[11px] text-[#a16207]">
                当前：{proxyError.usingExternal ? settings.video_proxy_url : 'Vercel 函数（默认）'}
              </span>
            </div>
          </div>
        </div>
      )}

      <AdminPageHeader
        label="概览"
        title="Dashboard"
        description={`${today} · ${statusLabel} · 自建分析：点击热图与会话回放`}
        actions={
          <Link href="/admin/mirrors/new" className="ds-btn-primary flex items-center gap-1.5 text-[13px]">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            创建镜像
          </Link>
        }
      />

      {/* 统计卡片 — 业务 + 流量 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="ds-card p-[18px]">
          <div className="text-xs font-medium text-subtle">活跃镜像</div>
          <div className="mt-1.5 font-display text-[28px] font-bold leading-none text-ink">
            {activeMirrors}
          </div>
          <div className="mt-0.5 text-[11px] text-subtle">{activeShares} 个有效分享</div>
        </div>
        <div className="ds-card p-[18px]">
          <div className="text-xs font-medium text-subtle">本周访问</div>
          <div className="mt-1.5 font-display text-[28px] font-bold leading-none text-ink">
            {thisWeek.views.toLocaleString()}
          </div>
          <div className={`mt-0.5 text-[11px] ${weekDiff >= 0 ? 'text-success' : 'text-danger'}`}>
            {weekDiff >= 0 ? '+' : ''}{weekDiff.toFixed(0)}% 较上周 · {thisWeek.visitors.toLocaleString()} 访客
          </div>
        </div>
        <div className="ds-card p-[18px]">
          <div className="text-xs font-medium text-subtle">总打开</div>
          <div className="mt-1.5 font-display text-[28px] font-bold leading-none text-ink">
            {overview.totalViews.toLocaleString()}
          </div>
          <div className="mt-0.5 text-[11px] text-subtle">
            {overview.uniqueVisitors.toLocaleString()} 独立访客
          </div>
        </div>
        <div className="ds-card p-[18px]">
          <div className="text-xs font-medium text-subtle">互动</div>
          <div className="mt-1.5 font-display text-[28px] font-bold leading-none text-ink">
            {(outlinkClicks + mediaInteractions).toLocaleString()}
          </div>
          <div className="mt-0.5 text-[11px] text-subtle">
            外链 {outlinkClicks.toLocaleString()} · 媒体 {mediaInteractions.toLocaleString()}
          </div>
        </div>
      </div>

      {/* 近 30 日趋势 + 设备分布 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="ds-card p-5">
          <div className="mb-3 text-[13px] font-semibold text-ink">近 30 日访问趋势</div>
          {dailyViews.length === 0 ? (
            <div className="py-4 text-center text-[12px] text-subtle">暂无数据</div>
          ) : (
            <div className="flex flex-col gap-2">
              <Sparkline data={dailyViews} />
              <div className="flex justify-between text-[10px] text-subtle">
                <span>{dailyViews[0]?.day?.slice(5)}</span>
                <span>{dailyViews[dailyViews.length - 1]?.day?.slice(5)}</span>
              </div>
            </div>
          )}
        </div>

        <div className="ds-card p-5">
          <div className="mb-3 text-[13px] font-semibold text-ink">设备分布（按会话视口）</div>
          {deviceBreakdown.length === 0 ? (
            <div className="py-4 text-center text-[12px] text-subtle">暂无数据</div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {deviceBreakdown.map(({ device, sessions }) => (
                <div key={device} className="flex items-center gap-2">
                  <div className="w-20 text-[12px] text-muted">{device}</div>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className="h-full rounded-full bg-brand"
                      style={{ width: `${(sessions / deviceTotal) * 100}%` }}
                    />
                  </div>
                  <div className="w-10 text-right text-[11px] text-subtle">{sessions}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Top 内容 + Top 来源 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="overflow-hidden ds-card">
          <div className="border-b border-border px-[18px] py-3.5 text-[13px] font-semibold text-ink">
            访问最多的内容
          </div>
          {topContents.length === 0 ? (
            <div className="px-[18px] py-8 text-center text-[13px] text-subtle">暂无数据</div>
          ) : (
            topContents.map((item, i) => {
              const inner = (
                <>
                  <span className="w-5 text-right text-[11px] text-subtle">{i + 1}</span>
                  <span
                    className={`rounded-pill px-1.5 py-0.5 text-[10px] ${
                      item.type === 'article'
                        ? 'bg-brand/10 text-brand'
                        : 'bg-surface-2 text-muted'
                    }`}
                  >
                    {item.type === 'article' ? '文章' : '镜像'}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{item.title}</span>
                  <span className="whitespace-nowrap text-[11px] text-subtle">{item.visitors} 访客</span>
                  <span className="whitespace-nowrap rounded-full bg-brand/10 px-2 py-0.5 text-[11px] text-brand">
                    {item.views} 次
                  </span>
                </>
              );
              return item.contentItemId ? (
                <Link
                  key={item.contentItemId}
                  href={`/admin/analytics/content/${item.contentItemId}`}
                  className="flex items-center gap-2.5 border-b border-border px-[18px] py-3 transition-colors last:border-b-0 hover:bg-surface-2"
                >
                  {inner}
                </Link>
              ) : (
                <div key={i} className="flex items-center gap-2.5 border-b border-border px-[18px] py-3 last:border-b-0">
                  {inner}
                </div>
              );
            })
          )}
        </div>

        <div className="overflow-hidden ds-card">
          <div className="border-b border-border px-[18px] py-3.5 text-[13px] font-semibold text-ink">
            访问来源 Top
          </div>
          {referrers.length === 0 ? (
            <div className="px-[18px] py-8 text-center text-[13px] text-subtle">暂无数据</div>
          ) : (
            referrers.map((ref, i) => (
              <div
                key={i}
                className="flex items-center gap-3 border-b border-border px-[18px] py-3 last:border-b-0"
              >
                <span className="w-5 text-right text-[11px] text-subtle">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{ref.hostname}</span>
                <span className="whitespace-nowrap rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-subtle">
                  {ref.sessions} 次
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 最近访问 — 真实 IP + 地域 + 设备 + 屏幕尺寸 + 时长，可回放 */}
      <div className="overflow-hidden ds-card">
        <div className="flex items-center justify-between border-b border-border px-[18px] py-3.5">
          <span className="text-[13px] font-semibold text-ink">最近访问</span>
          <Link href="/admin/analytics/sessions" className="text-[12px] text-muted hover:text-brand">
            全部记录（可筛选）→
          </Link>
        </div>
        {recentSessions.length === 0 ? (
          <div className="px-[18px] py-8 text-center text-[13px] text-subtle">
            暂无会话记录 · 访客打开页面后这里会出现完整的行为录制
          </div>
        ) : (
          recentSessions.map((s) => <SessionListRow key={s.id} s={s} />)
        )}
      </div>

      {/* 最近镜像 + 存储用量 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="overflow-hidden ds-card">
          <div className="border-b border-border px-[18px] py-3.5 text-sm font-semibold text-ink">
            最近镜像
          </div>
          {recentItems.length === 0 ? (
            <div className="px-[18px] py-8 text-center text-sm text-subtle">
              还没有镜像，点击「创建镜像」开始
            </div>
          ) : (
            recentItems.map((item) => {
              const isYouTube = item.platform === 'youtube';
              const platformColor = isYouTube ? '#ff0000' : '#1d9bf0';
              const platformLabel = isYouTube ? 'YouTube' : 'X';
              const dateLabel = item.fetchedAt
                ? item.fetchedAt.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
                : '';

              return (
                <Link
                  key={item.id}
                  href={`/admin/mirrors/${item.id}`}
                  className="flex items-center gap-3 border-b border-border px-[18px] py-3 transition-colors last:border-b-0 hover:bg-surface-2"
                >
                  <span
                    className="h-2 w-2 flex-shrink-0 rounded-pill"
                    style={{ backgroundColor: platformColor }}
                  />
                  <div className="min-w-0 flex-1 truncate text-[13px] text-ink">
                    {item.title || '(无标题)'}
                  </div>
                  <span className="whitespace-nowrap text-xs text-subtle">{platformLabel} · {dateLabel}</span>
                  <span className="whitespace-nowrap rounded-pill bg-success/15 px-2.5 py-0.5 text-[11px] text-success">
                    有效
                  </span>
                </Link>
              );
            })
          )}
        </div>

        <div className="ds-card h-fit p-5">
          <div className="flex items-center justify-between">
            <div className="text-[15px] font-semibold text-ink">存储用量</div>
            <div className="text-[13px] text-muted">
              已用 <b className="text-ink">{formatBytes(usedBytes)}</b> / {quotaMB.toFixed(0)} MB ·{' '}
              {percentage.toFixed(1)}%
            </div>
          </div>
          <div className="mt-3 h-2.5 w-full overflow-hidden rounded-pill bg-surface-2">
            <div
              className="h-full rounded-pill bg-gradient-to-r from-brand to-brand-dark transition-all duration-300"
              style={{ width: `${barWidth}%` }}
            />
          </div>
          <div className="mt-2 text-[11px] text-subtle">
            仅创建镜像时落地媒体 · 超 80% 将提醒
          </div>
        </div>
      </div>
    </div>
  );
}
