import type { NextConfig } from 'next';
import { execSync } from 'child_process';

function resolveBuildSha(): string {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA;
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'dev';
  }
}

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_SHA: resolveBuildSha(),
  },
  // Allow LAN/dev origins to access the dev server. Next.js 16 blocks
  // cross-origin requests to dev-only assets (RSC stream, HMR) by default,
  // which prevents React hydration when browsing from a non-localhost IP
  // (e.g. http://10.20.12.139:3000). Listing the origin here unblocks the
  // RSC stream so client components hydrate normally.
  allowedDevOrigins: ['10.20.12.139', '10.20.12.*', '10.20.*', '10.*'],
  // The article archive moved from /p to /post. Individual articles stay at
  // /p/<slug>, so this matches the bare path only and leaves those alone.
  async redirects() {
    return [{ source: '/p', destination: '/post', permanent: true }];
  },
};

export default nextConfig;
