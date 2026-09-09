// app/page.tsx — Landing 首页（D-77）

import Link from 'next/link';
import { ReachMark } from '@/app/_components/brand/ReachMark';
import { PageBackground } from '@/app/_components/layout/PageBackground';
import { PageContainer } from '@/app/_components/layout/PageContainer';
import { PublicFooter } from '@/app/_components/layout/PublicFooter';
import { PublicHeader } from '@/app/_components/layout/PublicHeader';
import { SectionHeader } from '@/app/_components/ui/SectionHeader';
import { SurfaceCard } from '@/app/_components/ui/SurfaceCard';

const STEPS = [
  {
    num: '01',
    title: '投链',
    desc: '以源址入内署，系统自析其文，录其全貌。',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M10 13a5 5 0 0 1 7.07 0l1.41 1.41a5 5 0 0 1 0 7.07 5 5 0 0 1-7.07 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M14 11a5 5 0 0 0-7.07 0L5.52 12.41a5 5 0 0 0 0 7.07 5 5 0 0 0 7.07 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    num: '02',
    title: '成镜',
    desc: '影图落地而存，择评而录，约期、约次，阅毕可毁。',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" strokeWidth="1.8" />
        <path d="M8 12h8M12 8v8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    num: '03',
    title: '传之',
    desc: '授链于人，免登籍而可读；文影俱在，如临原处。',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M16 6l-4-4-4 4M12 2v13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
] as const;

const FEATURES = [
  {
    title: '衔链可览',
    desc: '友启链即见，无需登籍立户。',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M10 13a5 5 0 0 1 7.07 0l1.41 1.41a5 5 0 0 1 0 7.07" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    ),
  },
  {
    title: '完好存真',
    desc: '文、图、影、评并录，原佚犹可读。',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" />
        <path d="M10 9.5l4.5 2.5L10 14.5V9.5z" fill="currentColor" />
      </svg>
    ),
  },
  {
    title: '约界而传',
    desc: '限期、限次、阅毕即毁——仅达当见之人。',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
        <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
  },
] as const;

const NAV_LINKS = [
  { href: '/post', label: '其文' },
  { href: '/#features', label: '其要' },
  { href: '/#how-it-works', label: '其法' },
];

