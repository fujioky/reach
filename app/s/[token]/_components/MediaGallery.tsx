// app/s/[token]/_components/MediaGallery.tsx
// RSC async subcomponent — image gallery (Suspense-streamed, D-44).
//
// PATTERNS §12: async function that queries the media table internally and
// awaits presignImages, so Suspense truly streams (RESEARCH §3 Landmine —
// synchronous components don't trigger Suspense).
//
// VIEW-02 empty edges:
// - No images → returns null (gallery block doesn't render)
// - blobUrl=null (failed download) → filtered out by presignImages filter(Boolean)
//
// Video is NOT rendered here — it goes through VideoSection.
// Layout and lightbox are handled by the XImageGrid client component.

import { db, media } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { presignImage } from '@/lib/blob/presign';
import { XImageGrid } from './XImageGrid';

export async function MediaGallery({ contentItemId }: { contentItemId: string }) {
  // Query media for this content item
  const itemMedia = await db
    .select()
    .from(media)
    .where(eq(media.contentItemId, contentItemId));

  // Filter to images with a valid blobUrl (video goes to VideoSection)
  const imageRows = itemMedia.filter((m) => m.type === 'image' && m.blobUrl);
  if (imageRows.length === 0) return null; // VIEW-02 empty edge

  // Batch presign all image URLs in parallel (D-39).
  // Use allSettled so a single failed presign (e.g. blob deleted, token
  // rotated, "Access denied") only skips that image — the rest of the
  // gallery and the page shell remain visible. Promise.all would reject
  // the whole async component, which (without a per-section error
  // boundary) propagates up and replaces the entire page including the
  // already-rendered shell text.
  const results = await Promise.allSettled(
    imageRows.map((m) => presignImage(m.blobUrl!)),
  );
  const presigned = results
    .map((r, i) =>
      r.status === 'fulfilled'
        ? { src: r.value, alt: `图片 ${i + 1}` }
        : null,
    )
    .filter((x): x is { src: string; alt: string } => x !== null);

  if (presigned.length === 0) return null; // all presigns failed → skip gallery

  return <XImageGrid images={presigned} />;
}
