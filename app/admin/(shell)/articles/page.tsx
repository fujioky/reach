// app/admin/(shell)/articles/page.tsx
// Article list — drafts and published posts, with comment counts.

import Link from 'next/link';

import { AdminPageHeader } from '@/app/_components/admin/AdminPageHeader';
import { listAllArticles } from '@/lib/article/queries';
import { countVisibleComments } from '@/lib/article/comments';
import { deriveExcerpt } from '@/lib/article/markdown';

function formatDate(date: Date | null): string {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

export default async function ArticleListPage() {
  const articles = await listAllArticles();
  const commentCounts = await countVisibleComments(articles.map((a) => a.id));

  if (articles.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <AdminPageHeader label="内容" title="文章管理" />
        <div className="ds-card p-6">
          <div className="py-12 text-center">
            <div className="mb-2 text-xl font-semibold text-ink">还没有文章</div>
            <div className="mb-4 text-sm text-muted">写下第一篇吧。</div>
            <Link
              href="/admin/articles/new"
              className="ds-btn-primary inline-block px-6 py-2.5 text-base"
            >
              写文章
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
        title="文章管理"
        description={`共 ${articles.length} 篇`}
        actions={
          <>
            <Link
              href="/admin/articles/media"
              className="rounded-sm border border-border bg-surface px-3.5 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
            >
              素材管理
            </Link>
            <Link href="/admin/articles/new" className="ds-btn-primary text-sm">
              + 写文章
            </Link>
          </>
        }
      />

      <div className="ds-card divide-y divide-border">
        {articles.map((article) => {
          const commentCount = commentCounts.get(article.id) ?? 0;
          return (
            <div key={article.id} className="flex items-start gap-4 p-4">
              {article.coverImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={article.coverImageUrl}
                  alt=""
                  className="hidden h-16 w-24 shrink-0 rounded-md object-cover ring-1 ring-border sm:block"
                />
              ) : (
                <div className="hidden h-16 w-24 shrink-0 rounded-md bg-surface-2 ring-1 ring-border sm:block" />
              )}

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/admin/articles/${article.id}`}
                    className="truncate text-[15px] font-semibold text-ink transition-colors hover:text-brand"
                  >
                    {article.title}
                  </Link>
                  <span
                    className={`shrink-0 rounded-pill px-2 py-0.5 text-[10px] font-semibold ${
                      article.status === 'published'
                        ? 'bg-success/12 text-success'
                        : 'bg-surface-2 text-muted'
                    }`}
                  >
                    {article.status === 'published' ? '已发布' : '草稿'}
                  </span>
                  {!article.listed && (
                    <span className="shrink-0 rounded-pill bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-muted">
                      不在归档
                    </span>
                  )}
                </div>

                <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-muted">
                  {article.excerpt || deriveExcerpt(article.body)}
                </p>

                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-subtle">
                  <span>{formatDate(article.publishedAt ?? article.createdAt)}</span>
                  {article.slug && <span className="font-mono">/p/{article.slug}</span>}
                  <span>{commentCount} 条评论</span>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {article.status === 'published' && article.slug && (
                  <Link
                    href={`/p/${article.slug}`}
                    target="_blank"
                    className="rounded-sm px-2.5 py-1.5 text-xs text-muted transition-colors hover:bg-surface-2 hover:text-ink"
                  >
                    查看
                  </Link>
                )}
                <Link
                  href={`/admin/articles/${article.id}`}
                  className="rounded-sm border border-border bg-surface px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-surface-2"
                >
                  编辑
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
