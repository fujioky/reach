import Link from 'next/link';
import { ReachMark } from '@/app/_components/brand/ReachMark';
import { PageBackground } from '@/app/_components/layout/PageBackground';
import { PublicFooter } from '@/app/_components/layout/PublicFooter';
import { PublicHeader } from '@/app/_components/layout/PublicHeader';
import { SurfaceCard } from '@/app/_components/ui/SurfaceCard';

const MESSAGES: Record<string, string> = {
  expired: '这个分享链接已过期。可以向分享者索取一个新的链接。',
  max_views: '这个分享链接的访问次数已达上限。可以向分享者索取一个新的链接。',
  max_visitors: '这个分享链接的访问人数已达上限。可以向分享者索取一个新的链接。',
  revoked: '这个分享链接已被撤销。可以向分享者索取一个新的链接。',
  burned: '这个分享链接的内容已销毁。可以向分享者索取一个新的链接。',
};

const FALLBACK_MESSAGE = '这个分享链接已过期或被撤销。可以向分享者索取一个新的链接。';

export function ExpiredPage({ reason }: { reason: string }) {
  const message = MESSAGES[reason] ?? FALLBACK_MESSAGE;

  return (
    <main className="relative flex min-h-screen flex-col bg-paper text-ink">
      <PageBackground intensity="subtle" />
      <PublicHeader showNav={false} loginLabel="管理登录" />

      <div className="relative flex flex-1 flex-col items-center justify-center px-6 py-16">
        <SurfaceCard className="w-full max-w-md px-8 py-10 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-tint">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" className="text-brand" aria-hidden="true">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
              <path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </div>

          <h1 className="mt-5 font-display text-xl font-bold text-ink">链接已失效</h1>
          <p className="mt-2.5 text-[13px] leading-relaxed text-muted">{message}</p>

          <div className="mt-7 flex items-center justify-center gap-2 opacity-60">
            <ReachMark size={18} className="text-brand" />
            <span className="font-display text-[15px] font-bold text-ink">Reach</span>
          </div>

          <Link href="/" className="ds-btn-primary mt-6 inline-flex text-sm">
            返回首页
          </Link>
        </SurfaceCard>
      </div>

      <PublicFooter />
    </main>
  );
}