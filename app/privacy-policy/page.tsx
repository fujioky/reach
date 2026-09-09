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
              What is collected when you visit a shared page or article, and how it is used.
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
                  <li>Is used solely to distinguish unique visitors for analytics and rate limiting</li>
                </ul>
              </PolicySection>

              <PolicySection title="Session Recording">
                <p>
                  Every visit to a shared page or article is recorded so the content admin can replay it later. The recording is a
                  snapshot of the page&apos;s DOM followed by its changes over time, captured with the open-source rrweb library. It includes:
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  <li>Mouse movement, scrolling, clicks and taps with their position on the page</li>
                  <li>Which parts of the page were visible and for how long</li>
                  <li>Image clicks, video play / pause / seek / progress / fullscreen, and outbound link clicks</li>
                  <li>
                    <strong>Text typed into the page</strong> — inputs are not masked, so anything entered in the comment form
                    (name, email, comment text) is part of the recording even if you never submit it
                  </li>
                </ul>
              </PolicySection>

              <PolicySection title="Session Metadata">
                <p>Alongside the recording, each visit stores:</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  <li>Your IP address and browser user agent</li>
                  <li>Screen size, viewport size, device pixel ratio and browser language</li>
                  <li>The referring page, if any</li>
                  <li>
                    An approximate location (country, region and city) derived from your IP address through a third-party
                    lookup service (ip.sb). The IP is sent to that service once per new address.
                  </li>
                  <li>Visit start time, total duration and event counts</li>
                </ul>
              </PolicySection>

              <PolicySection title="Comments">
                <p>
                  If you post a comment on an article, the name, optional email and comment text you submit are stored and the
                  name and text are shown publicly on the article. The email is visible only to the admin. A short arithmetic
                  challenge protects the form; it is verified on the server and stores nothing about you.
                </p>
              </PolicySection>

              <PolicySection title="What We Do Not Collect">
                <ul className="list-disc space-y-1 pl-5">
                  <li>No login or account information for visitors</li>
                  <li>No browsing history outside of this site</li>
                  <li>No advertising identifiers and no cross-site tracking</li>
                </ul>
              </PolicySection>

              <PolicySection title="Data Usage">
                <p>
                  The data is used solely by the content admin to understand how shared content is read: aggregated statistics,
                  click heatmaps and individual session replays in a private analytics dashboard. It is not sold or shared with
                  anyone else.
                </p>
              </PolicySection>

              <PolicySection title="Data Retention">
                <p>
                  Recordings, events and session metadata are kept until the admin deletes the shared content they belong to;
                  there is no automatic expiry. This is a personal small-scale tool. Contact the person who shared the link if you
                  want a visit removed.
                </p>
              </PolicySection>

              <PolicySection title="Third Parties">
                <ul className="list-disc space-y-1 pl-5">
                  <li>
                    <strong>Cloudflare Turnstile</strong> may run a bot check before a shared page opens; Cloudflare processes
                    your request under its own privacy policy.
                  </li>
                  <li>
                    <strong>ip.sb</strong> receives your IP address for the approximate-location lookup described above.
                  </li>
                  <li>
                    Images and videos may be served from an object storage or CDN provider chosen by the admin, which sees the
                    usual request metadata (IP address, user agent) when your browser loads them.
                  </li>
                  <li>No Google Analytics, Facebook Pixel or similar third-party ad tracking is used.</li>
                </ul>
              </PolicySection>

              <footer className="border-t border-border pt-6 text-[13px] text-muted">
                <p>Last updated: 2026-09-09.</p>
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