// app/admin/(shell)/analytics/session/[id]/page.tsx
// 会话回放详情 — 单次访问的完整记录：rrweb 播放器 + 结构化事件时间线。
//
// 头部展示会话上下文：真实 IP、设备（UA 解析）、屏幕/视口尺寸、语言、
// 来源、开始时间与停留时长。时间线把点击（含坐标与元素）、滚动深度、
// 视频动作（播放/暂停/拖动/全屏）按时间排开，配合回放定位行为。

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AdminPageHeader } from '@/app/_components/admin/AdminPageHeader';
import { getSessionWithContent, getSessionTimeline } from '@/lib/analytics/queries';
import { classifyUA, shortUA, formatTs, formatDuration, visitorLabel, geoLabel } from '../../_components/format';
import { SessionPlayer } from './_components/SessionPlayer';
import { VideoTimeline } from './_components/VideoTimeline';
import { HeatmapViewer } from '../../_components/HeatmapViewer';
import type { VisitEventPayload } from '@/lib/db/schema';

const VIDEO_ACTION_LABELS: Record<string, string> = {
  play: '▶ 播放视频',
  pause: '⏸ 暂停视频',
  seek: '⏩ 拖动进度',
  progress: '📊 观看进度',
  fullscreen_enter: '⛶ 进入全屏',
  fullscreen_exit: '🗗 退出全屏',
  ended: '✅ 看完视频',
  ratechange: '⚡ 调整倍速',
};

function fmtPos(s?: number): string {
  if (s == null || !Number.isFinite(s)) return '';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function describeEvent(type: string, payload: VisitEventPayload | null): string {
  const p = payload ?? {};
  switch (type) {
    case 'view':
      return '👀 打开页面';
    case 'click':
      return `🖱 点击 ${p.text ? `「${p.text.slice(0, 40)}」` : ''} ${p.selector ?? ''}（${p.x}, ${p.y}）`;
    case 'scroll':
      return `📜 滚动到 ${p.depthPct}% 深度`;
    case 'dwell':
      return `⏱ 停留「${p.blockId}」${((p.dwellMs ?? 0) / 1000).toFixed(1)}s`;
    case 'media_click':
      return `🖼 点击媒体 ${p.mediaType ?? ''}`;
    case 'outlink_click':
      return `🔗 点击外链 ${p.url ?? ''}`;
    case 'video': {
      const base = VIDEO_ACTION_LABELS[p.action ?? ''] ?? `视频 ${p.action}`;
      if (p.action === 'seek') return `${base} ${fmtPos(p.from)} → ${fmtPos(p.to)}`;
      if (p.action === 'progress') return `${base} ${p.pct}%（${fmtPos(p.position)}）`;
      if (p.position != null) return `${base} @ ${fmtPos(p.position)}`;
      return base;
    }
    default:
      return type;
  }
}

interface SessionPageProps {
  params: Promise<{ id: string }>;
}

export default async function SessionReplayPage({ params }: SessionPageProps) {
  const { id } = await params;
  const session = await getSessionWithContent(id);
  if (!session) notFound();

  const timeline = await getSessionTimeline(id);
  const { label, icon } = classifyUA(session.ua);
  const startMs = session.startedAt.getTime();

  // 本次访问自己的点击点 — 快照热图数据源
  const ownClicks = timeline
    .filter((e) => e.type === 'click' && e.payload?.x != null && e.payload?.docW)
    .map((e) => ({
      x: e.payload!.x!,
      y: e.payload!.y!,
      docW: e.payload!.docW!,
      docH: e.payload!.docH!,
    }));
  const clickDocH = ownClicks[0]?.docH ?? (session.viewportH ? session.viewportH * 3 : 2400);

  const metaItems: { k: string; v: string }[] = [
    { k: '访客 IP', v: visitorLabel(session.ip) },
    { k: '地域', v: geoLabel(session.country, session.region, session.city) },
    { k: '设备', v: `${icon} ${label} · ${shortUA(session.ua)}` },
    { k: '屏幕', v: session.screenW ? `${session.screenW}×${session.screenH}` : '—' },
    { k: '视口', v: session.viewportW ? `${session.viewportW}×${session.viewportH}` : '—' },
    { k: '语言', v: session.lang ?? '—' },
    { k: '来源', v: session.referrer || '(直接访问)' },
    { k: '停留', v: formatDuration(session.durationMs) },
    {
      k: '开始时间',
      v: formatTs(session.startedAt, { second: '2-digit' }),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2 text-[12px] text-muted">
        <Link href="/admin" className="hover:text-brand">Dashboard</Link>
        <span>/</span>
        <Link href={`/admin/analytics/content/${session.contentItemId}`} className="hover:text-brand">
          {session.title}
        </Link>
        <span>/</span>
        <span className="text-ink">会话回放</span>
      </div>

      <AdminPageHeader
        label="回放"
        title={session.title}
        description={`${session.contentType === 'article' ? '文章' : '镜像'} · 会话 ${session.id.slice(0, 8)}`}
      />

      {/* 会话上下文 */}
      <div className="ds-card grid grid-cols-2 gap-x-6 gap-y-3 p-5 sm:grid-cols-4">
        {metaItems.map(({ k, v }) => (
          <div key={k}>
            <div className="text-[11px] text-subtle">{k}</div>
            <div className="mt-0.5 truncate text-[13px] font-medium text-ink" title={v}>{v}</div>
          </div>
        ))}
      </div>

      {/* 回放播放器 */}
      <SessionPlayer
        sessionId={session.id}
        viewportW={session.viewportW}
        viewportH={session.viewportH}
      />

      {/* 视频观看轨迹 — 进度条热度 + 暂停点 + 跳转 */}
      <VideoTimeline events={timeline} />

      {/* 本次访问的点击热图（快照 = 该访客的屏幕尺寸） */}
      {session.chunkCount > 0 && ownClicks.length > 0 && (
        <div>
          <div className="mb-3 text-[13px] font-semibold text-ink">
            本次访问点击热图（{ownClicks.length} 次点击）
          </div>
          <HeatmapViewer
            sessionId={session.id}
            viewportW={session.viewportW ?? 1280}
            docH={clickDocH}
            points={ownClicks}
          />
        </div>
      )}

      {/* 行为时间线 */}
      <div className="overflow-hidden ds-card">
        <div className="border-b border-border px-[18px] py-3.5 text-[13px] font-semibold text-ink">
          行为时间线（{timeline.length} 条）
        </div>
        {timeline.length === 0 ? (
          <div className="px-[18px] py-8 text-center text-[13px] text-subtle">暂无结构化事件</div>
        ) : (
          <div className="max-h-[480px] divide-y divide-border overflow-y-auto">
            {timeline.map((e, i) => {
              const offsetMs = e.ts.getTime() - startMs;
              const offset = offsetMs >= 0 ? `+${(offsetMs / 1000).toFixed(1)}s` : '—';
              return (
                <div key={i} className="flex items-center gap-3 px-[18px] py-2">
                  <span className="w-14 flex-shrink-0 text-right font-mono text-[11px] text-subtle">
                    {offset}
                  </span>
                  <span className="truncate text-[12.5px] text-ink">
                    {describeEvent(e.type, e.payload)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
