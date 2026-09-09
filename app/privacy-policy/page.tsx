import Link from 'next/link';
import { PageBackground } from '@/app/_components/layout/PageBackground';
import { PageContainer } from '@/app/_components/layout/PageContainer';
import { PublicFooter } from '@/app/_components/layout/PublicFooter';
import { PublicHeader } from '@/app/_components/layout/PublicHeader';
import { SurfaceCard } from '@/app/_components/ui/SurfaceCard';

export default function PrivacyPolicyPage() {
  return (
    <main className="relative flex min-h-screen flex-col bg-paper text-ink">
      <PageBackground intensity="subtle" />
      <PageContainer className="flex flex-1 flex-col">
        <PublicHeader showNav={false} loginLabel="管理登录" />

        <article className="flex-1 px-6 py-10 md:px-14 md:py-14">
          <div className="mx-auto max-w-[720px]">
            <div className="ds-section-label">Legal</div>
            <h1 className="mt-2 ds-page-heading">Privacy Policy</h1>
            <p className="ds-page-subtitle">
              What information is collected when you visit a shared content page and how it is used.
            </p>

            <SurfaceCard className="mt-8 space-y-8 p-6 md:p-8">
              <PolicySection title="Anonymous Visitor Identifier">
                <p>
                  When you visit a shared page, a random anonymous identifier (a visitor_id cookie) is set in your browser. This cookie:
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  <li>Is a randomly generated string (no personal information)</li>
                  <li>Is HttpOnly (not accessible via JavaScript)</li>
                  <li>Expires after 30 days</li>
                  <li>Is used solely to distinguish unique visitors for analytics</li>
                </ul>
              </PolicySection>

              <PolicySection title="Behavior We Record">
                <p>To help the content admin understand how shared content is engaged with, we record:</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  <li><strong>Page views</strong> — when you open a shared page</li>
                  <li><strong>Dwell time</strong> — how long each content section is visible</li>
                  <li><strong>Media interactions</strong> — image clicks and video play/pause</li>
                  <li><strong>Outbound link clicks</strong> — external link clicks</li>
                </ul>
              </PolicySection>

              <PolicySection title="What We Do Not Collect">
                <ul className="list-disc space-y-1 pl-5">
                  <li>No login or account information for visitors</li>
                  <li>No email addresses, names, or phone numbers</li>
                  <li>No precise location data</li>
                  <li>No browsing history outside of this site</li>
                </ul>
              </PolicySection>

              <PolicySection title="Data Usage">
                <p>
                  Behavioral data is used solely by the content admin to understand content engagement.
                  Data is aggregated and presented in an analytics dashboard.
                </p>
              </PolicySection>

              <PolicySection title="Data Retention">
                <p>
                  Behavioral events are stored indefinitely. This is a personal small-scale tool with minimal data volume.
                  Contact the person who shared the link if you have concerns.
                </p>
              </PolicySection>

              <PolicySection title="Third-Party Analytics">
                <p>
                  This site uses Vercel Web Analytics for aggregated page views and performance metrics.
                  No Google Analytics, Facebook Pixel, or similar third-party ad tracking is used.
                </p>
              </PolicySection>

              <footer className="border-t border-border pt-6 text-[13px] text-muted">
                <p>Last updated: 2026-06-27.</p>
                <Link href="/" className="mt-2 inline-block text-brand hover:text-brand-hover">
                  ← 返回首页
                </Link>
              </footer>
            </SurfaceCard>
          </div>
        </article>

        <PublicFooter note="Reach · 隐私政策" />
      </PageContainer>
    </main>
  );
}

function PolicySection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      <div className="mt-2 space-y-2 text-[15px] leading-relaxed text-muted">{children}</div>
    </section>
  );
}