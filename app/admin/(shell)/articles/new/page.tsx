// app/admin/(shell)/articles/new/page.tsx
// New article. No row is created up front — the editor persists a draft on the
// first save or the first upload, so opening this page and walking away leaves
// nothing behind.

import { auth } from '@/auth';
import { AdminPageHeader } from '@/app/_components/admin/AdminPageHeader';
import { ArticleEditor } from '../_components/ArticleEditor';
import { getSitePasswordHash } from '@/lib/content/password';

export default async function NewArticlePage() {
  const session = await auth();
  const sitePasswordConfigured = Boolean(await getSitePasswordHash());

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        label="内容"
        title="写文章"
        description="支持 Markdown，可直接拖入图片和视频"
        backHref="/admin/articles"
        backLabel="文章管理"
      />
      <ArticleEditor
        initial={{
          id: null,
          title: '',
          body: '',
          excerpt: '',
          slug: '',
          coverImageUrl: '',
          authorName: session?.user?.name ?? '',
          status: 'draft',
          commentsEnabled: true,
          listed: true,
          passwordMode: 'none',
          hasStoredPassword: false,
          coverStyle: 'above',
        }}
        sitePasswordConfigured={sitePasswordConfigured}
      />
    </div>
  );
}
