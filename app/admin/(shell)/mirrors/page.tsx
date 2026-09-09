// app/admin/(shell)/mirrors/page.tsx
// 内容管理列表 — 每行可展开，行内显示该内容的分享列表与操作。
//
// RSC: 一次性查询所有内容 + 所有分享（避免 N+1），按 contentItemId 分组后
// 传给 ContentRow（Client Component）管理展开状态。

import { desc } from 'drizzle-orm';
import Link from 'next/link';

import { AdminPageHeader } from '@/app/_components/admin/AdminPageHeader';
import { db, contentItems, shares } from '@/lib/db';
import { isNotArticle } from '@/lib/article/queries';
import { ContentRow, type ShareRow } from './_components/ContentRow';

function platformLabel(platform: string | null | undefined): string {
  switch (platform) {
    case 'x': return 'X / 推特';
    case 'youtube': return 'YouTube';
    default: return platform ?? '—';
  }
}

export default async function ContentListPage() {
  // 一次查全量（LIMIT 50），避免 N+1。
  // 自建文章同住 content_items，但走 /p/<slug> 公开页与独立的后台入口，
  // 这里只列镜像。
  const [mirrors, allShares] = await Promise.all([
    db
      .select()
      .from(contentItems)
      .where(isNotArticle)
      .limit(50)
      .orderBy(desc(contentItems.createdAt)),
    db.select().from(shares).orderBy(desc(shares.createdAt)),
  ]);

  // 按 contentItemId 分组
  const sharesMap = new Map<string, ShareRow[]>();
  for (const s of allShares) {
    const list = sharesMap.get(s.contentItemId) ?? [];
    list.push(s as ShareRow);
    sharesMap.set(s.contentItemId, list);
  }

  if (mirrors.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <AdminPageHeader label="内容" title="内容管理" />
        <div className="ds-card p-6">
          <div className="py-12 text-center">
            <div className="mb-2 text-xl font-semibold text-ink">还没有内容</div>
            <div className="mb-4 text-sm text-muted">去创建第一个镜像吧。</div>
            <Link
              href="/admin/mirrors/new"
              className="ds-btn-primary inline-block px-6 py-2.5 text-base shadow-brand"
            >
              创建镜像
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        label="内容"
        title="内容管理"
        actions={
          <Link href="/admin/mirrors/new" className="ds-btn-primary text-sm">
            + 创建镜像
          </Link>
        }
      />

      <div className="ds-card overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse">
          <thead>
            <tr>
              <th className="w-8 border-b border-border px-2 py-3" />
              <th className="border-b border-border px-2 py-3 text-left text-sm font-normal text-muted">内容</th>
              <th className="border-b border-border px-2 py-3 text-left text-sm font-normal text-muted">分享</th>
              <th className="border-b border-border px-2 py-3 text-left text-sm font-normal text-muted">创建时间</th>
              <th className="border-b border-border px-2 py-3 text-left text-sm font-normal text-muted">操作</th>
            </tr>
          </thead>
          <tbody>
            {mirrors.map((mirror) => (
              <ContentRow
                key={mirror.id}
                mirror={mirror}
                shares={sharesMap.get(mirror.id) ?? []}
                platformLabel={platformLabel(mirror.platform)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
