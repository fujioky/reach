// app/admin/(shell)/mirrors/page.tsx
// 内容管理列表 — 每行可展开，行内显示该内容的分享列表与操作。
//
// RSC: 查询当前页的内容 + 这些内容的分享（避免 N+1），按 contentItemId 分组后
// 传给 ContentRow（Client Component）管理展开状态。分页走查询参数
// ?page=&size=，size 可选 50 / 100 / 200 / all。

import { count, desc, inArray } from 'drizzle-orm';
import Link from 'next/link';

import { AdminPageHeader } from '@/app/_components/admin/AdminPageHeader';
import { db, contentItems, shares } from '@/lib/db';
import { isNotArticle } from '@/lib/article/queries';
import { ContentRow, type ShareRow } from './_components/ContentRow';
import { xKindLabel } from '@/lib/mirror/kind-label';
import { ListPager, parsePageParams } from './_components/ListPager';

function platformLabel(platform: string | null | undefined): string {
  switch (platform) {
    case 'x': return 'X / 推特';
    case 'youtube': return 'YouTube';
    default: return platform ?? '—';
  }
}

export default async function ContentListPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; size?: string }>;
}) {
  // 自建文章同住 content_items，但走 /p/<slug> 公开页与独立的后台入口，
  // 这里只列镜像。
  const [{ total }] = await db.select({ total: count() }).from(contentItems).where(isNotArticle);
  const { page, size, pageCount } = parsePageParams(await searchParams, total);
  const listQuery = db.select().from(contentItems).where(isNotArticle).orderBy(desc(contentItems.createdAt));
  const mirrors = size === 'all' ? await listQuery : await listQuery.limit(size).offset((page - 1) * size);
  const allShares =
    mirrors.length === 0
      ? []
      : await db
          .select()
          .from(shares)
          .where(inArray(shares.contentItemId, mirrors.map((m) => m.id)))
          .orderBy(desc(shares.createdAt));

  // 按 contentItemId 分组
  const sharesMap = new Map<string, ShareRow[]>();
  for (const s of allShares) {
    const list = sharesMap.get(s.contentItemId) ?? [];
    list.push(s as ShareRow);
    sharesMap.set(s.contentItemId, list);
  }

  if (total === 0) {
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
                kindLabel={xKindLabel(mirror.platform, mirror.platformData)}
              />
            ))}
          </tbody>
        </table>
      </div>

      <ListPager page={page} size={size} pageCount={pageCount} total={total} />
    </div>
  );
}
