// app/admin/(shell)/analytics/_components/SessionListRow.tsx
// 会话列表行 — Dashboard「最近访问」与访问记录页共用。
//
// 响应式：≥sm 单行（IP/地域 · 设备 · 所属内容 · 时长 · 时间 · 回放）；
// <sm 拆成两到三行（第一行 IP+回放，第二行设备/视口/时长/时间，第三行
// 所属内容），杜绝窄屏上 nowrap 文本互相挤压重叠。

import Link from 'next/link';
import { classifyUA, shortUA, formatTs, formatDuration, visitorLabel, geoLabel } from './format';

export interface SessionRowData {
  id: string;
  ip: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  ua: string | null;
  viewportW: number | null;
  viewportH: number | null;
  title: string | null;
  durationMs: number;
  startedAt: Date;
  chunkCount: number;
  eventCount?: number;
}

export function SessionListRow({ s }: { s: SessionRowData }) {
  const { label, icon } = classifyUA(s.ua);
  const viewport = s.viewportW && s.viewportH ? `${s.viewportW}×${s.viewportH}` : null;

  return (
    <Link
      href={`/admin/analytics/session/${s.id}`}
      className="block border-b border-border px-[18px] py-2.5 transition-colors last:border-b-0 hover:bg-surface-2"
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1 sm:w-32 sm:flex-none">
          <div className="truncate font-mono text-[13px] font-medium text-ink">
            {visitorLabel(s.ip)}
          </div>
          <div className="truncate text-[11px] text-subtle">
            {geoLabel(s.country, s.region, s.city)}
          </div>
        </div>

        <div className="hidden min-w-0 items-center gap-2 text-[12px] text-muted sm:flex" title={label}>
          <span className="text-[14px]">{icon}</span>
          <span className="truncate">{shortUA(s.ua)}</span>
          {viewport && <span className="whitespace-nowrap text-subtle">{viewport}</span>}
        </div>

        <span className="hidden max-w-[220px] truncate text-[12px] text-subtle md:inline">
          {s.title}
        </span>
        <div className="hidden flex-1 sm:block" />

        {s.eventCount != null && (
          <span className="hidden whitespace-nowrap text-[11px] text-subtle lg:inline">
            {s.eventCount} 事件
          </span>
        )}
        <span className="hidden whitespace-nowrap text-[11px] text-subtle sm:inline">
          {formatDuration(s.durationMs)}
        </span>
        <span className="hidden whitespace-nowrap text-[11px] text-subtle sm:inline">
          {formatTs(s.startedAt)}
        </span>
        <span className="shrink-0 whitespace-nowrap rounded-pill bg-brand/10 px-2 py-0.5 text-[11px] text-brand">
          {s.chunkCount > 0 ? '▶ 回放' : '无录制'}
        </span>
      </div>

      {/* <sm：设备/视口/时长/时间 独立一行 */}
      <div className="mt-1.5 flex items-center gap-2 text-[11px] text-subtle sm:hidden" title={label}>
        <span className="text-[13px]">{icon}</span>
        <span className="truncate">{shortUA(s.ua)}</span>
        {viewport && <span className="whitespace-nowrap">{viewport}</span>}
        <span className="ml-auto whitespace-nowrap">
          {formatDuration(s.durationMs)} · {formatTs(s.startedAt)}
        </span>
      </div>

      {/* <md：所属内容标题独立一行（桌面在主行内联显示） */}
      {s.title && (
        <div className="mt-1 truncate text-[11px] text-subtle md:hidden">{s.title}</div>
      )}
    </Link>
  );
}
