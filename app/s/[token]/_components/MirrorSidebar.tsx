'use client';

// app/s/[token]/_components/MirrorSidebar.tsx — 可折叠的「关于此镜像」侧边栏
//
// floating=true（宽屏 xl:）：fixed 定位在容器右边框外侧，不影响正文居中。
// floating=false（窄屏）：静态定位，放在正文下面、footer 上面。

import { useState } from 'react';

interface MirrorSidebarProps {
  createdBy: string;
  platform: string;
  fetchedAt?: string;
  floating?: boolean;
}

export function MirrorSidebar({ createdBy, platform, fetchedAt, floating = false }: MirrorSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);

  // 容器 max-w-[1100px] 居中，右边框在 50% + 550px 处
  // 侧边栏宽 230px，贴右边框外侧：left = calc(50% + 550px)
  const floatingClass = floating
    ? 'fixed bottom-8 z-20'
    : '';
  const floatingStyle = floating
    ? { left: 'calc(50% + 550px)' }
    : undefined;

  if (collapsed) {
    return (
      <aside
        className={`${floatingClass} ds-card flex w-12 flex-shrink-0 cursor-pointer flex-col items-center bg-surface/90 py-4 backdrop-blur-sm`}
        style={floatingStyle}
        onClick={() => setCollapsed(false)}
        title="展开侧边栏"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-subtle">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        <span className="mt-2 text-[10px] font-bold uppercase tracking-wider text-subtle [writing-mode:vertical-rl]">
          关于
        </span>
      </aside>
    );
  }

  return (
    <aside
      className={`${floatingClass} ds-card flex w-[240px] flex-shrink-0 flex-col bg-surface/90 px-5 py-6 backdrop-blur-sm`}
      style={floatingStyle}
    >
      <div className="flex items-center justify-between">
        <div className="ds-section-label">关于</div>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          className="text-subtle transition-colors hover:text-ink"
          title="收起侧边栏"
          aria-label="收起侧边栏"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      <div className="mt-4 space-y-3 text-[13px] leading-relaxed">
        <div className="rounded-md bg-surface-2/80 px-3 py-2.5">
          <div className="text-[11px] text-subtle">分享者</div>
          <div className="mt-0.5 font-semibold text-ink">@{createdBy}</div>
        </div>
        <div className="rounded-md bg-surface-2/80 px-3 py-2.5">
          <div className="text-[11px] text-subtle">平台</div>
          <div className="mt-0.5 font-semibold text-ink">{platform}</div>
        </div>
        {fetchedAt && (
          <div className="rounded-md bg-surface-2/80 px-3 py-2.5">
            <div className="text-[11px] text-subtle">抓取于</div>
            <div className="mt-0.5 font-medium text-ink">{fetchedAt}</div>
          </div>
        )}
      </div>

      <div className="mt-auto pt-5 text-[12px] leading-relaxed text-muted">
        <div className="border-t border-border/60 pt-4">
          内容已镜像至 Reach，原平台不可达时仍可查看。
        </div>
      </div>
    </aside>
  );
}
