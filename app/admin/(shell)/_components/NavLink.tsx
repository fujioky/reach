'use client';

// app/admin/(shell)/_components/NavLink.tsx — 侧边栏导航项，支持 active 高亮
//
// 使用 usePathname 判断当前路由，active 时设置 aria-current="page"。
// Tailwind 的 aria-current: variant 对应高亮样式。

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface NavLinkProps {
  href: string;
  label: string;
  icon: React.ReactNode;
  /**
   * Sub-paths that belong to a sibling entry. Without this a list link like
   * /admin/articles also lights up on /admin/articles/new, so both rows in the
   * group look selected at once.
   */
  excludePrefixes?: string[];
}

export function NavLink({ href, label, icon, excludePrefixes }: NavLinkProps) {
  const pathname = usePathname();
  const isActive =
    href === '/admin'
      ? pathname === '/admin'
      : pathname.startsWith(href) &&
        !excludePrefixes?.some((prefix) => pathname.startsWith(prefix));

  return (
    <Link
      href={href}
      aria-current={isActive ? 'page' : undefined}
      className="flex items-center gap-3 border-l-2 border-transparent px-[22px] py-2.5 text-sm text-sidebar-muted transition-colors hover:bg-white/5 hover:text-white aria-current:bg-brand/14 aria-current:border-brand-dark aria-current:text-white aria-current:font-medium"
    >
      {icon}
      {label}
    </Link>
  );
}
