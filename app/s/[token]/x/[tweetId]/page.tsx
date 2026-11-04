// app/s/[token]/x/[tweetId]/page.tsx
// An X post opened from a mirror's thread (a parent above the mirrored post,
// or a reply on another opened post). It stays under the same share: the same
// gates apply, nothing new is mirrored, and the post is read from
// x_post_cache, fetched once on first open (lib/mirror/x-post-cache.ts).
//
// Access is read-only (checkShareMediaAccess): opening a post from the thread
// does not spend a view of the share.

import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { eq } from 'drizzle-orm';
import { db, contentItems } from '@/lib/db';
import { checkShareMediaAccess } from '@/lib/access/share-media';
import { extractVisitorIp, getVisitorCookie } from '@/lib/access/visitor';
import { checkUnlocked } from '@/lib/content/password';
import { turnstileGateRequired } from '@/lib/turnstile';
import { getSetting } from '@/lib/settings';
import { auth } from '@/auth';
import { openPost } from '@/lib/mirror/x-post-cache';
import { threadVideoSrc, toThreadNodes } from '@/lib/mirror/thread-view';
import { PageBackground } from '@/app/_components/layout/PageBackground';
import { SurfaceCard } from '@/app/_components/ui/SurfaceCard';
import { CommentsSection, ShareHeader } from '../../_components/ShareChrome';
import { PageTranslationShell } from '../../_components/TranslationContext';
import { TranslatedBody } from '../../_components/TranslatedBody';
import { ThreadParents } from '../../_components/ThreadParents';
import { CommentListClient, ThreadVideos } from '../../_components/CommentListClient';
import { proxyAvatar } from '../../_components/proxy-avatar';
import { XImageGrid } from '../../_components/XImageGrid';
import { ExpiredPage } from '../../_components/ExpiredPage';
import { BackToMirror } from '../../_components/BackToMirror';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export const metadata: Metadata = { title: '帖子 — Reach', robots: { index: false } };

export default async function OpenedPostPage({
  params,
}: {
  params: Promise<{ token: string; tweetId: string }>;
}) {
  const { token, tweetId } = await params;
  if (!/^\d{1,25}$/.test(tweetId)) notFound();

  // The mirror page runs the human check and the password gate; send anyone
  // who has not passed them there first.
  if (await turnstileGateRequired()) redirect(`/s/${token}`);
  const access = await checkShareMediaAccess(token, await getVisitorCookie(), await extractVisitorIp());
  if (!access.allowed) {
    if (access.reason === 'not_found') notFound();
    return <ExpiredPage reason="expired" />;
  }
  const [item] = await db.select().from(contentItems).where(eq(contentItems.id, access.share.contentItemId)).limit(1);
  if (!item || item.platform !== 'x') notFound();
  const unlock = await checkUnlocked(item);
  if (unlock.required && !unlock.unlocked) redirect(`/s/${token}`);

  const adminHref = (await auth())?.user ? `/admin/mirrors/${item.id}` : undefined;
  const opened = await openPost(item, tweetId);
  if (!opened.ok) {
    if (opened.status === 404) notFound();
    return (
      <Frame token={token} mirrorTitle={item.title} adminHref={adminHref}>
        <SurfaceCard className="p-6 text-center text-sm text-muted">这条帖子暂时打不开，请稍后再试。</SurfaceCard>
      </Frame>
    );
  }

  const { payload } = opened;
  const videoSrc = threadVideoSrc(token);
  const [post] = await toThreadNodes([{ ...payload.post, inReplyTo: null }], undefined, videoSrc);
  const parents = await toThreadNodes(payload.parents.map((p) => ({ ...p, inReplyTo: null })), undefined, videoSrc);
  const replies = await toThreadNodes(payload.replies, undefined, videoSrc);
  const translationAvailable = Boolean(await getSetting('deepl_api_key'));

  return (
    <Frame token={token} mirrorTitle={item.title} adminHref={adminHref}>
      <PageTranslationShell translationAvailable={translationAvailable}>
        {(parents.length > 0 || payload.parentMissing) && (
          <ThreadParents parents={parents} parentMissing={payload.parentMissing} token={token} earlierMode="open" />
        )}
        <SurfaceCard className="overflow-hidden p-5 shadow-md md:p-6">
          <div className="flex items-start gap-3">
            {post!.author.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={proxyAvatar(post!.author.avatarUrl)}
                alt={post!.author.name}
                className="h-11 w-11 shrink-0 rounded-full ring-2 ring-border/60"
              />
            ) : (
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-2 text-lg font-bold text-muted">
                {post!.author.name.charAt(0)}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-bold text-ink">{post!.author.name}</div>
              <div className="text-[13px] text-muted">@{post!.author.handle}</div>
            </div>
          </div>
          <TranslatedBody text={post!.text} className="mt-4 text-[15px] leading-[1.65] text-ink" />
          {post!.images.length > 0 && (
            <XImageGrid images={post!.images.map((src, i) => ({ src, alt: `图片 ${i + 1}` }))} />
          )}
          <ThreadVideos srcs={post!.videos} className="mt-3" />
          <div className="mt-4 flex items-center justify-between text-[13px] text-muted">
            <span>{payload.post.postedAt ? new Date(payload.post.postedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : ''}</span>
            <a href={payload.post.sourceUrl} target="_blank" rel="noopener noreferrer" className="hover:text-ink">
              在 X 查看原文 ↗
            </a>
          </div>
        </SurfaceCard>
        <CommentsSection>
          <CommentListClient comments={replies} token={token} />
        </CommentsSection>
      </PageTranslationShell>
    </Frame>
  );
}

function Frame({
  token,
  mirrorTitle,
  adminHref,
  children,
}: {
  token: string;
  mirrorTitle: string;
  adminHref?: string;
  children: React.ReactNode;
}) {
  return (
    <div data-platform="x" className="relative min-h-screen bg-paper text-ink">
      <PageBackground intensity="subtle" />
      <ShareHeader platform="x" adminHref={adminHref} />
      <div className="relative mx-auto max-w-[720px] px-4 pb-12 pt-6 md:pt-10">
        <BackToMirror token={token} title={mirrorTitle} />
        {children}
      </div>
    </div>
  );
}
