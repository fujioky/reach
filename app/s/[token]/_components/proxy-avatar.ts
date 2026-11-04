// app/s/[token]/_components/proxy-avatar.ts
// Avatars load through /api/proxy-avatar (pbs.twimg.com is often unreachable
// for visitors). Plain module so server pages and client components share it.

export function proxyAvatar(url: string | undefined): string | undefined {
  if (!url) return undefined;
  return `/api/proxy-avatar?url=${encodeURIComponent(url)}`;
}
