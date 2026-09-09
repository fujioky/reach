// app/p/[slug]/page.tsx
// Public article page.
//
// Unlike a mirror at /s/<token>, this URL is stable and public: no access
// control, no expiry, indexable. Drafts are simply not found here — the admin
// previews them inside the editor.
//
// Layout: a centered reading column with the outline floating to its left on
// wide screens. The column is the fixed element — the outline is placed in the
// gutter that's left over, so it can disappear below xl without the article
// shifting a pixel.

import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';

import { PageBackground } from '@/app/_components/layout/PageBackground';
import { PublicHeader } from '@/app/_components/layout/PublicHeader';
import { PublicFooter } from '@/app/_components/layout/PublicFooter';
import { ArticleBody } from '@/app/_components/article/ArticleBody';
import { ReadingProgress } from '@/app/_components/article/ReadingProgress';
import { TableOfContents } from '@/app/_components/article/TableOfContents';
import { getPublishedArticleBySlug, listPublishedArticles } from '@/lib/article/queries';
import { deriveExcerpt, estimateReadingMinutes } from '@/lib/article/markdown';
import { responsiveImage, SIZES } from '@/lib/article/image-srcset';
import { findGatedMediaIds, signArticleMedia, signMediaUrls } from '@/lib/article/media-url';
import { OG_IMAGE_TOKEN_TTL_MS } from '@/lib/article/media-token';
import { CommentSection } from '../_components/CommentSection';
import { checkUnlocked } from '@/lib/content/password';
import { UnlockGate } from '@/app/_components/content/UnlockGate';
import { turnstileGateRequired, turnstileSiteKey } from '@/lib/turnstile';
import { TurnstileGate } from '@/app/_components/content/TurnstileGate';
import { Recorder } from '@/app/_components/analytics/Recorder';
import { getVisitorCookie } from '@/lib/access/visitor';

const NAV_LINKS = [{ href: '/post', label: '文章' }];

/** DOM id the outline reads headings from. */
const BODY_ID = 'article-body';

/**
 * Percent-decode the route param before looking the slug up.
 *
 * Next hands dynamic segments over still encoded, so a non-ASCII slug arrives
 * as `%E6%B5%8B%E8%AF%951` and never matches the `测试1` in the database — the
 * article renders in the index and 404s when opened. New slugs are ASCII, so
 * this only matters for ones typed by hand or created before that changed, but
 * those must keep working: their URLs are already public.
 */
