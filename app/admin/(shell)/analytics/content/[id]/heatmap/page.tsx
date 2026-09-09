// app/admin/(shell)/analytics/content/[id]/heatmap/page.tsx
// 内容点击热图 — 页面快照 + 点击热力叠加。
//
// 快照取该设备分桶下最近一个带录制的会话（?device=desktop|mobile 切换，
// ?session=<id> 可指定具体会话）；点击数据聚合同一分桶内所有会话，按
// 各自文档尺寸归一化后投影到快照上。快照宽度与所选访客视口一致。

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq, desc, sql } from 'drizzle-orm';
import { AdminPageHeader } from '@/app/_components/admin/AdminPageHeader';
import { db, contentItems, analyticsSessions } from '@/lib/db';
import { getClickPoints } from '@/lib/analytics/queries';
import { HeatmapViewer } from '../../../_components/HeatmapViewer';
import { formatTs } from '../../../_components/format';

const MOBILE_MAX_W = 768;

interface HeatmapPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ device?: string; session?: string }>;
}

export default async function ContentHeatmapPage({ params, searchParams }: HeatmapPageProps) {
  const { id } = await params;
  const { device: deviceParam, session: sessionParam } = await searchParams;

  const [item] = await db
    .select({ id: contentItems.id, title: contentItems.title, type: contentItems.type })
    .from(contentItems)
    .where(eq(contentItems.id, id))
    .limit(1);
  if (!item) notFound();

  const device = deviceParam === 'mobile' ? 'mobile' : 'desktop';
  const bucketCond =
    device === 'mobile'
      ? sql`${analyticsSessions.viewportW} < ${MOBILE_MAX_W}`
      : sql`${analyticsSessions.viewportW} >= ${MOBILE_MAX_W}`;

  // 代表性会话：优先 URL 指定，否则该分桶下最近一个带录制的会话
  const snapshotSessions = await db
    .select({
      id: analyticsSessions.id,
      viewportW: analyticsSessions.viewportW,
      viewportH: analyticsSessions.viewportH,
      startedAt: analyticsSessions.startedAt,
    })
    .from(analyticsSessions)
    .where(
      sql`${analyticsSessions.contentItemId} = ${id}
          AND ${analyticsSessions.chunkCount} > 0
          AND ${bucketCond}`,
    )
    .orderBy(desc(analyticsSessions.startedAt))
    .limit(10);

  const snapshot =
    (sessionParam && snapshotSessions.find((s) => s.id === sessionParam)) ||
    snapshotSessions[0] ||
    null;

  // 同分桶的点击点（跨会话聚合，坐标按各自文档尺寸归一化）
  const allPoints = await getClickPoints(id);
  const points = allPoints.filter((p) => {
    const w = p.viewportW ?? p.docW;
    return device === 'mobile' ? w < MOBILE_MAX_W : w >= MOBILE_MAX_W;
  });

  // 目标文档高度：取点击记录里最常见的 docH（快照会话的页面高度近似值），
  // 没有点击时退化为视口高度的 3 倍（可滚动页面的保守估计）
  const docHCounts = new Map<number, number>();
  for (const p of points) docHCounts.set(p.docH, (docHCounts.get(p.docH) ?? 0) + 1);
  const modeDocH = [...docHCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const docH = modeDocH || (snapshot?.viewportH ? snapshot.viewportH * 3 : 2400);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2 text-[12px] text-muted">
        <Link href="/admin" className="hover:text-brand">Dashboard</Link>
        <span>/</span>
        <Link href={`/admin/analytics/content/${id}`} className="hover:text-brand">{item.title}</Link>
        <span>/</span>
        <span className="text-ink">点击热图</span>
      </div>

      <AdminPageHeader
        label="热图"
        title={item.title}
        description="页面快照 + 点击热力叠加 · 快照尺寸与访客屏幕一致"
        actions={
          <div className="flex items-center gap-1 rounded-lg border border-border bg-surface p-1">
            {(['desktop', 'mobile'] as const).map((d) => (
              <Link
                key={d}
                href={`/admin/analytics/content/${id}/heatmap?device=${d}`}
                className={`rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${
                  device === d ? 'bg-brand text-white' : 'text-muted hover:text-ink'
                }`}
              >
                {d === 'desktop' ? '💻 桌面' : '📱 手机'}
              </Link>
            ))}
          </div>
        }
      />

      {!snapshot ? (
        <div className="rounded-lg border border-border py-16 text-center text-[13px] text-subtle">
          {device === 'mobile' ? '手机' : '桌面'}分桶下暂无带录制的会话 —
          需要至少一位访客打开过页面才能生成快照
        </div>
      ) : (
        <HeatmapViewer
          sessionId={snapshot.id}
          viewportW={snapshot.viewportW ?? (device === 'mobile' ? 390 : 1280)}
          docH={docH}
          points={points.map(({ x, y, docW, docH: h }) => ({ x, y, docW, docH: h }))}
        />
      )}

      {snapshotSessions.length > 1 && (
        <div className="ds-card p-4">
          <div className="mb-2 text-[12px] font-medium text-muted">切换快照会话</div>
          <div className="flex flex-wrap gap-2">
            {snapshotSessions.map((s) => (
              <Link
                key={s.id}
                href={`/admin/analytics/content/${id}/heatmap?device=${device}&session=${s.id}`}
                className={`rounded-md border px-2.5 py-1 text-[11px] transition-colors ${
                  snapshot?.id === s.id
                    ? 'border-brand bg-brand/10 text-brand'
                    : 'border-border text-muted hover:text-ink'
                }`}
              >
                {s.viewportW}×{s.viewportH} · {formatTs(s.startedAt)}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
