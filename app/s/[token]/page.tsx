// app/s/[token]/page.tsx
// Visitor mirror page — Reach 外壳 + 平台内容区（D-70~D-73）。
//
// D-70: 同一设计系统在不同 platform/theme/viewport 下的呈现
// D-71: 移动端单栏 / 桌面端双栏（md: 断点 768px）
// D-72: Reach top bar + access notice + outlink button + 平台内容区
// D-73: 保留平台辨识度但不模仿原生配色
//
// YouTube 沉浸式（方案 B）：视频全屏 hero + 浮动 via Reach 徽章 + 底部 pinned strip
// X 标准式（方案 A/C）：Reach top bar + access notice 卡 + 推文卡 + 查看原文按钮
//
// 架构保留：SSR + Suspense 流式渲染（D-44），Tracker 区块追踪（D-63）。

import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { db, contentItems, shares } from '@/lib/db';
import { eq } from 'drizzle-orm';
import type { Platform, EngagementStats } from '@/lib/fetcher/types';
import { checkAccess, peekAccess } from '@/lib/access/control';
import { extractVisitorIp, getVisitorCookie } from '@/lib/access/visitor';
import { lookupCache } from '@/lib/translation/cache';

import { PageBackground } from '@/app/_components/layout/PageBackground';
import { SurfaceCard } from '@/app/_components/ui/SurfaceCard';
import { MediaGallery } from './_components/MediaGallery';
import { CommentList } from './_components/CommentList';
import { VideoSection } from './_components/VideoSection';
import { StatsBar } from './_components/StatsBar';
import { YouTubeActions } from './_components/YouTubeActions';
import { DescriptionCollapse } from './_components/DescriptionCollapse';
import { TranslatedBody } from './_components/TranslatedBody';
import { PageTranslationShell } from './_components/TranslationContext';
import { MirrorSidebar } from './_components/MirrorSidebar';
import { GallerySkeleton, CommentsSkeleton, VideoPreparing } from './_components/Skeletons';
import { ExpiredPage } from './_components/ExpiredPage';
import { Recorder } from '@/app/_components/analytics/Recorder';
import { TranslatedTitleUpdater } from './_components/TranslatedTitleUpdater';
import {
  CommentsSection,
  ShareAccessBanner,
  ShareExpiryStrip,
  ShareHeader,
  ShareViaBadge,
} from './_components/ShareChrome';
import { SiteMetaLinks } from '@/app/_components/layout/SiteMetaLinks';
import { getSetting } from '@/lib/settings';
import { checkUnlocked } from '@/lib/content/password';
import { UnlockGate } from '@/app/_components/content/UnlockGate';
import { turnstileGateRequired, turnstileSiteKey } from '@/lib/turnstile';
import { TurnstileGate } from '@/app/_components/content/TurnstileGate';

export const dynamic = 'force-dynamic'; // D-37: no caching

// ── generateMetadata: set <title> to the translated post title ──────────────
//
// On repeat visits the translation is in the DB cache → the <title> tag ships
// with the translated title in the initial HTML. On first visits the cache is
// empty → we ship the original title and a client component updates
// document.title when the DeepL translation arrives.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;

  // Access control — don't leak titles for expired/nonexistent shares.
  // peek, not check: generateMetadata runs on every request and must not spend
  // a view, which would burn a one-shot link before the page even renders.
  const visitorCookie = await getVisitorCookie();
  const visitorIp = await extractVisitorIp();
  const accessResult = await peekAccess(token, visitorCookie, visitorIp);
  if (!accessResult.allowed) {
    return { title: 'Reach — 链接已失效' };
  }

  const [item] = await db
    .select()
    .from(contentItems)
    .where(eq(contentItems.id, accessResult.share.contentItemId))
    .limit(1);
  if (!item) return { title: 'Reach' };

  // Protected content gives away no title, to a visitor or a link preview —
  // until the visitor is through the gate, at which point the real title is
  // what belongs in the tab.
  const unlock = await checkUnlocked(item);
  if (unlock.required && !unlock.unlocked) return { title: '需要密码 — Reach' };

  // Look up translation cache for the title
  const deeplKey = await getSetting('deepl_api_key');
  if (deeplKey && item.title) {
    const cacheHits = await lookupCache([item.title], 'ZH');
    const translated = cacheHits.get(item.title);
    if (translated) {
      return { title: `${translated} — Reach` };
    }
  }

  // Fallback: original title
  return { title: item.title ? `${item.title} — Reach` : 'Reach' };
}

const X_LOGO = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="#1d9bf0" aria-hidden="true">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231z" />
  </svg>
);

const YOUTUBE_LOGO = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="#ff0000" aria-hidden="true">
    <path d="M23 12s0-3.5-.4-5.2c-.3-1-1-1.7-2-2C18.8 4.5 12 4.5 12 4.5s-6.8 0-8.6.3c-1 .3-1.7 1-2 2C1 8.5 1 12 1 12s0 3.5.4 5.2c.3 1 1 1.7 2 2 1.8.3 8.6.3 8.6.3s6.8 0 8.6-.3c1-.3 1.7-1 2-2C23 15.5 23 12 23 12zM9.8 15.3V8.7l5.7 3.3z" />
  </svg>
);

