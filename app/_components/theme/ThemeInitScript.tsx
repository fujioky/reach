// app/_components/theme/ThemeInitScript.tsx — 防 FOUC 主题初始化脚本（D-74）
//
// 在 <head> 内联执行，hydration 前根据 cookie + prefers-color-scheme
// 设置 <html class="dark">。避免暗色用户看到亮色闪烁。
//
// 脚本逻辑：
//   1. 读取 cookie 'theme'（light/dark/system，默认 system）
//   2. 如果 dark → 加 class
//   3. 如果 system → 检查 prefers-color-scheme: dark
//   4. 结果写入 <html> class + data-theme 属性（data-theme 供 CSS 备用）

import { THEME_COOKIE } from '@/lib/theme';

/**
 * 内联脚本字符串。用 dangerouslySetInnerHTML 注入到 <head>。
 * 必须是同步执行的纯 JS，不能用 React/TS 语法。
 */
export const themeInitScript = `(function(){try{var c=document.cookie.match(/(?:^|; )${THEME_COOKIE}=([^;]+)/);var t=c?decodeURIComponent(c[1]):'system';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var h=document.documentElement;if(d){h.classList.add('dark')}else{h.classList.remove('dark')}h.setAttribute('data-theme',d?'dark':'light')}catch(e){}})();`;

/**
 * 组件形式 — 渲染 <script> 标签到 <head>。
 */
export function ThemeInitScript() {
  return (
    <script
      // eslint-disable-next-line react/no-danger -- 防 FOUC 必须内联，无外部输入
      dangerouslySetInnerHTML={{ __html: themeInitScript }}
    />
  );
}