export default function LandingPage() {
  return (
    <main className="relative flex min-h-screen flex-col overflow-x-hidden bg-paper text-ink">
      <PageBackground intensity="full" />

      <PageContainer className="flex flex-1 flex-col">
        <PublicHeader navLinks={NAV_LINKS} loginLabel="入内署" />

        {/* Hero */}
        <section className="px-6 pb-16 pt-10 md:px-14 md:pb-20 md:pt-14">
          <div className="flex flex-col items-center gap-12 lg:flex-row lg:items-center lg:gap-16">
            <div className="flex-1 text-center lg:text-left">
              <span className="ds-pill-badge">
                <span className="h-1.5 w-1.5 animate-pulse rounded-pill bg-brand" />
                衔链而达 · 无需登籍
              </span>

              <h1 className="mt-6 font-display text-[2.5rem] font-bold leading-[1.12] tracking-tight text-ink sm:text-5xl lg:text-[3.25rem]">
                所不及者，
                <br />
                <span className="bg-gradient-to-r from-brand to-brand-dark bg-clip-text text-transparent">
                  可达于人
                </span>
              </h1>

              <p className="mx-auto mt-5 max-w-lg text-base leading-relaxed text-muted lg:mx-0 lg:text-[17px]">
                Reach 化不可及之章为可传之链 —
                文、图、影、评，俱存可览，不依原处。
              </p>

              <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start">
                <Link
                  href="/admin/login"
                  className="inline-flex w-full items-center justify-center rounded-md bg-brand px-6 py-3 text-sm font-semibold text-white shadow-brand-lg transition-colors hover:bg-brand-hover sm:w-auto"
                >
                  成第一镜
                </Link>
                <Link
                  href="/post"
                  className="flex items-center gap-1.5 text-sm font-medium text-ink transition-colors hover:text-brand"
                >
                  阅其文 <span aria-hidden="true">→</span>
                </Link>
              </div>
            </div>

            <div className="relative w-full max-w-[300px] shrink-0 lg:max-w-[320px]">
              <div className="absolute -inset-6 rounded-[3rem] bg-brand/15 blur-2xl" aria-hidden="true" />
              <PhonePreview />
            </div>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="scroll-mt-20 px-6 py-14 md:px-14">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-5">
            {FEATURES.map((f) => (
              <SurfaceCard key={f.title} interactive className="group p-5">
                <div className="ds-icon-box transition-colors group-hover:bg-brand group-hover:text-white">
                  {f.icon}
                </div>
                <h3 className="mt-4 text-base font-bold text-ink">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{f.desc}</p>
              </SurfaceCard>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section
          id="how-it-works"
          className="scroll-mt-20 rounded-t-[2rem] border-t border-border bg-gradient-to-b from-surface/50 to-surface px-6 py-14 md:px-14 md:py-16"
        >
          <SectionHeader
            label="其法"
            title="三步，达之于人"
            description="自源链以至可传之镜，皆成于内署。"
            className="max-w-xl"
          />

          <div className="relative mt-10 grid grid-cols-1 gap-5 md:grid-cols-3 md:gap-6">
            <div
              className="pointer-events-none absolute left-[16.67%] right-[16.67%] top-[2.75rem] hidden h-px bg-gradient-to-r from-transparent via-border to-transparent md:block"
              aria-hidden="true"
            />
            {STEPS.map((step) => (
              <SurfaceCard key={step.num} interactive className="relative p-6">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-md bg-brand text-white shadow-brand">
                    {step.icon}
                  </div>
                  <span className="font-display text-2xl font-bold text-border">{step.num}</span>
                </div>
                <h3 className="mt-5 text-base font-bold text-ink">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{step.desc}</p>
              </SurfaceCard>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="px-6 pb-6 pt-14 md:px-14">
          <div className="ds-cta-band md:px-12 md:py-12">
            <div
              className="pointer-events-none absolute inset-0 opacity-30"
              aria-hidden="true"
              style={{
                backgroundImage:
                  'radial-gradient(circle at 20% 50%, rgba(91,79,233,0.4) 0%, transparent 50%), radial-gradient(circle at 80% 50%, rgba(139,130,255,0.3) 0%, transparent 50%)',
              }}
            />
            <div className="relative">
              <ReachMark size={36} className="mx-auto text-brand-dark" />
              <h2 className="mt-4 font-display text-2xl font-bold text-white dark:text-ink md:text-3xl">
                可成第一镜乎？
              </h2>
              <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-white/70 dark:text-muted">
                入内署，投一链，片时可成可传之镜。
              </p>
              <Link
                href="/admin/login"
                className="mt-6 inline-flex items-center justify-center rounded-md bg-brand px-7 py-3 text-sm font-semibold text-white shadow-brand-lg transition-colors hover:bg-brand-hover"
              >
                入内署
              </Link>
            </div>
          </div>
        </section>

        <PublicFooter note="私传小众，勿广宣之" />
      </PageContainer>
    </main>
  );
}

function PhonePreview() {
  return (
    <div className="relative mx-auto w-full max-w-[280px]">
      <div className="rounded-[2.5rem] bg-ink p-2.5 shadow-brand-lg ring-1 ring-white/10 dark:bg-[#1a1a22]">
        <div className="absolute left-1/2 top-4 z-10 h-[22px] w-[90px] -translate-x-1/2 rounded-pill bg-ink dark:bg-[#1a1a22]" aria-hidden="true" />
        <div className="overflow-hidden rounded-[2rem] bg-surface">
          <div className="flex items-center gap-1.5 border-b border-border px-4 pb-3 pt-9">
            <ReachMark size={13} className="text-brand" />
            <span className="font-display text-[13px] font-bold text-ink">Reach</span>
            <span className="ml-auto rounded-pill bg-tint px-2 py-0.5 text-[9px] font-semibold text-brand-hover">一镜</span>
          </div>
          <div className="mx-3.5 mt-3 flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-2">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="shrink-0 text-brand" aria-hidden="true">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
              <path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <span className="text-[9px] font-medium text-ink">七日后失效</span>
          </div>
          <div className="p-3.5">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-full bg-gradient-to-br from-brand to-brand-dark" />
              <div>
                <div className="text-[11px] font-bold text-ink">陈墨</div>
                <div className="text-[10px] text-muted">@chenmo</div>
              </div>
            </div>
            <p className="mt-2.5 text-xs leading-relaxed text-ink">制器之难，不在多能，而在有所不为。</p>
            <div className="mt-2.5 grid grid-cols-2 gap-1 overflow-hidden rounded-md">
              <div className="aspect-[3/4] bg-gradient-to-br from-brand/25 via-tint to-brand-dark/20" />
              <div className="aspect-[3/4] bg-gradient-to-br from-brand-dark/15 via-surface-2 to-brand/20" />
            </div>
            <div className="mt-3 rounded-md bg-brand py-2 text-center text-[11px] font-semibold text-white shadow-brand">
              启览全文 ↗
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
