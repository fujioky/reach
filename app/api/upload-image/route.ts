// app/api/upload-image/route.ts
// Blob upload Route Handler — fetches image from upstream URL, uploads to Vercel Blob.
// Plan 01-03 Task 2: Create route for SPKE-04 Blob upload validation.
// Store is private: upload with access:'private', return presigned URL for visitor access.

import { put, issueSignedToken, presignUrl } from '@vercel/blob';

export const runtime = 'nodejs';
export const maxDuration = 60; // Image upload is fast, 60s is plenty

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const imageUrl = searchParams.get('url'); // e.g. https://pbs.twimg.com/media/...

  if (!imageUrl) {
    return Response.json({ error: 'Missing url param' }, { status: 400 });
  }

  try {
    // Fetch the image from upstream
    const upstream = await fetch(imageUrl);
    if (!upstream.ok) {
      return Response.json({ error: `Upstream ${upstream.status}` }, { status: 502 });
    }

    const contentType = upstream.headers.get('Content-Type') || 'image/jpeg';
    const pathname = `images/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    const blob = await put(pathname, upstream.body!, {
      access: 'private',
      contentType,
      addRandomSuffix: false, // we already added a suffix above
    });

    // Private store: issue a signed token and presign the GET URL for visitor access.
    const signedToken = await issueSignedToken({ pathname });
    const { presignedUrl } = await presignUrl(signedToken, {
      operation: 'get',
      pathname,
      access: 'private',
    });

    return Response.json({
      url: presignedUrl, // presigned URL — publicly accessible until token expires (default 1h)
      pathname: blob.pathname,
      contentType: blob.contentType,
      blobUrl: blob.url, // permanent private URL (needs auth)
    });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