export default async function VisitorPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // ⓪ Turnstile 人机验证 — 拦在最前面：爬虫连密码框都见不到，
  // 也不会触发 checkAccess 的计数/burn 逻辑。
  if (await turnstileGateRequired()) {
    return <TurnstileGate siteKey={turnstileSiteKey()} />;
  }

  // ① Password gate — deliberately before checkAccess.
  //
  // checkAccess is what counts a view, tallies unique visitors and burns a
  // burn-after-read link. Running it first would mean anyone who merely opens
  // the URL — or guesses at the password — spends the owner's quota, and could
  // destroy a one-shot link without ever seeing the content. So the password is
  // verified against the content item on its own, and only a visitor who is
  // through it reaches the access rules.
  const [guarded] = await db
    .select({
      passwordMode: contentItems.passwordMode,
      passwordHash: contentItems.passwordHash,
    })
    .from(shares)
    .innerJoin(contentItems, eq(shares.contentItemId, contentItems.id))
    .where(eq(shares.token, token))
    .limit(1);

  if (guarded) {
    const unlock = await checkUnlocked(guarded);
    if (unlock.required && !unlock.unlocked) {
      return <UnlockGate kind="mirror" identifier={token} />;
    }
  }

  // ② Access control
  const visitorCookie = await getVisitorCookie();
  const visitorIp = await extractVisitorIp();
  const accessResult = await checkAccess(token, visitorCookie, visitorIp);

  if (!accessResult.allowed) {
    if (accessResult.reason === 'not_found') {
      notFound();
    }
    return <ExpiredPage reason={accessResult.reason} />;
  }

  const share = accessResult.share;

  // ③ Fetch mirror data
  const [item] = await db
    .select()
    .from(contentItems)
    .where(eq(contentItems.id, share.contentItemId))
    .limit(1);
  if (!item) notFound();

  const platform = item.platform as Platform;
  const isYouTube = platform === 'youtube';

  const author = item.author as {
    name: string;
    handle: string;
    avatarUrl?: string;
  };

  const proxyAvatar = (url: string | undefined) =>
    url ? `/api/proxy-avatar?url=${encodeURIComponent(url)}` : undefined;

  const stats = item.stats as EngagementStats | null;

  // 失效倒计时
  const expiresAt = share.expiresAt ? new Date(share.expiresAt) : null;
  const daysLeft = expiresAt
    ? Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : null;

  // Translation availability — true when DeepL key is configured
  const deeplKey = await getSetting('deepl_api_key');
  const translationAvailable = Boolean(deeplKey);

  // ── YouTube 沉浸式布局（方案 B）──
  if (isYouTube) {
    return (
      <Recorder contentItemId={item.id} shareId={share.id} visitorId={visitorCookie ?? 'anonymous'}>
        <div data-platform="youtube" className="relative flex min-h-screen flex-col bg-paper text-ink">
          <PageBackground intensity="subtle" />
          <ShareHeader platform="youtube" />

          <div className="relative mx-auto flex w-full max-w-[800px] flex-1 flex-col px-4 pb-8 md:px-0">
            <div
              data-track-block="video"
              className="relative mt-4 overflow-hidden rounded-xl shadow-lg ring-1 ring-border/50 md:mt-6"
            >
              <ShareViaBadge />
              <Suspense fallback={<VideoPreparing />}>
                <VideoSection token={token} contentItemId={item.id} platform="youtube" />
              </Suspense>
            </div>

            <PageTranslationShell translationAvailable={translationAvailable}>
              {item.title && <TranslatedTitleUpdater title={item.title} />}
              <div data-track-block="body" className="mt-5">
                {item.title && (
                  <h1 className="font-display text-xl font-bold leading-snug tracking-tight text-ink md:text-[1.35rem]">
                    {item.title}
                  </h1>
                )}

                <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border/40 pb-4">
                  <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
                    {stats && <span>{formatYouTubeViews(stats.views)}</span>}
                    {item.publishedAt && (
                      <>
                        {stats && <span className="text-border">·</span>}
                        <span>
                          {item.publishedAt.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })}
                        </span>
                      </>
                    )}
                  </div>
                  {stats && <YouTubeActions stats={stats} />}
                </div>

                <SurfaceCard className="mt-4 flex items-center gap-3 p-4">
                  {author.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={proxyAvatar(author.avatarUrl)}
                      alt={author.name}
                      className="h-11 w-11 rounded-full ring-2 ring-border/60"
                    />
                  ) : (
                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-[#ff5252] to-[#ff0000] text-sm font-bold text-white ring-2 ring-border/40">
                      {author.name.charAt(0)}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-ink">{author.name}</div>
                    <div className="truncate text-xs text-muted">{author.handle}</div>
                  </div>
                  <span className="hidden rounded-pill bg-ink px-4 py-2 text-[13px] font-semibold text-paper sm:inline">
                    订阅
                  </span>
                </SurfaceCard>

                {item.body && <DescriptionCollapse text={item.body} />}
              </div>

              <div data-track-block="comments">
                <CommentsSection>
                  <Suspense fallback={<CommentsSkeleton />}>
                    <CommentList contentItemId={item.id} />
                  </Suspense>
                </CommentsSection>
              </div>
            </PageTranslationShell>

            <footer className="mt-10 border-t border-border/60 pt-5">
              <SiteMetaLinks className="text-[13px]" />
            </footer>
          </div>

          {daysLeft !== null && daysLeft > 0 && (
            <ShareExpiryStrip daysLeft={daysLeft} sourceUrl={item.sourceUrl} />
          )}
        </div>
      </Recorder>
    );
  }

  // ── X / Twitter 标准布局（方案 A/C）──
  return (
    <Recorder contentItemId={item.id} shareId={share.id} visitorId={visitorCookie ?? 'anonymous'}>
      <div data-platform="x" className="relative min-h-screen bg-paper text-ink">
        <PageBackground intensity="subtle" />
        <ShareHeader platform="x" />

        <div className="relative mx-auto max-w-[1100px] px-4 pb-12 md:px-6">
          <div className="flex justify-center py-6 md:py-10">
            <div className="w-full max-w-[600px]">
              {daysLeft !== null && daysLeft > 0 && (
                <ShareAccessBanner daysLeft={daysLeft} createdBy={item.createdBy ?? 'admin'} />
              )}

              <PageTranslationShell translationAvailable={translationAvailable}>
                {item.title && <TranslatedTitleUpdater title={item.title} />}
                <div data-track-block="body">
                  <SurfaceCard className="overflow-hidden shadow-md">
                    <div className="p-5 md:p-6">
                      <div className="flex items-start gap-3">
                        {author.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={proxyAvatar(author.avatarUrl)}
                            alt={author.name}
                            className="h-11 w-11 shrink-0 rounded-full ring-2 ring-border/60 md:h-12 md:w-12"
                          />
                        ) : (
                          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand to-brand-dark text-lg font-bold text-white ring-2 ring-brand/20 md:h-12 md:w-12">
                            {author.name.charAt(0)}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="text-[15px] font-bold text-ink">{author.name}</div>
                          <div className="text-[13px] text-muted">@{author.handle}</div>
                        </div>
                        <span className="shrink-0 opacity-90">{X_LOGO}</span>
                      </div>

                      <TranslatedBody
                        text={item.body}
                        className="mt-4 text-[15px] leading-[1.65] text-ink"
                      />

                      <div data-track-block="gallery">
                        <Suspense fallback={<GallerySkeleton />}>
                          <MediaGallery contentItemId={item.id} />
                        </Suspense>
                      </div>

                      <div data-track-block="video" className="mt-4">
                        <Suspense fallback={<VideoPreparing />}>
                          <VideoSection token={token} contentItemId={item.id} />
                        </Suspense>
                      </div>

                      {item.publishedAt && (
                        <div className="mt-4 text-[12px] text-subtle">
                          {item.publishedAt.toLocaleString('zh-CN', {
                            year: 'numeric',
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </div>
                      )}
                    </div>

                    {stats ? (
                      <div className="border-t border-border/60 bg-surface-2/35 px-5 py-3 md:px-6">
                        <StatsBar platform={platform} stats={stats} />
                      </div>
                    ) : null}
                  </SurfaceCard>

                  {item.sourceUrl && (
                    <a
                      href={item.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-link-context="original_post"
                      className="ds-btn-primary mt-4 flex w-full items-center justify-center gap-2 py-3.5 text-center shadow-brand"
                    >
                      在 X 查看原文
                      <span aria-hidden="true">↗</span>
                    </a>
                  )}
                </div>

                <div data-track-block="comments">
                  <CommentsSection>
                    <Suspense fallback={<CommentsSkeleton />}>
                      <CommentList contentItemId={item.id} />
                    </Suspense>
                  </CommentsSection>
                </div>
              </PageTranslationShell>

              <div className="mt-6 xl:hidden">
                <MirrorSidebar
                  createdBy={item.createdBy ?? 'admin'}
                  platform="X / Twitter"
                  fetchedAt={item.fetchedAt ? item.fetchedAt.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' }) : undefined}
                  floating={false}
                />
              </div>

              <footer className="mt-10 border-t border-border/60 pt-5">
                <SiteMetaLinks className="text-[13px]" />
              </footer>
            </div>
          </div>
        </div>

        <div className="hidden xl:block">
          <MirrorSidebar
            createdBy={item.createdBy ?? 'admin'}
            platform="X / Twitter"
            fetchedAt={item.fetchedAt ? item.fetchedAt.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' }) : undefined}
            floating={true}
          />
        </div>
      </div>
    </Recorder>
  );
}

// ── 工具函数 ──

/** 格式化 YouTube 观看数：1234 → 1234，12000 → 1.2万，120000 → 12万 */
function formatYouTubeViews(views: number | undefined): string {
  if (!views) return '';
  if (views >= 10000) {
    return `${(views / 10000).toFixed(1).replace('.0', '')}万次观看`;
  }
  return `${views.toLocaleString()}次观看`;
}