function decodeSlug(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw; // malformed escape sequence — let the lookup miss
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const article = await getPublishedArticleBySlug(decodeSlug(slug));
  if (!article) return { title: 'Reach' };

  // A protected article gives away nothing in its metadata — no title, no
  // excerpt, no preview image. Metadata is also what a crawler or a chat app's
  // link preview reads. Once the visitor is through the gate they get the real
  // title, same as the page they're looking at.
  const unlock = await checkUnlocked(article);
  if (unlock.required && !unlock.unlocked) return { title: '需要密码 — Reach' };

  const description = article.excerpt || deriveExcerpt(article.body);

  // A crawler arrives with no token, so the cover needs one embedded — and a
  // long-lived one, since the preview is cached far longer than a reading
  // session. See OG_IMAGE_TOKEN_TTL_MS.
  let ogImage = article.coverImageUrl;
  if (ogImage) {
    const gated = await findGatedMediaIds(ogImage);
    ogImage = signMediaUrls(ogImage, gated, OG_IMAGE_TOKEN_TTL_MS);
  }

  return {
    title: `${article.title} — Reach`,
    description,
    openGraph: {
      title: article.title,
      description,
      type: 'article',
      publishedTime: (article.publishedAt ?? article.createdAt).toISOString(),
      ...(ogImage ? { images: [ogImage] } : {}),
    },
  };
}

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = await getPublishedArticleBySlug(decodeSlug(slug));
  if (!article) notFound();

  // Turnstile 人机验证 — 拦在密码门之前，爬虫拿不到任何内容
  if (await turnstileGateRequired()) {
    return <TurnstileGate siteKey={turnstileSiteKey()} />;
  }

  // Password gate before anything else is rendered — title, author and excerpt
  // all stay behind it, since a preview would defeat locking the post.
  const unlock = await checkUnlocked(article);
  if (unlock.required && !unlock.unlocked) {
    return <UnlockGate kind="article" identifier={article.slug!} />;
  }

  const visitorCookie = await getVisitorCookie();

  const publishedAt = article.publishedAt ?? article.createdAt;
  const edited =
    article.updatedAt && article.updatedAt.getTime() - publishedAt.getTime() > 60_000
      ? article.updatedAt
      : null;
  const authorName = article.author?.name || '匿名';

  // Sign the URLs of any asset that isn't publicly shared. How the bytes are
  // then delivered (stream vs redirect to storage) is the route's decision, not
  // this page's — see /api/article-media.
  const [body, coverImageUrl] = await signArticleMedia(article.body, article.coverImageUrl);

  // 'hero' puts the cover behind the title block; 'above' (the default, and
  // what a null column means) keeps it as a band below the header.
  const heroCover = article.coverStyle === 'hero' ? coverImageUrl : null;

  // Two more posts to read next. Fetched here rather than in a child component
  // because it is a cheap query and the section is part of the page's shape.
  const others = (await listPublishedArticles(6))
    .filter((item) => item.id !== article.id)
    .slice(0, 2);

  return (
    <main className="relative flex min-h-screen flex-col bg-paper text-ink">
      <Recorder contentItemId={article.id} visitorId={visitorCookie ?? 'anonymous'} />
      <PageBackground intensity="subtle" />
      <ReadingProgress />
      <PublicHeader navLinks={NAV_LINKS} />

      <div className="relative mx-auto w-full max-w-[1160px] flex-1 px-5 md:px-8">
        <div className="flex justify-center gap-10">
          {/* Outline — sits in the leftover gutter, so the column never moves */}
          <aside className="hidden w-[210px] shrink-0 pt-16 xl:block">
            <TableOfContents containerId={BODY_ID} />
          </aside>

          <article className="w-full min-w-0 max-w-[700px] pb-16 pt-10 md:pt-14">
            <Link
              href="/post"
              className="inline-flex items-center gap-1.5 text-[13px] text-muted transition-colors hover:text-brand"
            >
              <span aria-hidden="true">←</span> 全部文章
            </Link>

            {heroCover ? (
              /* Hero: the cover sits behind the title block under a scrim.
                 The scrim is a bottom-weighted gradient rather than a flat
                 overlay — the text sits low, so darkening the whole image
                 would dull it for no gain. */
              <header className="relative mt-5 overflow-hidden rounded-xl">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  {...responsiveImage(heroCover, SIZES.hero)}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover"
                />
                <div
                  className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/55 to-black/25"
                  aria-hidden="true"
                />
                <div className="relative px-6 pb-7 pt-32 md:px-9 md:pb-9 md:pt-44">
                  <h1 className="font-display text-[2rem] font-bold leading-[1.22] tracking-tight text-white drop-shadow-sm md:text-[2.6rem]">
                    {article.title}
                  </h1>

                  {article.excerpt && (
                    <p className="mt-3 max-w-[46ch] text-[16px] leading-relaxed text-white/85">
                      {article.excerpt}
                    </p>
                  )}

                  <div className="mt-5 flex flex-wrap items-center gap-3">
                    <div
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/20 text-sm font-bold text-white backdrop-blur-sm"
                      aria-hidden="true"
                    >
                      {authorName.charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-white">{authorName}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] text-white/70">
                        <time dateTime={publishedAt.toISOString()}>{formatDate(publishedAt)}</time>
                        <span aria-hidden="true">·</span>
                        <span>约 {estimateReadingMinutes(article.body)} 分钟</span>
                        {edited && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{formatDate(edited)} 更新</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </header>
            ) : (
              <>
                <header className="mt-5">
                  <h1 className="font-display text-[2rem] font-bold leading-[1.22] tracking-tight text-ink md:text-[2.6rem]">
                    {article.title}
                  </h1>

                  {article.excerpt && (
                    <p className="mt-4 text-[17px] leading-relaxed text-muted">{article.excerpt}</p>
                  )}

                  <div className="mt-6 flex flex-wrap items-center gap-3 border-b border-border pb-6">
                    <div
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand to-brand-dark text-sm font-bold text-white"
                      aria-hidden="true"
                    >
                      {authorName.charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-ink">{authorName}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] text-subtle">
                        <time dateTime={publishedAt.toISOString()}>{formatDate(publishedAt)}</time>
                        <span aria-hidden="true">·</span>
                        <span>约 {estimateReadingMinutes(article.body)} 分钟</span>
                        {edited && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{formatDate(edited)} 更新</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </header>

                {coverImageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    {...responsiveImage(coverImageUrl, SIZES.column)}
                    alt=""
                    className="mt-8 aspect-[2/1] w-full rounded-xl object-cover shadow-md ring-1 ring-border/60"
                  />
                )}
              </>
            )}

            <div id={BODY_ID} data-track-block="body" className="mt-9">
              <ArticleBody markdown={body ?? article.body} />
            </div>

            {others.length > 0 && (
              <section className="mt-14 border-t border-border pt-8">
                <h2 className="text-[11px] font-bold uppercase tracking-wider text-subtle">
                  继续阅读
                </h2>
                <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                  {others.map((item) => (
                    <li key={item.id}>
                      <Link
                        href={`/p/${item.slug}`}
                        className="group block h-full rounded-lg border border-border bg-surface/60 p-4 transition-colors hover:border-brand/40 hover:bg-surface"
                      >
                        <div className="line-clamp-2 text-sm font-semibold leading-snug text-ink transition-colors group-hover:text-brand">
                          {item.title}
                        </div>
                        <div className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted">
                          {item.excerpt || deriveExcerpt(item.body, 80)}
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <div data-track-block="comments">
              <Suspense
                fallback={
                  <div className="mt-14 border-t border-border pt-10 text-sm text-muted">
                    评论加载中…
                  </div>
                }
              >
                <CommentSection
                  contentItemId={article.id}
                  slug={article.slug!}
                  commentsEnabled={article.commentsEnabled}
                />
              </Suspense>
            </div>
          </article>

          {/* Balances the outline so the column stays optically centered */}
          <div className="hidden w-[210px] shrink-0 xl:block" aria-hidden="true" />
        </div>
      </div>

      <PublicFooter note="文章由本站作者撰写" />
    </main>
  );
}
