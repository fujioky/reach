// app/s/[token]/_components/VideoSection.tsx
// RSC async subcomponent — video section (Suspense-streamed, D-44).
//
// PATTERNS §14: async function that queries the media table for a video,
// builds the video URL, and passes it to the client-side VideoPlayer.
//
// VIEW-02 empty edge: no video → returns null (video block doesn't render).
//
// URL strategy:
// - External proxy configured → browser loads https://dl.../<upstream-url> directly
// - Storage + Vercel proxy off → browser loads custom CDN domain directly
// - Otherwise → /api/proxy-video (Referer strip, URL refresh, lazy upload, Vercel stream)
//
// Poster: YouTube thumbnails (stored as image MediaItems with a presigned
// blobUrl) are passed to <video poster=...> so the player shows the
// thumbnail cover before playback starts (instead of a black frame).
// Twitter videos have no separate thumbnail → poster is undefined.

import { db, media, contentItems } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { VideoPlayer } from './VideoPlayer';
import { presignImage } from '@/lib/blob/presign';
import { resolveVideoPlaybackUrl } from '@/lib/video/playback-url';

export async function VideoSection({
  token,
  contentItemId,
  platform = 'x',
}: {
  token: string;
  contentItemId: string;
  /** YouTube immersive layout shows loading steps below the player. */
  platform?: 'youtube' | 'x';
}) {
  // Query media + platformData (timed captions) for this content item
  const [itemMedia, itemRows] = await Promise.all([
    db.select().from(media).where(eq(media.contentItemId, contentItemId)),
    db
      .select({ platformData: contentItems.platformData })
      .from(contentItems)
      .where(eq(contentItems.id, contentItemId))
      .limit(1),
  ]);

  // Find the video media item
  const video = itemMedia.find((m) => m.type === 'video');
  if (!video) return null; // VIEW-02 empty edge

  const videoSrc = await resolveVideoPlaybackUrl(token, {
    id: video.id,
    originalUrl: video.originalUrl,
    blobUrl: video.blobUrl,
  });

  // Find a thumbnail image for the video poster (YouTube only — Twitter
  // videos have no separate thumbnail). Presign the blobUrl so the poster
  // is accessible from the browser. If presign fails (blob deleted etc.),
  // the poster is simply omitted — the video still plays, just with a
  // black frame before playback.
  let posterUrl: string | undefined;
  const thumbnail = itemMedia.find((m) => m.type === 'image' && m.blobUrl);
  if (thumbnail?.blobUrl) {
    try {
      posterUrl = await presignImage(thumbnail.blobUrl);
    } catch {
      posterUrl = undefined; // presign failed — skip poster, video still works
    }
  }

  // In-player captions: timed VTT saved by agent-reach (may be absent for
  // mirrors fetched before subtitle support — 刷新字幕 backfills it).
  const platformData = itemRows[0]?.platformData as
    | { transcriptVtt?: string; transcriptLang?: string }
    | null;
  const captionsVtt = platformData?.transcriptVtt || undefined;
  const captionsLang = platformData?.transcriptLang;

  return (
    <VideoPlayer
      src={videoSrc}
      poster={posterUrl}
      shareToken={token}
      mediaId={video.id}
      platform={platform}
      captionsVtt={captionsVtt}
      captionsLang={captionsLang}
    />
  );
}
