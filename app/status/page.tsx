import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import { PageBackground } from '@/app/_components/layout/PageBackground';
import { PublicFooter } from '@/app/_components/layout/PublicFooter';
import { PublicHeader } from '@/app/_components/layout/PublicHeader';
import { PageContainer } from '@/app/_components/layout/PageContainer';
import { ReachMark } from '@/app/_components/brand/ReachMark';
import { collectSystemHealth } from '@/lib/health/checks';
import { appendHealthSample, getHealthHistory } from '@/lib/health/history';
import { StatusDashboard } from './_components/StatusDashboard';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '系统状态 — Reach',
  description: 'Reach 服务健康状态与延迟趋势监控。',
};

function resolveSiteOrigin(headerList: Headers): string {
  const host = headerList.get('x-forwarded-host') ?? headerList.get('host');
  const proto = headerList.get('x-forwarded-proto') ?? 'https';
  if (host) return `${proto}://${host}`;
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')
  );
}

export default async function StatusPage() {
  const headerList = await headers();
  const origin = resolveSiteOrigin(headerList);
  const snapshot = await collectSystemHealth(origin, { publicLabels: true });
  await appendHealthSample(snapshot.services);
  const history = await getHealthHistory();

  return (
    <main className="relative flex min-h-screen flex-col bg-paper text-ink">
      <PageBackground intensity="subtle" />
      <PublicHeader />
      <PageContainer className="relative flex-1 py-10 md:py-14">
        <div className="mx-auto max-w-2xl">
          <div className="mb-8 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-tint">
              <ReachMark size={26} className="text-brand" />
            </div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-ink">系统状态</h1>
            <p className="mt-2 text-sm text-muted">公开服务可用性与延迟趋势</p>
          </div>

          <StatusDashboard
            initial={{
              version: snapshot.version,
              checkedAt: snapshot.checkedAt,
              services: snapshot.services,
              history,
            }}
          />

          <p className="mt-8 text-center text-xs text-subtle">
            <Link href="/" className="transition-colors hover:text-muted">
              返回首页
            </Link>
            {' · '}
            每 60 秒自动刷新
          </p>
        </div>
      </PageContainer>
      <PublicFooter note="Reach 系统状态" />
    </main>
  );
}