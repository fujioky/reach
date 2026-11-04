// app/admin/(shell)/mirrors/_components/ListPager.tsx
// Pagination for the content list: page links plus a page-size choice
// (50 / 100 / 200 / 全部). Plain links on ?page=&size=, so the list stays a
// server component and every page is addressable.

import Link from 'next/link';

export const PAGE_SIZES = [50, 100, 200] as const;
export type PageSize = (typeof PAGE_SIZES)[number] | 'all';

/** Read ?page=&size= and clamp the page into range. */
export function parsePageParams(
  params: { page?: string; size?: string },
  total: number,
): { page: number; size: PageSize; pageCount: number } {
  const size: PageSize =
    params.size === 'all'
      ? 'all'
      : (PAGE_SIZES.find((n) => String(n) === params.size) ?? PAGE_SIZES[0]);
  const pageCount = size === 'all' ? 1 : Math.max(1, Math.ceil(total / size));
  const page = Math.min(pageCount, Math.max(1, parseInt(params.page ?? '1', 10) || 1));
  return { page, size, pageCount };
}

function href(page: number, size: PageSize): string {
  const q = new URLSearchParams();
  if (page > 1) q.set('page', String(page));
  if (size !== PAGE_SIZES[0]) q.set('size', String(size));
  const s = q.toString();
  return s ? `/admin/mirrors?${s}` : '/admin/mirrors';
}

/** Page numbers to show: first, last, and two either side of the current one. */
function visiblePages(page: number, pageCount: number): Array<number | 'gap'> {
  const pages: Array<number | 'gap'> = [];
  for (let p = 1; p <= pageCount; p++) {
    if (p === 1 || p === pageCount || Math.abs(p - page) <= 2) pages.push(p);
    else if (pages[pages.length - 1] !== 'gap') pages.push('gap');
  }
  return pages;
}

export function ListPager({
  page,
  size,
  pageCount,
  total,
}: {
  page: number;
  size: PageSize;
  pageCount: number;
  total: number;
}) {
  const link = 'rounded-md px-2.5 py-1 transition-colors hover:bg-surface-2 hover:text-ink';
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
      <div className="flex items-center gap-1">
        <span className="mr-2">共 {total} 条</span>
        {pageCount > 1 &&
          visiblePages(page, pageCount).map((p, i) =>
            p === 'gap' ? (
              <span key={`gap-${i}`} className="px-1 text-subtle">
                …
              </span>
            ) : p === page ? (
              <span key={p} aria-current="page" className="rounded-md bg-brand/10 px-2.5 py-1 font-medium text-brand">
                {p}
              </span>
            ) : (
              <Link key={p} href={href(p, size)} className={link}>
                {p}
              </Link>
            ),
          )}
      </div>
      <div className="flex items-center gap-1">
        <span className="mr-1">每页</span>
        {[...PAGE_SIZES, 'all' as const].map((n) =>
          n === size ? (
            <span key={n} className="rounded-md bg-surface-2 px-2.5 py-1 font-medium text-ink">
              {n === 'all' ? '全部' : n}
            </span>
          ) : (
            <Link key={n} href={href(1, n)} className={link}>
              {n === 'all' ? '全部' : n}
            </Link>
          ),
        )}
      </div>
    </div>
  );
}
