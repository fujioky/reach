// lib/version.ts — build identifier exposed in the public footer.

/** Short git SHA baked in at build time (Vercel) or from local git. */
export function getBuildVersion(): string {
  const raw =
    process.env.NEXT_PUBLIC_BUILD_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    'dev';
  return raw === 'dev' ? raw : raw.slice(0, 7);
}