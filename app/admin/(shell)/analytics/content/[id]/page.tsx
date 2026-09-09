// app/admin/(shell)/analytics/content/[id]/page.tsx
// 内容级分析详情 — 镜像与文章通用（取代旧的按 share 详情页）。
//
// 区块：
//   1. 面包屑 + 标题（类型徽章 + 打开原页链接 + 热图入口）
//   2. 指标卡片（总打开 / 独立访客 / 平均停留 / 外链点击）
//   3. 近 30 日趋势 + 设备分布
//   4. 访问时段分布（按小时）
//   5. 区块停留热图 + 滚动深度漏斗
//   6. 视频观看分析（播放/暂停/拖动/全屏 + 进度漏斗 + 暂停位置）
//   7. 点击目标 Top + 媒体互动 + 外链点击
//   8. 会话列表（真实 IP、设备、屏幕尺寸、时长 → 回放）

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { AdminPageHeader } from '@/app/_components/admin/AdminPageHeader';
import { db, contentItems, shares } from '@/lib/db';
import {
  getContentStats,
  getContentDailyViews,
  getContentHourlyViews,
  getContentAvgDuration,
  getContentOutlinkClickCount,
  getBlockDwellTimes,
  getMediaInteractions,
  getOutlinkClicks,
  getDeviceBreakdown,
  getVideoStats,
  getVideoProgressFunnel,
  getVideoPausePoints,
  getScrollDepthFunnel,
  getTopClickTargets,
  listContentSessions,
} from '@/lib/analytics/queries';
import { ViewsLineChart } from '../../_components/ViewsLineChart';
import { MediaBarChart } from '../../_components/MediaBarChart';
import { OutlinkBarChart } from '../../_components/OutlinkBarChart';
import { BlockHeatmap } from '../../_components/BlockHeatmap';
import { classifyUA, shortUA, formatTs, formatDuration, visitorLabel } from '../../_components/format';

