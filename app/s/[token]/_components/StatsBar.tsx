// app/s/[token]/_components/StatsBar.tsx
// Engagement stats bar — renders platform-appropriate metrics with icons.
//
// Twitter/X: replies (comments), retweets (reposts), likes, views, collects
// YouTube: likes, views, comments
//
// Icons are inline SVG (no icon library).
// Number formatting follows X/Twitter convention: 1.2K, 12K, 1.2M, 12M.
//
// This is a synchronous RSC component (no DB queries, no async) — rendered
// in the page shell alongside title/author/body for immediate first paint.

import type { Platform } from '@/lib/fetcher/types';
import type { EngagementStats } from '@/lib/fetcher/types';
import {
  ReplyIcon,
  RepostIcon,
  LikeIcon,
  ViewIcon,
  CollectIcon,
  YouTubeLikeIcon,
  YouTubeViewIcon,
} from './Icons';

/**
 * Format a number using X/Twitter conventions.
 *   < 1000     → as-is (e.g. 116, 277)
 *   < 10000    → 1.2K, 9.9K (one decimal)
 *   < 1000000  → 12K, 999K (no decimal — X drops it above 10K)
 *   ≥ 1000000  → 1.2M, 12M (one decimal)
 */
function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  if (n < 1000000) return Math.floor(n / 1000) + 'K';
  return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
}

function StatItem({
  icon,
  count,
  label,
}: {
  icon: React.ReactNode;
  count: number;
  label: string;
}) {
  if (count === 0) return null;
  return (
    <span className="flex min-h-[28px] items-center gap-1.5 rounded-pill bg-surface px-2.5 py-1 text-[13px] text-muted ring-1 ring-border/40" aria-label={`${label}: ${count}`}>
      {icon}
      <span>{formatCount(count)}</span>
    </span>
  );
}

export function StatsBar({
  platform,
  stats,
}: {
  platform: Platform;
  stats: EngagementStats;
}) {
  if (platform === 'youtube') {
    // YouTube: likes, views, comments (no retweets/collects)
    return (
      <div className="stats-bar flex flex-wrap items-center gap-2 py-0.5">
        <StatItem
          icon={<YouTubeLikeIcon color="currentColor" />}
          count={stats.likes}
          label="点赞"
        />
        <StatItem
          icon={<YouTubeViewIcon color="currentColor" />}
          count={stats.views}
          label="观看"
        />
        <StatItem
          icon={<ReplyIcon color="currentColor" />}
          count={stats.comments}
          label="评论"
        />
      </div>
    );
  }

  // Twitter/X: replies, retweets, likes, views, collects
  return (
    <div className="stats-bar flex flex-wrap items-center gap-2 py-0.5">
      <StatItem
        icon={<ReplyIcon color="currentColor" />}
        count={stats.comments}
        label="留言"
      />
      <StatItem
        icon={<RepostIcon color="currentColor" />}
        count={stats.reposts}
        label="转发"
      />
      <StatItem
        icon={<LikeIcon color="currentColor" />}
        count={stats.likes}
        label="点赞"
      />
      <StatItem
        icon={<ViewIcon color="currentColor" />}
        count={stats.views}
        label="观看"
      />
      {stats.collects > 0 && (
        <StatItem
          icon={<CollectIcon color="currentColor" />}
          count={stats.collects}
          label="收藏"
        />
      )}
    </div>
  );
}
