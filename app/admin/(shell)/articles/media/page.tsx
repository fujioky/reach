// app/admin/(shell)/articles/media/page.tsx
// Asset manager for article images and videos.

import Link from 'next/link';

import { AdminPageHeader } from '@/app/_components/admin/AdminPageHeader';
import { listArticleAssets } from '@/lib/article/assets';
import { listAllArticles } from '@/lib/article/queries';
import { AssetManager } from '../_components/AssetManager';

export default async function ArticleAssetsPage() {
  const [inventory, articles] = await Promise.all([listArticleAssets(), listAllArticles()]);

  // Share links need an absolute URL. In production this comes from the
  // environment; locally it falls back to the browser's own origin, which is
  // the right answer for a dev server anyway.
  const siteOrigin = (
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : '')
  ).replace(/\/$/, '');

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        label="文章"
        title="素材管理"
        description="文章中上传的图片与视频，可复制分享链接、公开单个素材，或清理无人引用的存量"
        actions={
          <Link
            href="/admin/articles"
            className="rounded-sm border border-border bg-surface px-3.5 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
          >
            返回文章列表
          </Link>
        }
      />

      <AssetManager
        articles={articles.map((a) => ({
          id: a.id,
          title: a.title,
          status: a.status === 'published' ? 'published' : 'draft',
        }))}
        assets={inventory.assets}
        totalBytes={inventory.totalBytes}
        sweepableCount={inventory.sweepableCount}
        sweepableBytes={inventory.sweepableBytes}
        siteOrigin={siteOrigin}
      />
    </div>
  );
}
