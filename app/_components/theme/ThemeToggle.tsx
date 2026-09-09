'use client';

// app/_components/theme/ThemeToggle.tsx — 三档主题切换器（D-74）
//
// 亮 / 暗 / 跟随系统 三档循环切换。点击切换到下一档，更新 cookie +
// <html> class + 本地状态。图标用内联 SVG（太阳/月亮/自动）。
//
// 用法：<ThemeToggle /> — 默认小尺寸，适合放在 top bar / sidebar 底部

import { useState, useEffect, useCallback } from 'react';
import { THEME_COOKIE, THEME_MAX_AGE, type Theme } from '@/lib/theme';

const THEME_ORDER: Theme[] = ['light', 'dark', 'system'];

const THEME_LABELS: Record<Theme, string> = {
  light: '亮色',
  dark: '暗色',
  system: '跟随系统',
};

function SunIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </g>
    </svg>
  );
}

function MoonIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"
        fill="currentColor"
      />
    </svg>
  );
}

function SystemIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="4" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M8 21h8M12 17v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="10.5" r="2.5" fill="currentColor" />
    </svg>
  );
}

function ThemeIcon({ theme, size }: { theme: Theme; size: number }) {
  if (theme === 'light') return <SunIcon size={size} />;
  if (theme === 'dark') return <MoonIcon size={size} />;
  return <SystemIcon size={size} />;
}

type ThemeToggleProps = {
  size?: 'sm' | 'md';
  className?: string;
};

const SIZES = {
  sm: { icon: 14, pad: 'px-2 py-1.5', text: 'text-xs', gap: 'gap-1.5' },
  md: { icon: 16, pad: 'px-3 py-2', text: 'text-sm', gap: 'gap-2' },
} as const;

export function ThemeToggle({ size = 'md', className }: ThemeToggleProps) {
  const [theme, setTheme] = useState<Theme>('system');
  const [mounted, setMounted] = useState(false);

  // hydration 后从 cookie 读取当前主题
  useEffect(() => {
    setMounted(true);
    const match = document.cookie.match(
      new RegExp(`(?:^|; )${THEME_COOKIE}=([^;]+)`),
    );
    if (match) {
      const val = decodeURIComponent(match[1]);
      if (val === 'light' || val === 'dark' || val === 'system') {
        setTheme(val);
      }
    }
  }, []);

  const applyTheme = useCallback((next: Theme) => {
    const isDark =
      next === 'dark' ||
      (next === 'system' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches);
    const html = document.documentElement;
    if (isDark) {
      html.classList.add('dark');
    } else {
      html.classList.remove('dark');
    }
    html.setAttribute('data-theme', isDark ? 'dark' : 'light');
    // 持久化到 cookie（1 年）
    document.cookie = `${THEME_COOKIE}=${next}; max-age=${THEME_MAX_AGE}; path=/; samesite=lax`;
    setTheme(next);
  }, []);

  const toggle = useCallback(() => {
    const idx = THEME_ORDER.indexOf(theme);
    const next = THEME_ORDER[(idx + 1) % THEME_ORDER.length];
    applyTheme(next);
  }, [theme, applyTheme]);

  const s = SIZES[size];

  // hydration 前渲染占位（避免不匹配警告），保持相同尺寸
  if (!mounted) {
    return (
      <button
        type="button"
        disabled
        className={`inline-flex items-center ${s.gap} ${s.pad} ${s.text} rounded-sm border border-border text-muted cursor-default ${className ?? ''}`}
        aria-label="主题切换"
      >
        <ThemeIcon theme="system" size={s.icon} />
        <span>跟随系统</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className={`inline-flex items-center ${s.gap} ${s.pad} ${s.text} rounded-sm border border-border bg-surface text-muted transition-colors hover:text-ink hover:border-muted cursor-pointer ${className ?? ''}`}
      aria-label={`主题：${THEME_LABELS[theme]}，点击切换`}
      title={`主题：${THEME_LABELS[theme]}（点击切换）`}
    >
      <ThemeIcon theme={theme} size={s.icon} />
      <span>{THEME_LABELS[theme]}</span>
    </button>
  );
}
