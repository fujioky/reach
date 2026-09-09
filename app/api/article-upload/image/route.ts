// app/api/article-upload/image/route.ts
// Token issuer for browser → Vercel Blob image uploads in the article editor.
//
// The bytes never pass through this function: `handleUpload` mints a
// short-lived client token and the browser PUTs straight to Blob. That's the
// only way to accept a photo larger than the ~4.5MB Vercel request-body cap.
//
// The media row is written afterwards by the registerArticleImage server action
// rather than by `onUploadCompleted`, because that callback is an inbound
// webhook from Vercel and cannot reach a localhost dev server. Registering from
// the client keeps the flow identical in dev and in production.

export const runtime = 'nodejs';

import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { auth } from '@/auth';
import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES } from '@/lib/article/media';

/** The client proposes a pathname; only these prefixes are accepted. */
const ALLOWED_PREFIXES = ['articles/images/', 'articles/posters/'];

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const result = await handleUpload({
      body,
      request,
      token: process.env.BLOB_READ_WRITE_TOKEN,
      onBeforeGenerateToken: async (pathname) => {
        // Only a signed-in admin may author articles, so only an admin may
        // upload into one.
        const session = await auth();
        if (!session?.user) throw new Error('Unauthorized');

        // The SDK lets the client pick the pathname, so it gets checked here:
        // confine uploads to the article prefix and reject traversal.
        if (!ALLOWED_PREFIXES.some((p) => pathname.startsWith(p)) || pathname.includes('..')) {
          throw new Error('Invalid upload path');
        }

        return {
          allowedContentTypes: [...ALLOWED_IMAGE_TYPES],
          maximumSizeInBytes: MAX_IMAGE_BYTES,
          // Blob appends its own random segment, so two uploads can never
          // collide and a guessed pathname can't overwrite an existing image.
          addRandomSuffix: true,
        };
      },
    });

    return Response.json(result);
  } catch (err) {
    const message = (err as Error).message;
    return Response.json({ error: message }, { status: message === 'Unauthorized' ? 401 : 400 });
  }
}
