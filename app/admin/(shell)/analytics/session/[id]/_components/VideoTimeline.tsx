// app/admin/(shell)/analytics/session/[id]/_components/VideoTimeline.tsx
// 单次会话的视频观看时间线 — 每个视频一条进度条：
//   - 观看热度：把时长切成 100 格，连续观看区间（range 事件）覆盖到的格子
//     着色，重复观看颜色加深 —— 一眼看出他看了哪里、反复看了哪里
//   - 暂停点：⏸ 标记在暂停位置
//   - 跳转：标记 from → to（悬停显示具体时间）
// 纯展示组件（RSC 渲染，无客户端 JS）。

import type { VisitEventPayload } from '@/lib/db/schema';

interface VideoTimelineProps {
  events: { type: string; payload: VisitEventPayload | null }[];
}

interface VideoActivity {
  mediaId: string;
  duration: number;
  ranges: { from: number; to: number }[];
  pauses: number[];
  seeks: { from: number; to: number }[];
  completed: boolean;
}

const BUCKETS = 100;

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

/** 从会话事件里聚合出每个视频的观看活动 */
export function collectVideoActivity(
  events: VideoTimelineProps['events'],
): VideoActivity[] {
  const byMedia = new Map<string, VideoActivity>();
  for (const e of events) {
    if (e.type !== 'video' || !e.payload) continue;
    const p = e.payload;
    const key = p.mediaId ?? 'video';
    let v = byMedia.get(key);
    if (!v) {
      v = { mediaId: key, duration: 0, ranges: [], pauses: [], seeks: [], completed: false };
      byMedia.set(key, v);
    }
    if (p.duration && p.duration > v.duration) v.duration = p.duration;
    switch (p.action) {
      case 'range':
        if (p.from != null && p.to != null && p.to > p.from) {
          v.ranges.push({ from: p.from, to: p.to });
        }
        break;
      case 'pause':
        if (p.position != null) v.pauses.push(p.position);
        break;
      case 'seek':
        if (p.from != null && p.to != null && Math.abs(p.to - p.from) > 1) {
          v.seeks.push({ from: p.from, to: p.to });
        }
        break;
      case 'ended':
        v.completed = true;
        break;
    }
  }
  // 没有任何有效时长的条目无法画时间线
  return Array.from(byMedia.values()).filter((v) => v.duration > 0);
}

export function VideoTimeline({ events }: VideoTimelineProps) {
  const videos = collectVideoActivity(events);
  if (videos.length === 0) return null;

  return (
    <div className="ds-card p-5">
      <div className="mb-4 text-[13px] font-semibold text-ink">视频观看轨迹</div>
      <div className="flex flex-col gap-6">
        {videos.map((v) => {
          // 每格被观看区间覆盖的次数 → 热度
          const heat = new Array<number>(BUCKETS).fill(0);
          for (const r of v.ranges) {
            const a = Math.max(0, Math.floor((r.from / v.duration) * BUCKETS));
            const b = Math.min(BUCKETS - 1, Math.ceil((r.to / v.duration) * BUCKETS) - 1);
            for (let i = a; i <= b; i++) heat[i] += 1;
          }
          const maxHeat = Math.max(...heat, 1);
          const watchedSec = v.ranges.reduce((s, r) => s + (r.to - r.from), 0);

          return (
            <div key={v.mediaId}>
              <div className="mb-1.5 flex items-center justify-between text-[12px]">
                <span className="truncate font-medium text-muted">{v.mediaId}</span>
                <span className="text-subtle">
                  共看 {fmtTime(watchedSec)} / {fmtTime(v.duration)}
                  {v.completed && ' · ✅ 看完'}
                </span>
              </div>

              {/* 观看热度条 */}
              <div className="relative">
                <div className="flex h-7 w-full overflow-hidden rounded-md bg-surface-2">
                  {heat.map((n, i) => (
                    <div
                      key={i}
                      className="h-full flex-1"
                      style={
                        n > 0
                          ? { backgroundColor: `rgba(91, 79, 233, ${0.25 + 0.75 * (n / maxHeat)})` }
                          : undefined
                      }
                      title={
                        n > 0
                          ? `${fmtTime((i / BUCKETS) * v.duration)} 附近 · 看了 ${n} 遍`
                          : undefined
                      }
                    />
                  ))}
                </div>

                {/* 暂停点标记 */}
                {v.pauses.map((pos, i) => (
                  <div
                    key={`p${i}`}
                    className="absolute -top-1 h-9 w-[2px] rounded bg-amber-500"
                    style={{ left: `${Math.min(99.5, (pos / v.duration) * 100)}%` }}
                    title={`⏸ 在 ${fmtTime(pos)} 暂停`}
                  />
                ))}

                {/* 跳转标记（起点 ○ → 终点 ●） */}
                {v.seeks.map((s, i) => {
                  const fromPct = Math.min(99, (s.from / v.duration) * 100);
                  const toPct = Math.min(99, (s.to / v.duration) * 100);
                  const forward = s.to > s.from;
                  return (
                    <div key={`s${i}`} title={`⏩ 从 ${fmtTime(s.from)} 跳到 ${fmtTime(s.to)}`}>
                      <div
                        className="absolute -bottom-2 h-2 w-2 rounded-full border-2 border-rose-400 bg-paper"
                        style={{ left: `calc(${fromPct}% - 4px)` }}
                      />
                      <div
                        className="absolute -bottom-2 h-2 w-2 rounded-full bg-rose-500"
                        style={{ left: `calc(${toPct}% - 4px)` }}
                      />
                      <div
                        className="absolute -bottom-[5px] h-[2px] bg-rose-400/60"
                        style={{
                          left: `${Math.min(fromPct, toPct)}%`,
                          width: `${Math.abs(toPct - fromPct)}%`,
                        }}
                      >
                        <span
                          className="absolute -top-[3px] text-[8px] leading-none text-rose-500"
                          style={forward ? { right: -2 } : { left: -2 }}
                        >
                          {forward ? '▸' : '◂'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* 时间轴刻度 */}
              <div className="mt-3 flex justify-between text-[10px] text-subtle">
                <span>0:00</span>
                <span>{fmtTime(v.duration / 2)}</span>
                <span>{fmtTime(v.duration)}</span>
              </div>

              <div className="mt-1 flex items-center gap-4 text-[10px] text-subtle">
                <span><span className="mr-1 inline-block h-2 w-3 rounded-sm bg-brand/60 align-middle" />观看热度（越深看得越多）</span>
                <span><span className="mr-1 inline-block h-3 w-[2px] bg-amber-500 align-middle" />暂停</span>
                <span className="text-rose-500">○→● 跳转</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
