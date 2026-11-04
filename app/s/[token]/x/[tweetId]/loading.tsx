// app/s/[token]/x/[tweetId]/loading.tsx
// Shown the moment a reader opens a post from the thread. The first open of a
// post fetches it from X, which takes a few seconds; without this the click
// looks like it did nothing.

import { PageBackground } from '@/app/_components/layout/PageBackground';
import { SurfaceCard } from '@/app/_components/ui/SurfaceCard';
import { ShareHeader } from '../../_components/ShareChrome';
import { CommentsSkeleton } from '../../_components/Skeletons';

export default function Loading() {
  return (
    <div data-platform="x" className="relative min-h-screen bg-paper text-ink">
      <PageBackground intensity="subtle" />
      <ShareHeader platform="x" />
      <div className="relative mx-auto max-w-[720px] px-4 pb-12 pt-6 md:pt-10">
        <SurfaceCard className="p-5 shadow-md md:p-6">
          <div className="flex items-center gap-2.5 text-sm text-muted">
            <span
              aria-hidden="true"
              className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-brand border-r-transparent"
            />
            正在打开帖子…第一次打开要从 X 抓取，需要几秒
          </div>
          <div className="mt-5 space-y-2.5" aria-hidden="true">
            <div className="h-4 w-11/12 animate-pulse rounded bg-surface-2" />
            <div className="h-4 w-4/5 animate-pulse rounded bg-surface-2" />
            <div className="h-4 w-2/3 animate-pulse rounded bg-surface-2" />
          </div>
        </SurfaceCard>
        <div className="mt-5">
          <CommentsSkeleton />
        </div>
      </div>
    </div>
  );
}
