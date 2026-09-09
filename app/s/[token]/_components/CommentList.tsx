// app/s/[token]/_components/CommentList.tsx
// RSC async subcomponent — comment list (Suspense-streamed, D-44).
//
// PATTERNS §13: async function that queries the comments table internally,
// so Suspense truly streams (RESEARCH §3 Landmine).
//
// D-27: only retained=true comments are shown to visitors.
// PATTERNS §13 Landmine: comments table has no parentId column — replies
//   were flattened to independent rows during Phase 3 storage. MVP renders
//   a flat list (no tree reconstruction).
//
// VIEW-02 empty edge: no comments → empty-state copy.
//
// Translation:
//   Server-side pre-fetch from translation_cache for all comment texts in one
//   batch query. Hits are passed as initialTranslations to the client component
//   (zero additional round-trips for cached content). Misses are translated
//   client-side on first render via /api/translate (which also writes to cache).

import { db, comments } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { getSetting } from '@/lib/settings';
import { lookupCache } from '@/lib/translation/cache';
import { CommentListClient, type CommentData } from './CommentListClient';

export async function CommentList({
  contentItemId,
  targetLang = 'ZH',
}: {
  contentItemId: string;
  targetLang?: string;
}) {
  // Query comments for this content item
  const itemComments = await db
    .select()
    .from(comments)
    .where(eq(comments.contentItemId, contentItemId));

  // D-27: visitor page only shows retained comments
  const retained = itemComments.filter((c) => c.retained);

  // Check translation availability (DeepL key configured)
  const deeplKey = await getSetting('deepl_api_key');
  const translationAvailable = Boolean(deeplKey);

  // Server-side cache prefetch: batch lookup all comment texts in one DB query.
  // This means on the first visit after a translation is cached, the page
  // renders with translations already present — no client-side fetch needed.
  let cacheHits = new Map<string, string>();
  if (translationAvailable && retained.length > 0) {
    cacheHits = await lookupCache(
      retained.map((c) => c.text),
      targetLang,
    );
  }

  const commentData: CommentData[] = retained.map((comment) => {
    const author = comment.author as { name: string; handle: string; avatarUrl?: string };
    const cachedTranslation = cacheHits.get(comment.text);
    return {
      id: comment.id,
      author,
      text: comment.text,
      initialTranslations: cachedTranslation
        ? { [comment.text]: cachedTranslation }
        : {},
    };
  });

  return <CommentListClient comments={commentData} />;
}
