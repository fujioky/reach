// ShareChrome — 分享页共用壳层（顶栏、访问提示、底部条）

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ReachMark } from '@/app/_components/brand/ReachMark';

const X_BADGE = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231z" />
  </svg>
);

const YT_BADGE = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M23 12s0-3.5-.4-5.2c-.3-1-1-1.7-2-2C18.8 4.5 12 4.5 12 4.5s-6.8 0-8.6.3c-1 .3-1.7 1-2 2C1 8.5 1 12 1 12s0 3.5.4 5.2c.3 1 1 1.7 2 2 1.8.3 8.6.3 8.6.3s6.8 0 8.6-.3c1-.3 1.7-1 2-2C23 15.5 23 12 23 12zM9.8 15.3V8.7l5.7 3.3z" />
  </svg>
);

export function ShareHeader({ platform }: { platform: 'x' | 'youtube' }) {
  const isX = platform === 'x';
  return (
    <header className="sticky top-0 z-30 border-b border-border/50 bg-paper/80 backdrop-blur-xl">
      <div className="mx-auto flex h-[3.25rem] max-w-[1100px] items-center justify-between px-4 md:px-6">
        <Link
          href="/"
          className="group flex items-center gap-2 rounded-md px-1 py-0.5 transition-colors hover:text-brand"
        >
          <ReachMark size={18} className="text-brand transition-transform group-hover:scale-105" />
          <span className="font-display text-[15px] font-bold tracking-tight text-ink">Reach</span>
        </Link>
        <span
          className="ds-pill-badge"
          style={isX ? { color: '#1d9bf0', borderColor: 'color-mix(in srgb, #1d9bf0 20%, transparent)', backgroundColor: 'color-mix(in srgb, #1d9bf0 8%, transparent)' } : { color: '#cc0000', borderColor: 'color-mix(in srgb, #cc0000 20%, transparent)', backgroundColor: 'color-mix(in srgb, #cc0000 8%, transparent)' }}
        >
          {isX ? X_BADGE : YT_BADGE}
          {isX ? '镜像自 X' : '镜像自 YouTube'}
        </span>
      </div>
    </header>
  );
}

export function ShareAccessBanner({
  daysLeft,
  createdBy,
}: {
  daysLeft: number;
  createdBy: string;
}) {
  return (
    <div className="ds-card mb-4 flex items-start gap-3 border-brand/15 bg-tint/40 px-4 py-3.5 shadow-sm">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
          <path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-ink">
          此分享链接 {daysLeft} 天后失效
        </div>
        <div className="mt-1 text-[12px] leading-relaxed text-muted">
          由 <span className="font-medium text-ink">@{createdBy}</span> 分享给你 · 免登录访问
        </div>
      </div>
    </div>
  );
}

export function ShareExpiryStrip({
  daysLeft,
  sourceUrl,
}: {
  daysLeft: number;
  sourceUrl?: string | null;
}) {
  return (
    <div className="sticky bottom-0 z-20 border-t border-border/60 bg-paper/85 px-4 py-3 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[800px] items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-tint text-brand">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
            <path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </span>
        <span className="flex-1 text-[12px] font-medium text-ink">
          链接 {daysLeft} 天后失效
        </span>
        {sourceUrl && (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-link-context="original_post"
            className="shrink-0 rounded-pill bg-brand px-3.5 py-1.5 text-[12px] font-semibold text-white shadow-brand transition-colors hover:bg-brand-hover"
          >
            查看原文 ↗
          </a>
        )}
      </div>
    </div>
  );
}

export function ShareViaBadge() {
  return (
    <div className="pointer-events-none absolute left-3 top-3 z-10 flex items-center gap-1.5 rounded-pill border border-white/20 bg-[#14121c]/60 px-3 py-1.5 shadow-lg backdrop-blur-md">
      <ReachMark size={14} className="text-brand-dark" />
      <span className="font-display text-[11px] font-semibold tracking-wide text-white/95">via Reach</span>
    </div>
  );
}

export function CommentsSection({ children }: { children: ReactNode }) {
  return (
    <section className="ds-card mt-5 overflow-hidden shadow-sm">
      <div className="border-b border-border/60 bg-surface-2/30 px-5 py-4">
        <span className="ds-section-label">评论</span>
        <h2 className="mt-1 font-display text-base font-bold tracking-tight text-ink">精选留言</h2>
      </div>
      <div className="px-5 pb-2">{children}</div>
    </section>
  );
}