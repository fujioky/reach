'use client';

// app/admin/(shell)/_components/MobileNav.tsx
// 移动端导航：top bar 里的汉堡按钮 + 左侧滑出抽屉（复用服务端渲染的
// AdminSidebar 节点，登出 server action 原样可用）。路由变化自动收起。
//
// 抽屉必须 portal 到 body：顶栏的 backdrop-blur 会把祖先变成 fixed 定位的
// 包含块，否则「全屏」抽屉被困在顶栏内部。
//
// 动画：面板 translate-x 滑入滑出 + 遮罩淡入淡出。open 控制挂载，shown
// 控制过渡状态 —— 挂载后下一帧才置 shown，保证入场过渡能触发；关闭先播
// 过渡再延迟卸载。

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';

const TRANSITION_MS = 220;

export function MobileNav({ sidebar }: { sidebar: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pathname = usePathname();

  const openDrawer = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setOpen(true);
  };

  const closeDrawer = () => {
    setShown(false);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      setOpen(false);
      closeTimer.current = null;
    }, TRANSITION_MS);
  };

  // 挂载后下一帧再置 shown，入场过渡才会播放
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, [open]);

  // 路由变化自动收起
  useEffect(() => {
    if (open) closeDrawer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // 打开时锁定背景滚动；卸载时清理关闭定时器
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);
  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={openDrawer}
        className="flex h-9 w-9 items-center justify-center rounded-md text-ink transition-colors hover:bg-surface-2"
        aria-label="打开导航"
        aria-expanded={open}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {open &&
        createPortal(
          <div className="fixed inset-0 z-50 md:hidden">
            <div
              className={`absolute inset-0 bg-black/45 transition-opacity duration-200 ease-out ${
                shown ? 'opacity-100' : 'opacity-0'
              }`}
              onClick={closeDrawer}
              aria-hidden="true"
            />
            <div
              className={`absolute inset-y-0 left-0 flex w-[228px] max-w-[82vw] shadow-2xl transition-transform duration-200 ease-out ${
                shown ? 'translate-x-0' : '-translate-x-full'
              }`}
            >
              {sidebar}
            </div>
            <button
              type="button"
              onClick={closeDrawer}
              className={`absolute left-[240px] top-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white transition-opacity duration-200 ${
                shown ? 'opacity-100' : 'opacity-0'
              }`}
              aria-label="关闭导航"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}
