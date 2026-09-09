// app/admin/(shell)/analytics/sessions/page.tsx
// 访问记录浏览器 — 每一条访问（会话）都在这里，可按内容 / 设备筛选，
// 分页浏览。每行：真实 IP、地域、设备与屏幕尺寸、内容、时长、时间，
// 点击进入该次访问的完整详情（回放 + 热图 + 视频轨迹）。

import Link from 'next/link';
import { AdminPageHeader } from '@/app/_components/admin/AdminPageHeader';
import { listSessionsFiltered, listTrackedContents } from '@/lib/analytics/queries';
import { SessionListRow } from '../_components/SessionListRow';

const PAGE_SIZE = 30;

interface SessionsPageProps {
  searchParams: Promise<{ content?: string; device?: string; page?: string }>;
}

export default async function SessionsPage({ searchParams }: SessionsPageProps) {
  const { content, device: deviceParam, page: pageParam } = await searchParams;
  const device =
    deviceParam === 'mobile' ? 'mobile' : deviceParam === 'desktop' ? 'desktop' : undefined;
  const page = Math.max(1, parseInt(pageParam ?? '1', 10) || 1);

  const [{ rows, total }, contents] = await Promise.all([
    listSessionsFiltered(
      { contentItemId: content || undefined, device },
      PAGE_SIZE,
      (page - 1) * PAGE_SIZE,
    ),
    listTrackedContents(),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const qs = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged = { content, device: deviceParam, page: undefined as string | undefined, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    const s = params.toString();
    return s ? `?${s}` : '';
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2 text-[12px] text-muted">
        <Link href="/admin" className="hover:text-brand">Dashboard</Link>
        <span>/</span>
        <span className="text-ink">访问记录</span>
      </div>

      <AdminPageHeader
        label="记录"
        title="访问记录"
        description={`共 ${total} 次访问 · 每条都可回放`}
      />

      {/* 筛选器 */}
      <form method="get" className="flex flex-wrap items-center gap-2">
        <select
          name="content"
          defaultValue={content ?? ''}
          className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-[12px] text-ink"
        >
          <option value="">全部内容</option>
          {contents.map((c) => (
            <option key={c.id} value={c.id}>
              [{c.type === 'article' ? '文章' : '镜像'}] {c.title.slice(0, 40)}
            </option>
          ))}
        </select>
        <select
          name="device"
          defaultValue={deviceParam ?? ''}
          className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-[12px] text-ink"
        >
          <option value="">全部设备</option>
          <option value="desktop">💻 桌面</option>
          <option value="mobile">📱 手机</option>
        </select>
        <button type="submit" className="ds-btn-primary px-3 py-1.5 text-[12px]">
          筛选
        </button>
        {(content || device) && (
          <Link href="/admin/analytics/sessions" className="text-[12px] text-muted hover:text-brand">
            清除筛选
          </Link>
        )}
      </form>

      {/* 记录列表 */}
      <div className="overflow-hidden ds-card">
        {rows.length === 0 ? (
          <div className="px-[18px] py-10 text-center text-[13px] text-subtle">
            没有匹配的访问记录
          </div>
        ) : (
          rows.map((s) => <SessionListRow key={s.id} s={s} />)
        )}
      </div>

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 text-[12px]">
          {page > 1 ? (
            <Link href={qs({ page: String(page - 1) })} className="text-muted hover:text-brand">
              ← 上一页
            </Link>
          ) : (
            <span className="text-border">← 上一页</span>
          )}
          <span className="text-subtle">{page} / {totalPages}</span>
          {page < totalPages ? (
            <Link href={qs({ page: String(page + 1) })} className="text-muted hover:text-brand">
              下一页 →
            </Link>
          ) : (
            <span className="text-border">下一页 →</span>
          )}
        </div>
      )}
    </div>
  );
}
