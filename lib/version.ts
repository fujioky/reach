// lib/version.ts — build identifier (public footer) and build time (/status).

/** Short git SHA baked in at build time (Vercel) or from local git. */
export function getBuildVersion(): string {
  const raw =
    process.env.NEXT_PUBLIC_BUILD_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    'dev';
  return raw === 'dev' ? raw : raw.slice(0, 7);
}

/** ISO 8601 time this build was made, i.e. when the deployment was created; null in dev. */
export function getBuildTime(): string | null {
  return process.env.NEXT_PUBLIC_BUILD_TIME || null;
}
