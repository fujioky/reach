// app/layout.tsx — 根布局
//
// 设计系统接入点（D-81/D-82/D-74）：
//   - next/font 加载 Space Grotesk + Noto Sans SC，CSS 变量注入 <html>
//   - globals.css 导入 Tailwind v4 + Reach 品牌 token
//   - ThemeInitScript 在 hydration 前设置 <html class="dark">（防 FOUC）
//
// 注意：旧的 maxWidth:720 + system-ui 字体已移除。各页面自行控制布局宽度。
// 字体通过 CSS 变量 --font-grotesk / --font-noto 在 globals.css @theme 中
// 映射为 --font-display / --font-sans，Tailwind font-display / font-sans 工具类可用。

import type { Metadata, Viewport } from 'next';
import { grotesk, noto } from '@/lib/fonts';
import { ThemeInitScript } from '@/app/_components/theme/ThemeInitScript';
import { ServiceWorkerRegister } from '@/app/_components/pwa/ServiceWorkerRegister';
import '@/app/globals.css';

/**
 * Base for resolving relative URLs in metadata (article OpenGraph images are
 * in-app paths like /api/article-media/<id>.jpg). Without it Next resolves
 * against localhost and warns on every build.
 */
function resolveSiteUrl(): URL {
  const configured =
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : null);
  try {
    return new URL(configured ?? 'http://localhost:3000');
  } catch {
    return new URL('http://localhost:3000');
  }
}

export const metadata: Metadata = {
  metadataBase: resolveSiteUrl(),
  title: 'Reach — 所不及者，可达于人',
  description:
    'Reach 化不可及之章为可传之链 — 文、图、影、评，俱存可览。',
  applicationName: 'Reach',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'Reach',
    statusBarStyle: 'default',
  },
  icons: {
    icon: '/icon.svg',
    apple: '/icon.svg',
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#5b4fe9' },
    { media: '(prefers-color-scheme: dark)', color: '#8b82ff' },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="zh-CN"
      className={`${grotesk.variable} ${noto.variable}`}
      suppressHydrationWarning
    >
      <head>
        <ThemeInitScript />
      </head>
      <body className="bg-paper text-ink font-sans antialiased">
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
