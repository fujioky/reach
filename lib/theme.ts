// lib/theme.ts — 主题工具函数（D-74 三档切换）
//
// 三档：light / dark / system（跟随设备）
// 持久化：cookie 'theme'（SSR 可读，无 FOUC）
// 运行时：<html class="dark"> 切换（globals.css .dark 覆盖 token）
//
// 防 FOUC：app/layout.tsx 注入内联脚本，在 hydration 前根据 cookie +
// prefers-color-scheme 设置 class。ThemeToggle 客户端组件切换时更新
// cookie + class。

export type Theme = 'light' | 'dark' | 'system';

export const THEME_COOKIE = 'theme';
/** cookie 有效期 1 年 */
export const THEME_MAX_AGE = 60 * 60 * 24 * 365;

export const THEMES: Theme[] = ['light', 'dark', 'system'];

/**
 * 从 cookie 值解析主题。无效值回退到 'system'。
 */
export function parseTheme(value: string | undefined): Theme {
  if (value === 'light' || value === 'dark' || value === 'system') {
    return value;
  }
  return 'system';
}

/**
 * 判断某主题在当前系统偏好下是否应该应用暗色 class。
 * 'system' 需要结合 prefers-color-scheme（仅在客户端可知）。
 * SSR 时对 'system' 返回 false（亮色默认），内联脚本会在客户端修正。
 */
export function shouldUseDark(theme: Theme, prefersDark: boolean): boolean {
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return prefersDark; // system
}