function Sparkline({ data }: { data: { day: string; views: number }[] }) {
  if (data.length < 2) return <span className="text-[11px] text-subtle">暂无趋势数据</span>;
  const max = Math.max(...data.map((d) => d.views), 1);
  const w = 260; const h = 44;
  const step = w / (data.length - 1);
  const pts = data.map((d, i) => `${i * step},${h - (d.views / max) * (h - 6)}`).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="w-full overflow-visible">
      <polyline points={pts} fill="none" stroke="var(--color-brand)" strokeWidth="1.5"
        strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** 横向漏斗条：进度/滚动深度共用 */
function Funnel({ data, unit }: { data: { pct: number; sessions: number }[]; unit: string }) {
  const max = Math.max(...data.map((d) => d.sessions), 1);
  return (
    <div className="flex flex-col gap-1.5">
      {data.map(({ pct, sessions }) => (
        <div key={pct} className="flex items-center gap-2">
          <div className="w-12 text-right text-[11px] text-subtle">{pct}%</div>
          <div className="h-3.5 flex-1 overflow-hidden rounded-sm bg-surface-2">
            <div
              className="h-full rounded-sm bg-brand/80"
              style={{ width: `${(sessions / max) * 100}%` }}
            />
          </div>
          <div className="w-14 text-[11px] text-subtle">{sessions} {unit}</div>
        </div>
      ))}
    </div>
  );
}

interface DetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function ContentAnalyticsPage({ params }: DetailPageProps) {
  const { id } = await params;

  const [item] = await db
    .select({
      id: contentItems.id,
      title: contentItems.title,
      type: contentItems.type,
      slug: contentItems.slug,
      platform: contentItems.platform,
    })
    .from(contentItems)
    .where(eq(contentItems.id, id))
    .limit(1);
  if (!item) notFound();

  const isArticle = item.type === 'article';

  const [
    stats,
    avgDurationMs,
    outlinkCount,
    dailyViews,
    hourlyViews,
    deviceBreakdown,
    blockDwell,
    scrollFunnel,
    videoStats,
    videoFunnel,
    pausePoints,
    clickTargets,
    mediaData,
    outlinkData,
    sessions,
    shareRows,
  ] = await Promise.all([
    getContentStats(id),
    getContentAvgDuration(id),
    getContentOutlinkClickCount(id),
    getContentDailyViews(id),
    getContentHourlyViews(id),
    getDeviceBreakdown(id),
    getBlockDwellTimes(id),
    getScrollDepthFunnel(id),
    getVideoStats(id),
    getVideoProgressFunnel(id),
    getVideoPausePoints(id),
    getTopClickTargets(id),
    getMediaInteractions(id),
    getOutlinkClicks(id),
    listContentSessions(id, 30),
    db.select({ token: shares.token }).from(shares).where(eq(shares.contentItemId, id)).limit(1),
  ]);

  const publicUrl = isArticle
    ? item.slug ? `/p/${item.slug}` : null
    : shareRows[0]?.token ? `/s/${shareRows[0].token}` : null;

  const deviceTotal = deviceBreakdown.reduce((sum, d) => sum + d.sessions, 0) || 1;
  const hasVideo = videoStats.plays > 0 || videoFunnel.some((f) => f.sessions > 0);

  // 暂停位置聚合到 10 段（视频时长归一化）
  const pauseBuckets = Array.from({ length: 10 }, (_, i) => ({ pct: i * 10, count: 0 }));
  for (const p of pausePoints) {
    if (p.duration && p.duration > 0) {
      const bucket = Math.min(9, Math.floor((p.position / p.duration) * 10));
      pauseBuckets[bucket].count += 1;
    }
  }
  const hasPauses = pauseBuckets.some((b) => b.count > 0);
  const maxPause = Math.max(...pauseBuckets.map((b) => b.count), 1);

  return (
    <div className="flex flex-col gap-6">
      {/* 面包屑 */}
      <div className="flex items-center gap-2 text-[12px] text-muted">
        <Link href="/admin" className="hover:text-brand">Dashboard</Link>
        <span>/</span>
        <span className="text-ink">{isArticle ? '文章' : '镜像'}详情</span>
      </div>

      <AdminPageHeader
        label="分析"
        title={item.title}
        description={`${isArticle ? '文章' : `镜像 · ${item.platform ?? ''}`}${publicUrl ? ` · ${publicUrl}` : ''}`}
        actions={
          <div className="flex items-center gap-2">
            {publicUrl && (
              <a
                href={publicUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-md border border-border bg-surface px-3 py-1.5 text-[12px] text-muted transition-colors hover:bg-surface-2 hover:text-ink"
              >
                打开页面
              </a>
            )}
            <Link
              href={`/admin/analytics/content/${id}/heatmap`}
              className="ds-btn-primary flex items-center gap-1.5 text-[13px]"
            >
              🔥 点击热图
            </Link>
          </div>
        }
      />

      {/* 指标卡片 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: '总打开', value: stats.totalViews.toLocaleString() },
          { label: '独立访客', value: stats.uniqueVisitors.toLocaleString() },
          { label: '平均停留', value: formatDuration(avgDurationMs) },
          { label: '外链点击', value: outlinkCount.toLocaleString() },
        ].map(({ label, value }) => (
          <div key={label} className="ds-card p-[18px]">
            <div className="text-xs font-medium text-subtle">{label}</div>
            <div className="mt-1.5 font-display text-[28px] font-bold leading-none text-ink">{value}</div>
          </div>
        ))}
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
              {deviceBreakdown.map(({ device, sessions: n }) => (
                <div key={device} className="flex items-center gap-2">
                  <div className="w-20 text-[12px] text-muted">{device}</div>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full rounded-full bg-brand" style={{ width: `${(n / deviceTotal) * 100}%` }} />
                  </div>
                  <div className="w-10 text-right text-[11px] text-subtle">{n}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 访问时段分布 */}
      <div>
        <div className="mb-3 text-[13px] font-semibold text-ink">访问时段分布（按小时）</div>
        {hourlyViews.length === 0 ? (
          <div className="rounded-lg border border-border py-8 text-center text-[13px] text-subtle">
            暂无浏览数据
          </div>
        ) : (
          <ViewsLineChart data={hourlyViews} />
        )}
      </div>

      {/* 区块停留 + 滚动深度 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="ds-card p-5">
          <div className="mb-3 text-[13px] font-semibold text-ink">区块停留热图（访客都在看哪里）</div>
          <BlockHeatmap blocks={blockDwell} />
        </div>
        <div className="ds-card p-5">
          <div className="mb-3 text-[13px] font-semibold text-ink">滚动深度（读到页面多深）</div>
          {scrollFunnel.every((f) => f.sessions === 0) ? (
            <div className="py-4 text-center text-[12px] text-subtle">暂无滚动数据</div>
          ) : (
            <Funnel data={scrollFunnel} unit="人" />
          )}
        </div>
      </div>

      {/* 视频观看分析 */}
      {hasVideo && (
        <div className="ds-card p-5">
          <div className="mb-4 text-[13px] font-semibold text-ink">视频观看分析</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {[
              { label: '播放', value: videoStats.plays },
              { label: '暂停', value: videoStats.pauses },
              { label: '拖动进度', value: videoStats.seeks },
              { label: '进入全屏', value: videoStats.fullscreens },
              { label: '看完', value: videoStats.completions },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-lg bg-surface-2 px-3 py-2.5">
                <div className="text-[11px] text-subtle">{label}</div>
                <div className="font-display text-[20px] font-bold text-ink">{value}</div>
              </div>
            ))}
          </div>
          <div className="mt-5 grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div>
              <div className="mb-2 text-[12px] font-medium text-muted">观看进度漏斗（看到哪个进度）</div>
              <Funnel data={videoFunnel} unit="人" />
            </div>
            <div>
              <div className="mb-2 text-[12px] font-medium text-muted">暂停位置分布（在哪里暂停）</div>
              {!hasPauses ? (
                <div className="py-4 text-center text-[12px] text-subtle">暂无暂停记录</div>
              ) : (
                <div className="flex h-28 items-end gap-1">
                  {pauseBuckets.map(({ pct, count }) => (
                    <div key={pct} className="flex flex-1 flex-col items-center gap-1">
                      <div
                        className="w-full rounded-t-sm bg-brand/70"
                        style={{ height: `${(count / maxPause) * 88}px`, minHeight: count > 0 ? 3 : 0 }}
                        title={`${pct}–${pct + 10}%：暂停 ${count} 次`}
                      />
                      <div className="text-[9px] text-subtle">{pct}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 点击目标 Top */}
      <div className="overflow-hidden ds-card">
        <div className="border-b border-border px-[18px] py-3.5 text-[13px] font-semibold text-ink">
          点击最多的元素
        </div>
        {clickTargets.length === 0 ? (
          <div className="px-[18px] py-8 text-center text-[13px] text-subtle">暂无点击数据</div>
        ) : (
          clickTargets.map((t, i) => (
            <div key={i} className="flex items-center gap-3 border-b border-border px-[18px] py-2.5 last:border-b-0">
              <span className="w-5 text-right text-[11px] text-subtle">{i + 1}</span>
              <code className="max-w-[45%] truncate rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted">
                {t.selector}
              </code>
              <span className="flex-1 truncate text-[12px] text-ink">{t.text || '—'}</span>
              <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[11px] text-brand">
                {t.clicks} 次
              </span>
            </div>
          ))
        )}
      </div>

      {/* 媒体互动 + 外链点击 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <div className="mb-3 text-[13px] font-semibold text-ink">媒体互动</div>
          {mediaData.length === 0 ? (
            <div className="rounded-lg border border-border py-8 text-center text-[13px] text-subtle">
              暂无媒体互动数据
            </div>
          ) : (
            <MediaBarChart data={mediaData} />
          )}
        </div>
        <div>
          <div className="mb-3 text-[13px] font-semibold text-ink">外链点击</div>
          {outlinkData.length === 0 ? (
            <div className="rounded-lg border border-border py-8 text-center text-[13px] text-subtle">
              暂无外链数据
            </div>
          ) : (
            <OutlinkBarChart data={outlinkData} />
          )}
        </div>
      </div>

      {/* 会话列表 */}
      <div className="overflow-hidden ds-card">
        <div className="border-b border-border px-[18px] py-3.5 text-[13px] font-semibold text-ink">
          访问会话（最近 {sessions.length} 次）
        </div>
        {sessions.length === 0 ? (
          <div className="px-[18px] py-8 text-center text-[13px] text-subtle">
            暂无会话 · 新访客打开页面后会出现完整行为录制
          </div>
        ) : (
          sessions.map((s) => {
            const { label, icon } = classifyUA(s.ua);
            return (
              <Link
                key={s.id}
                href={`/admin/analytics/session/${s.id}`}
                className="flex items-center gap-3 border-b border-border px-[18px] py-2.5 transition-colors last:border-b-0 hover:bg-surface-2"
              >
                <div className="w-32 flex-shrink-0">
                  <div className="truncate font-mono text-[13px] font-medium text-ink">
                    {visitorLabel(s.ip)}
                  </div>
                </div>
                <div className="flex min-w-0 items-center gap-2 text-[12px] text-muted" title={label}>
                  <span className="text-[14px]">{icon}</span>
                  <span className="truncate">{shortUA(s.ua)}</span>
                  {s.viewportW && s.viewportH && (
                    <span className="whitespace-nowrap text-subtle">{s.viewportW}×{s.viewportH}</span>
                  )}
                </div>
                <div className="flex-1" />
                <span className="text-[11px] text-subtle">{s.eventCount} 事件</span>
                <span className="text-[11px] text-subtle">{formatDuration(s.durationMs)}</span>
                <span className="whitespace-nowrap text-[11px] text-subtle">{formatTs(s.startedAt)}</span>
                <span className="rounded-pill bg-brand/10 px-2 py-0.5 text-[11px] text-brand">
                  {s.chunkCount > 0 ? '▶ 回放' : '无录制'}
                </span>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
