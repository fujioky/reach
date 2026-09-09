// app/api/storage/video/route.ts
// Vercel-app proxy for the S3-compatible video storage backend.
//
// GET /api/storage/video?key=<object-key>
//   Authenticates the caller (active share token), fetches the object from the
//   configured S3/R2 bucket, and streams it back. This keeps the storage
//   credentials server-side and lets the Vercel app cache / accelerate / auth.
//
// Auth: requires a valid active share token and that the requested key matches
//   a video media row belonging to that share's content item.

export const runtime = 'nodejs';
export const maxDuration = 300;

import { GetObjectCommand } from '@aws-sdk/client-s3';
import { db, shares, media } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { getSetting } from '@/lib/settings';
import { createS3Client, getPublicVideoUrl } from '@/lib/storage/s3';


export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');
  const key = searchParams.get('key');

  if (!token || !key) {
    return new Response('Missing token or key', { status: 400 });
  }

  // ① Validate share
  const [share] = await db.select().from(shares).where(eq(shares.token, token)).limit(1);
  if (!share) return new Response('Invalid token', { status: 404 });
  if (share.status !== 'active') return new Response('Link expired', { status: 403 });

  // ② Validate the key belongs to a video media row for this share's content
  const [mediaRow] = await db
    .select()
    .from(media)
    .where(eq(media.blobUrl, key))
    .limit(1);
  if (!mediaRow) return new Response('Media not found', { status: 404 });
  if (mediaRow.contentItemId !== share.contentItemId) return new Response('Forbidden', { status: 403 });
  if (mediaRow.type !== 'video') return new Response('Not a video', { status: 400 });

  // ③ Load storage credentials
  const endpoint = await getSetting('video_storage_endpoint');
  const region = await getSetting('video_storage_region');
  const bucket = await getSetting('video_storage_bucket');
  const accessKey = await getSetting('video_storage_access_key');
  const secretKey = await getSetting('video_storage_secret_key');
  const customDomain = await getSetting('video_storage_custom_domain');
  const storageFailoverEnabled =
    (await getSetting('video_storage_failover_enabled')) === 'true';

  if (!endpoint || !bucket || !accessKey || !secretKey) {
    return new Response('Storage backend not configured', { status: 500 });
  }

  // ④ Stream from S3/R2
  const client = createS3Client({
    endpoint,
    region,
    bucket,
    accessKeyId: accessKey,
    secretAccessKey: secretKey,
  });

  try {
    const obj = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
    );

    const headers: Record<string, string> = {
      'Content-Type': obj.ContentType || 'video/mp4',
      'Content-Disposition': 'inline',
      'Accept-Ranges': 'bytes',
    };
    if (obj.ContentLength) {
      headers['Content-Length'] = String(obj.ContentLength);
    }

    return new Response(obj.Body as ReadableStream, { headers });
  } catch (err) {
    if (storageFailoverEnabled) {
      const publicUrl = getPublicVideoUrl(
        {
          endpoint,
          region,
          bucket,
          accessKeyId: accessKey,
          secretAccessKey: secretKey,
          customDomain: customDomain || undefined,
          useVercelProxy: false,
        },
        key,
      );
      return Response.redirect(publicUrl, 302);
    }
    return new Response(`Storage error: ${(err as Error).message}`, { status: 502 });
  }
}
