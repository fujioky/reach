// lib/site.ts
// The public repositories behind this site, linked from the header, the footer
// and /about. The about page also renders each repository's README.

export const GITHUB_REPO_URL = 'https://github.com/fujioky/reach';
export const EXTENSION_REPO_URL = 'https://github.com/fujioky/reach-browser-extension';

export interface SiteRepo {
  /** Anchor id on /about and the short display name. */
  slug: string;
  name: string;
  url: string;
  role: string;
  description: string;
  /** Path of the README to render, relative to the repository root. */
  readmePath: string;
}

export const SITE_REPOS: SiteRepo[] = [
  {
    slug: 'reach',
    name: 'fujioky/reach',
    url: GITHUB_REPO_URL,
    role: '本站',
    description:
      'Reach 本体：Next.js 应用，负责镜像 X / YouTube 帖子、发布文章、分享链接与访客行为分析。',
    readmePath: 'README.md',
  },
  {
    slug: 'reach-upstream',
    name: 'fujioky/reach-upstream',
    url: 'https://github.com/fujioky/reach-upstream',
    role: '抓取端',
    description:
      'Reach 的抓取端：HTTP / MCP 代理，抓取 X、YouTube、小红书、Telegram 与网页内容并整理成统一结构，也可直接接入 Claude、ChatGPT。',
    readmePath: 'README.zh-CN.md',
  },
  {
    slug: 'reach-dlproxy',
    name: 'fujioky/reach-dlproxy',
    url: 'https://github.com/fujioky/reach-dlproxy',
    role: '视频通道',
    description: '视频转发 / 转存反向代理的参考实现（Go），给 Reach 提供带口令的上游取流通道。',
    readmePath: 'README.md',
  },
  {
    slug: 'reach-browser-extension',
    name: 'fujioky/reach-browser-extension',
    url: EXTENSION_REPO_URL,
    role: '浏览器扩展',
    description:
      'Chrome / Edge / Firefox 扩展：在 X / YouTube 页面一键生成 Reach 分享链接并复制，用管理员账号登录。',
    readmePath: 'README.md',
  },
];

/**
 * Fetch a repository README from GitHub and make it self-contained: relative
 * image sources become raw.githubusercontent.com URLs and relative links point
 * at the file on GitHub, so the Markdown renders the same here as it does on
 * the repository page. Returns null when GitHub cannot be reached.
 */
export async function fetchRepoReadme(repo: SiteRepo): Promise<string | null> {
  const repoPath = new URL(repo.url).pathname.replace(/^\/|\/$/g, '');
  const dir = repo.readmePath.includes('/') ? repo.readmePath.replace(/\/[^/]*$/, '/') : '';
  const rawBase = `https://raw.githubusercontent.com/${repoPath}/main/${dir}`;
  const blobBase = `https://github.com/${repoPath}/blob/main/${dir}`;

  const res = await fetch(`${rawBase}${repo.readmePath.split('/').pop()}`, {
    next: { revalidate: 3600 },
  }).catch(() => null);
  if (!res?.ok) return null;
  const markdown = await res.text();

  const isRelative = (target: string) =>
    !/^(?:[a-z]+:|\/|#)/i.test(target) && !target.startsWith('data:');
  const resolve = (base: string, target: string) => `${base}${target.replace(/^\.\//, '')}`;

  return markdown
    .replace(/(!\[[^\]]*\]\()([^)\s]+)/g, (m, prefix: string, target: string) =>
      isRelative(target) ? `${prefix}${resolve(rawBase, target)}` : m,
    )
    .replace(/(^|[^!])(\[[^\]]*\]\()([^)\s]+)/g, (m, lead: string, prefix: string, target: string) =>
      isRelative(target) ? `${lead}${prefix}${resolve(blobBase, target)}` : m,
    );
}
