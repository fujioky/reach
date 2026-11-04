// lib/mirror/kind-label.ts
// What kind of post a mirror holds, for the admin list and detail badges.

/** 「文章」 for an X Article, 「帖子」 for any other X post; null for other platforms. */
export function xKindLabel(platform: string | null | undefined, platformData: unknown): string | null {
  if (platform !== 'x') return null;
  return (platformData as { xArticle?: boolean } | null)?.xArticle ? '文章' : '帖子';
}
