// app/admin/(shell)/articles/[id]/page.tsx
// Edit one article, and moderate the comments it collected.

import { notFound } from 'next/navigation';

import { AdminPageHeader } from '@/app/_components/admin/AdminPageHeader';
import { getArticleById } from '@/lib/article/queries';
import { listAllComments } from '@/lib/article/comments';
import { ArticleEditor } from '../_components/ArticleEditor';
import { getSitePasswordHash, readPasswordMode } from '@/lib/content/password';
import { CommentModeration } from '../_components/CommentModeration';
import { DeleteArticleButton } from '../_components/DeleteArticleButton';

export default async function EditArticlePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const article = await getArticleById(id);
  if (!article) notFound();

  const comments = await listAllComments(article.id);
  const sitePasswordConfigured = Boolean(await getSitePasswordHash());

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        label="内容"
        title="编辑文章"
        description="支持 Markdown，可直接拖入图片和视频"
        backHref="/admin/articles"
        backLabel="文章管理"
        actions={<DeleteArticleButton id={article.id} title={article.title} />}
      />

      <ArticleEditor
        initial={{
          id: article.id,
          title: article.title,
          body: article.body,
          excerpt: article.excerpt ?? '',
          slug: article.slug ?? '',
          coverImageUrl: article.coverImageUrl ?? '',
          authorName: article.author?.name ?? '',
          status: article.status === 'published' ? 'published' : 'draft',
          commentsEnabled: article.commentsEnabled,
          listed: article.listed,
          passwordMode: readPasswordMode(article.passwordMode),
          hasStoredPassword: Boolean(article.passwordHash),
          coverStyle: article.coverStyle === 'hero' ? 'hero' : 'above',
        }}
        sitePasswordConfigured={sitePasswordConfigured}
      />

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-lg font-bold text-ink">
            访客评论
            <span className="ml-2 text-sm font-normal text-muted">{comments.length} 条</span>
          </h2>
          {!article.commentsEnabled && (
            <span className="text-xs text-muted">评论已关闭，现有评论仍然可见</span>
          )}
        </div>
        <CommentModeration comments={comments} />
      </section>
    </div>
  );
}
