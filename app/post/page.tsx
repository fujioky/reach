// app/post/page.tsx
// Public article archive.
//
// Lives at /post while individual articles stay at /p/<slug> — the archive is a
// browsing surface, an article is the thing being linked to. Only articles with
// `listed` set appear here; an unlisted one is still fully readable at its own
// URL, it just isn't advertised.

import Link from 'next/link';
import type { Metadata } from 'next';

import { PageBackground } from '@/app/_components/layout/PageBackground';
import { PublicHeader } from '@/app/_components/layout/PublicHeader';
import { PublicFooter } from '@/app/_components/layout/PublicFooter';
import { SectionHeader } from '@/app/_components/ui/SectionHeader';
import { listPublishedArticles } from '@/lib/article/queries';
import { countVisibleComments } from '@/lib/article/comments';
import { deriveExcerpt, estimateReadingMinutes, firstImageUrl } from '@/lib/article/markdown';
import { readPasswordMode } from '@/lib/content/password';
import { responsiveImage, SIZES } from '@/lib/article/image-srcset';
import { findGatedMediaIds, signMediaUrls } from '@/lib/article/media-url';

export const metadata: Metadata = {
  title: '文章 — Reach',
  description: '本站作者撰写的文章。',
};

/**
 * The index is prerendered and invalidated on publish and on new comments
 * (revalidatePath). This interval is only the safety net for a revalidation
 * that never fired — e.g. a row edited outside the app.
 */
export const revalidate = 300;

const NAV_LINKS = [{ href: '/post', label: '文章' }];

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export default async function ArticleIndexPage() {
  const articles = await listPublishedArticles();
  const commentCounts = await countVisibleComments(articles.map((a) => a.id));

  // Cover thumbnails need the same access token the article body gets. The
  // archive revalidates every 5 min, far inside a token's 6h lifetime.
  const gated = await findGatedMediaIds(
    ...articles.flatMap((a) => [a.coverImageUrl, a.body]),
  );

  return (
    <main className="relative flex min-h-screen flex-col bg-paper text-ink">
      <PageBackground intensity="subtle" />
      <PublicHeader navLinks={NAV_LINKS} />

      <div className="relative mx-auto w-full max-w-[860px] flex-1 px-5 pb-16 pt-10 md:px-6 md:pt-14">
        <SectionHeader label="文章" title="所思所记" description="本站作者撰写，长期可读。" />

        {articles.length === 0 ? (
          <p className="mt-10 rounded-xl border border-border bg-surface/60 px-5 py-10 text-center text-sm text-muted">
            还没有发布的文章。
          </p>
        ) : (
          <ul className="mt-9 flex flex-col divide-y divide-border">
            {articles.map((article) => {
              // A protected article still lists (that's what `listed` is for),
              // but shows only its title — the excerpt and cover are content.
              const locked = readPasswordMode(article.passwordMode) !== 'none';
              const rawCover = locked
                ? null
                : (article.coverImageUrl ?? firstImageUrl(article.body));
              const cover = rawCover ? signMediaUrls(rawCover, gated) : null;
              const commentCount = commentCounts.get(article.id) ?? 0;
              return (
                <li key={article.id} className="py-6 first:pt-0">
                  <Link href={`/p/${article.slug}`} className="group flex gap-5">
                    <div className="min-w-0 flex-1">
                      <h2 className="flex items-center gap-2 font-display text-lg font-bold leading-snug text-ink transition-colors group-hover:text-brand md:text-xl">
                        {article.title}
                        {locked && (
                          <span
                            title="需要密码"
                            className="inline-flex shrink-0 text-subtle"
                            aria-label="需要密码"
                          >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <rect x="4" y="10" width="16" height="11" rx="2" />
                              <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                            </svg>
                          </span>
                        )}
                      </h2>
                      <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted">
                        {locked ? '此内容需要密码' : article.excerpt || deriveExcerpt(article.body)}
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-subtle">
                        <time
                          dateTime={(article.publishedAt ?? article.createdAt).toISOString()}
                        >
                          {formatDate(article.publishedAt ?? article.createdAt)}
                        </time>
                        <span className="text-border">·</span>
                        <span>约 {estimateReadingMinutes(article.body)} 分钟</span>
                        {commentCount > 0 && (
                          <>
                            <span className="text-border">·</span>
                            <span>{commentCount} 条评论</span>
                          </>
                        )}
                      </div>
                    </div>

                    {cover && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        {...responsiveImage(cover, SIZES.thumb)}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="hidden h-[86px] w-[130px] shrink-0 rounded-md object-cover ring-1 ring-border/70 transition-opacity group-hover:opacity-90 sm:block"
                      />
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <PublicFooter note="文章由本站作者撰写" />
    </main>
  );
}
