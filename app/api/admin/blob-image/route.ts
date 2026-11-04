// app/api/admin/blob-image/route.ts
// Admin-only: redirect to a fresh presigned URL for a private Blob image.
// Session replays point stored images here (lib/analytics/resign-media.ts)
// because the URLs the visitor's page carried expired an hour after it loaded.

export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { presignPathname } from '@/lib/blob/presign';

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const pathname = new URL(req.url).searchParams.get('p') ?? '';
  // Images only, and no way to climb out of the store's namespace.
  if (!/^images\/[A-Za-z0-9._\-/]+$/.test(pathname) || pathname.includes('..')) {
    return NextResponse.json({ error: 'Bad path' }, { status: 400 });
  }
  const url = await presignPathname(pathname);
  return NextResponse.redirect(url, { status: 302, headers: { 'cache-control': 'private, max-age=1800' } });
}
