// app/api/article-media/[key]/route.ts
// The one address article media is ever referenced by, and the one place that
// decides who may read it and how the bytes get delivered.
//
// Markdown stores `/api/article-media/<mediaId>.<ext>` because neither storage
// backend produces an address that can live in a document: Blob presigned URLs
// expire within the hour and S3/R2 objects are private. This route resolves the
// id against fresh credentials on every request.
//
// ── Access ──────────────────────────────────────────────────────────────────
// An asset marked 公开分享 (media.meta.shared) is readable by anyone. Anything
// else needs proof the request came from the article: a signed token in the
// query string, minted server-side while rendering the page (lib/article/
// media-token.ts). An admin session also passes, for previewing drafts.
//
// Referer is not used for this — it is forgeable and frequently stripped, so it
// can neither grant nor deny access honestly.
//
// ── Delivery ────────────────────────────────────────────────────────────────
// Controlled by the article_media_direct setting, entirely here so the page
// only ever emits this path:
//
//   proxy (default) — videos stream through this function; images redirect to
//     a presigned Blob URL, since Blob has no other read path.
//   direct          — a 302 to storage: a presigned S3/R2 GET for video, the
//     presigned Blob URL for images.
//
// Note on direct mode: if the R2 bucket has a custom domain, that domain serves
// it publicly and ignores the signature, so the redirect target is a permanent
// public URL. Access control lives here, at the `?t=` token — not in storage.

export const runtime = 'nodejs';
export const maxDuration = 300;

