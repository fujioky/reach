// app/admin/(shell)/layout.tsx
// Admin shell — 侧边栏 + top bar（D-20, D-70~D-73 重设计）。
//
// 桌面（≥md）：228px 深色侧边栏固定在左侧；
// 移动（<md）：侧边栏隐藏，top bar 汉堡按钮唤出抽屉（MobileNav 复用同一份
// AdminSidebar 渲染，登出 server action 不受影响）。
//
// Defense in depth: await auth() here (Node runtime) to verify the session
// in the database, even though proxy.ts already gated the request.

import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { PageBackground } from '@/app/_components/layout/PageBackground';
import { ThemeToggle } from '@/app/_components/theme/ThemeToggle';
import { AdminSidebar } from './_components/AdminSidebar';
import { MobileNav } from './_components/MobileNav';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect('/admin/login');
  }

  const username = session.user.name ?? '管理员';

  return (
    <div className="flex h-dvh overflow-hidden bg-paper font-sans">
      {/* ── 桌面侧边栏 — 固定视口高度，仅导航过长时内部滚动 ── */}
      <div className="hidden h-full shrink-0 md:block">
        <AdminSidebar username={username} />
      </div>

      {/* ── 主内容区 — 独立滚动，侧边栏保持固定 ── */}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <PageBackground intensity="subtle" />
        <header className="relative z-10 flex shrink-0 items-center justify-between border-b border-border/60 bg-paper/70 px-4 py-3 backdrop-blur-md md:justify-end md:px-8">
          <MobileNav sidebar={<AdminSidebar username={username} />} />
          <ThemeToggle size="sm" />
        </header>
        <main className="relative z-10 min-h-0 flex-1 overflow-y-auto p-4 sm:p-6 md:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
