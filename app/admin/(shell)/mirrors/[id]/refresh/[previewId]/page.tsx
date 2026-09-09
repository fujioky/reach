// app/admin/(shell)/mirrors/[id]/refresh/[previewId]/page.tsx
// Refresh preview page — shows the diff between the current mirror and the
// newly-fetched content. The admin selects which comments to keep, then clicks
// "应用新版本" or "放弃".
//
// RSC: loads current mirror content + preview content. Client component
// handles the selection + apply/discard actions.

import { notFound } from 'next/navigation';
import { eq, and } from 'drizzle-orm';
import Link from 'next/link';

import { db, contentItems, media, comments, refreshPreviews } from '@/lib/db';
import { RefreshPreview } from './_components/RefreshPreview';
import type { FetchedContent } from '@/lib/fetcher/types';

interface RefreshPreviewPageProps {
  params: Promise<{ id: string; previewId: string }>;
}

export default async function RefreshPreviewPage({ params }: RefreshPreviewPageProps) {
  const { id, previewId } = await params;

  // Load current mirror + preview in parallel
  const [itemRows, previewRows] = await Promise.all([
    db.select().from(contentItems).where(eq(contentItems.id, id)).limit(1),
    db
      .select()
      .from(refreshPreviews)
      .where(and(eq(refreshPreviews.id, previewId), eq(refreshPreviews.contentItemId, id)))
      .limit(1),
  ]);

  const item = itemRows[0];
  const preview = previewRows[0];

  if (!item || !preview) {
    notFound();
  }

  // Load current media + comments
  const [mediaRows, commentRows] = await Promise.all([
    db.select().from(media).where(eq(media.contentItemId, id)),
    db.select().from(comments).where(eq(comments.contentItemId, id)),
  ]);

  // Build a "FetchedContent-like" view of the current mirror for the diff
  const currentContent: FetchedContent = {
    platform: item.platform as 'x' | 'youtube',
    sourceId: (item.platformData as { sourceId?: string } | null)?.sourceId ?? '',
    sourceUrl: item.sourceUrl ?? '',
    title: item.title,
    content: item.body,
    body: item.body,
    author: (item.author as FetchedContent['author']) ?? { id: '', name: '未知', handle: '', url: '', avatarUrl: '' },
    publishedAt: item.publishedAt ? item.publishedAt.toISOString() : '',
    media: mediaRows.map((m) => ({
      type: (m.type ?? 'image') as 'image' | 'video',
      originalUrl: m.originalUrl,
      blobUrl: m.blobUrl,
      size: m.size,
      meta: m.meta,
    })) as FetchedContent['media'],
    stats: (item.stats as FetchedContent['stats']) ?? { likes: 0, comments: 0, reposts: 0, views: 0, collects: 0 },
    comments: commentRows.map((c) => ({
      id: c.platformCommentId ?? '',
      content: c.text,
      author: (c.author as FetchedContent['comments'][number]['author']) ?? { id: '', name: '未知', handle: '', url: '', avatarUrl: '' },
      createdAt: c.postedAt ? c.postedAt.toISOString() : '',
      stats: { likes: c.likes ?? 0, replies: 0 },
      replies: [],
    })),
    platformData: (item.platformData as FetchedContent['platformData']) ?? {},
    fetchedAt: item.fetchedAt ? item.fetchedAt.toISOString() : '',
  };

  const newContent = preview.content as FetchedContent;

  return (
    <div className="flex flex-col gap-5">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-[12px] text-muted">
        <Link href="/admin/mirrors" className="hover:text-brand">内容管理</Link>
        <span>/</span>
        <Link href={`/admin/mirrors/${id}`} className="hover:text-brand">{item.title}</Link>
        <span>/</span>
        <span className="text-ink">刷新预览</span>
      </div>

      <h1 className="font-display text-2xl font-bold tracking-tight text-ink">刷新预览</h1>
      <p className="text-[13px] text-subtle">
        对比当前版本与新抓取的内容，选择要保留的评论，然后应用新版本。
      </p>

      <RefreshPreview
        mirrorId={id}
        previewId={previewId}
        currentContent={currentContent}
        newContent={newContent}
      />
    </div>
  );
}