import { GetObjectCommand } from '@aws-sdk/client-s3';
import { eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { db, media, contentItems } from '@/lib/db';
import { presignImage } from '@/lib/blob/presign';
import { parseArticleMediaKey } from '@/lib/article/markdown';
import {
  loadArticleS3Config,
  presignVideoDownload,
  typeForExtension,
} from '@/lib/article/media';
import { MEDIA_TOKEN_PARAM, verifyMediaToken } from '@/lib/article/media-token';
import {
  generateDerivedImage,
  getCachedDerivedUrl,
  isTransformableType,
  parseWidth,
} from '@/lib/article/image-transform';
import { after } from 'next/server';
import { isDirectMediaEnabled } from '@/lib/article/media-url';
import { createS3Client } from '@/lib/storage/s3';

// The redirect is cached per-viewer, kept safely inside the lifetime of the
// presigned URL it points at (Blob ~1h, S3 6h). This saves a round trip on
// every image in an article and on every replay of a video.
//
// The trade: this route is also the access check, so a cached 302 keeps working
// until it expires even after the asset stops being 公开分享 or is deleted.
// Revocation is therefore eventual, not immediate — bounded by these values.
// Cache is `private` throughout: access is per-viewer and a shared cache must
// never hold one of these.
/** Presigned Blob URLs last ~1h; cache the redirect for well under that. */
const IMAGE_REDIRECT_MAX_AGE = 1500; // 25 min
/** Presigned S3 GETs last 6h; same idea with more headroom. */
const VIDEO_REDIRECT_MAX_AGE = 3600; // 1h

export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  const parsed = parseArticleMediaKey(key);
  if (!parsed) return new Response('Bad media key', { status: 400 });

  // ① Resolve the media row together with its article
  const [row] = await db
    .select({
      id: media.id,
      type: media.type,
      blobUrl: media.blobUrl,
      meta: media.meta,
      articleType: contentItems.type,
      articleStatus: contentItems.status,
    })
    .from(media)
    .innerJoin(contentItems, eq(media.contentItemId, contentItems.id))
    .where(eq(media.id, parsed.mediaId))
    .limit(1);

  if (!row) return new Response('Not found', { status: 404 });
  if (row.articleType !== 'article') return new Response('Not found', { status: 404 });
  if (!row.blobUrl) return new Response('Media not stored', { status: 404 });

  const meta = (row.meta ?? {}) as {
    contentType?: string;
    shared?: boolean;
    posterUrl?: string;
  };
  const contentType = meta.contentType || typeForExtension(parsed.extension);

  // ② Access
  if (meta.shared !== true) {
    const url = new URL(request.url);
    const verdict = verifyMediaToken(row.id, url.searchParams.get(MEDIA_TOKEN_PARAM));

    if (verdict !== 'valid') {
      // An admin can always look — that's how draft previews work.
      const session = await auth();
      if (!session?.user) {
        // 403 for a token that merely aged out, so a stale tab can be told
        // apart from a guessed URL; 404 otherwise, which reveals nothing about
        // whether the id exists.
        return verdict === 'expired'
          ? new Response('Link expired — reopen the article', { status: 403 })
          : new Response('Not found', { status: 404 });
      }
    }
  }

  // ?poster=1 — the still frame captured for a video. Served ahead of the type
  // branches because it is an image regardless of what the row holds.
  if (new URL(request.url).searchParams.get('poster') === '1') {
    if (!meta.posterUrl) return new Response('No poster', { status: 404 });
    try {
      return new Response(null, {
        status: 302,
        headers: {
          Location: await presignImage(meta.posterUrl),
          'Cache-Control': `private, max-age=${IMAGE_REDIRECT_MAX_AGE}`,
        },
      });
    } catch (err) {
      return new Response(`Presign failed: ${(err as Error).message}`, { status: 502 });
    }
  }

  const direct = await isDirectMediaEnabled();

  // ③ Images — Blob is only readable through a presigned URL, so this is a
  //    redirect either way. The direct setting makes no difference here; it is
  //    kept uniform so callers don't have to care.
  if (row.type === 'image') {
    try {
      // ?w= asks for a WebP derivative at one of the ladder widths.
      //
      // The request only ever *looks up* a built derivative; it never waits for
      // one. Converting a multi-megabyte photo takes seconds, and the first
      // reader would sit on a broken image while sharp worked — the browser
      // gives up long before it finishes. So a miss serves the original right
      // away and schedules the conversion behind the response, which makes the
      // next request a plain redirect to the WebP.
      const width = parseWidth(new URL(request.url).searchParams.get('w'));
      if (width && isTransformableType(contentType)) {
        const cached = await getCachedDerivedUrl(row.id, width);
        if (cached) {
          return new Response(null, {
            status: 302,
            headers: {
              Location: cached,
              'Cache-Control': `private, max-age=${IMAGE_REDIRECT_MAX_AGE}`,
            },
          });
        }

        const blobUrl = row.blobUrl;
        after(async () => {
          await generateDerivedImage(row.id, blobUrl, width);
        });

        // The original is served this once. Don't let it be cached for long —
        // the derivative will exist within seconds and should take over.
        const presignedOriginal = await presignImage(blobUrl);
        return new Response(null, {
          status: 302,
          headers: { Location: presignedOriginal, 'Cache-Control': 'private, max-age=10' },
        });
      }

      const presigned = await presignImage(row.blobUrl);
      return new Response(null, {
        status: 302,
        headers: {
          Location: presigned,
          'Cache-Control': `private, max-age=${IMAGE_REDIRECT_MAX_AGE}`,
        },
      });
    } catch (err) {
      return new Response(`Presign failed: ${(err as Error).message}`, { status: 502 });
    }
  }

  // ④ Videos
  const config = await loadArticleS3Config();
  if (!config) return new Response('Storage backend not configured', { status: 500 });

  if (direct) {
    try {
      const presigned = await presignVideoDownload(config, row.blobUrl);
      return new Response(null, {
        status: 302,
        headers: {
          Location: presigned,
          'Cache-Control': `private, max-age=${VIDEO_REDIRECT_MAX_AGE}`,
        },
      });
    } catch (err) {
      return new Response(`Presign failed: ${(err as Error).message}`, { status: 502 });
    }
  }

  // Proxy mode — stream from storage, forwarding Range so the player can seek.
  const range = request.headers.get('range') ?? undefined;
  try {
    const client = createS3Client(config);
    const object = await client.send(
      new GetObjectCommand({ Bucket: config.bucket, Key: row.blobUrl, Range: range }),
    );

    const headers = new Headers({
      'Content-Type': object.ContentType || contentType,
      'Content-Disposition': 'inline',
      'Accept-Ranges': 'bytes',
      // Unlike the redirect, the body may be cached: the check has already
      // passed and the viewer holds the bytes, while re-fetching a video on
      // every seek would be far worse than an hour of staleness. Private only —
      // never a shared cache, since access is per-viewer.
      'Cache-Control': 'private, max-age=3600',
    });
    if (object.ContentLength !== undefined) {
      headers.set('Content-Length', String(object.ContentLength));
    }
    if (object.ContentRange) headers.set('Content-Range', object.ContentRange);

    return new Response(object.Body as ReadableStream, {
      status: object.ContentRange ? 206 : 200,
      headers,
    });
  } catch (err) {
    return new Response(`Storage error: ${(err as Error).message}`, { status: 502 });
  }
}
