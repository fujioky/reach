// app/s/[token]/_components/YouTubeActions.tsx — YouTube 互动按钮栏
//
// 镜像 YouTube 桌面端的 like/dislike 胶囊按钮 + 分享按钮样式。

import type { EngagementStats } from '@/lib/fetcher/types';

function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  if (n < 1000000) return Math.floor(n / 1000) + 'K';
  return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
}

const THUMB_UP = (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M18.77 11h-4.23l1.52-4.94C16.38 5.03 15.54 4 14.38 4c-.58 0-1.14.24-1.52.65L7 11H3v10h4h6h4.5c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2c0-1.1-.9-2-2-2z" />
  </svg>
);

const THUMB_DOWN = (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h4.23l-1.52 4.94C6.62 18.97 7.46 20 8.62 20c.58 0 1.14-.24 1.52-.65L17 13h4V3h-6z" />
  </svg>
);

const SHARE = (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M15 5.63 20.66 12 15 18.37V14h-1c-3.96 0-7.14 1-9.75 3.09 1.26-4.07 5.65-7.09 10.75-7.09h1V5.63z" />
  </svg>
);

export function YouTubeActions({ stats }: { stats: EngagementStats }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex h-9 items-stretch overflow-hidden rounded-full bg-[#f2f2f2] text-[#0f0f0f]">
        <button
          type="button"
          className="flex items-center gap-1.5 px-4 text-sm font-medium transition-colors hover:bg-[#e5e5e5]"
          aria-label={`点赞 ${stats.likes}`}
        >
          {THUMB_UP}
          <span className="tabular-nums">{formatCount(stats.likes)}</span>
        </button>
        <div className="w-px self-stretch bg-[#d9d9d9]" aria-hidden="true" />
        <button
          type="button"
          className="flex items-center px-4 transition-colors hover:bg-[#e5e5e5]"
          aria-label="踩"
        >
          {THUMB_DOWN}
        </button>
      </div>

      <button
        type="button"
        className="inline-flex h-9 items-center gap-2 rounded-full bg-[#f2f2f2] px-4 text-sm font-medium text-[#0f0f0f] transition-colors hover:bg-[#e5e5e5]"
      >
        {SHARE}
        <span>分享</span>
      </button>
    </div>
  );
}