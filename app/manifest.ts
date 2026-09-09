import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Reach — 把够不着的内容，递到朋友手里',
    short_name: 'Reach',
    description:
      'Reach 把够不着的帖子，镜像成一条朋友点开就能看的链接 — 正文、图片、视频、评论都完整保留。',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#fafaf8',
    theme_color: '#5b4fe9',
    lang: 'zh-CN',
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
    ],
  };
}