// lib/fonts.ts — Reach 品牌字体配置（D-82）
//
// Space Grotesk：标题 / 品牌 / 数字（拉丁字符）
// Noto Sans SC 思源黑体：正文 / 中文界面文字（拉丁字符回退到 Grotesk）
//
// 通过 next/font/google 加载，Next.js 内置字体优化（无 CLS、自动 subset、
// 自托管字体文件）。CSS 变量 --font-grotesk / --font-noto 注入到 <html>，
// 在 globals.css 的 @theme 中映射为 --font-display / --font-sans。
//
// 参考：https://nextjs.org/docs/app/building-your-application/optimizing/fonts

import { Space_Grotesk, Noto_Sans_SC } from 'next/font/google';

export const grotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-grotesk',
  display: 'swap',
});

export const noto = Noto_Sans_SC({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-noto',
  display: 'swap',
});
