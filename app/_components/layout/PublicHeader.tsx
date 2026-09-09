import Link from 'next/link';
import { ReachMarkWordmark } from '@/app/_components/brand/ReachMark';
import { ThemeToggle } from '@/app/_components/theme/ThemeToggle';

export type PublicNavLink = { href: string; label: string };

const DEFAULT_LINKS: PublicNavLink[] = [
  { href: '/#features', label: '其要' },
  { href: '/#how-it-works', label: '其法' },
];

export function PublicHeader({
  navLinks = DEFAULT_LINKS,
  showNav = true,
  loginLabel = '管理登录',
}: {
  navLinks?: PublicNavLink[];
  showNav?: boolean;
  loginLabel?: string;
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-border/60 bg-paper/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1120px] items-center justify-between gap-4 px-6 py-4 md:px-10">
        <Link href="/" className="shrink-0 transition-opacity hover:opacity-80">
          <ReachMarkWordmark size="md" />
        </Link>
        <div className="flex items-center gap-2 sm:gap-3">
          {showNav && (
            <div className="hidden items-center gap-1 md:flex">
              {navLinks.map((link) => (
                <a key={link.href} href={link.href} className="ds-ghost-nav">
                  {link.label}
                </a>
              ))}
            </div>
          )}
          <ThemeToggle size="sm" className="hidden sm:inline-flex" />
          <Link
            href="/admin/login"
            className="rounded-sm bg-ink px-4 py-2 text-sm font-medium text-paper transition-opacity hover:opacity-90"
          >
            {loginLabel}
          </Link>
        </div>
      </div>
    </header>
  );
}