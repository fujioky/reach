// app/api/x-thread/route.ts
// Visitor page: load more of an X thread on demand (deeper replies, or parents
// beyond a chain that stopped short). Results are written back into the mirror.
//
// Access mirrors the media endpoints (the share must be viewable, including a
// burn-after-read share the visitor already opened) plus the password gate,
// since this returns post content. Only ids already in the mirror can be
// expanded (see lib/mirror/x-thread-expand.ts), and each visitor is limited to
// a few fetches a minute because every call reaches X through reach-upstream.

export const runtime = 'nodejs';
export const maxDuration = 120;

import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, contentItems } from '@/lib/db';
import { checkShareMediaAccess, parseVisitorFromRequest } from '@/lib/access/share-media';
import { checkUnlocked } from '@/lib/content/password';
import { expandParents, expandReplies } from '@/lib/mirror/x-thread-expand';

const bodySchema = z.object({
  token: z.string().min(1).max(100),
  id: z.string().regex(/^\d{1,25}$/),
  direction: z.enum(['replies', 'parents']),
});

const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 10;
const rateMap = new Map<string, { count: number; windowStart: number }>();

function allowRequest(visitor: string): boolean {
  const now = Date.now();
  const entry = rateMap.get(visitor);
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    rateMap.set(visitor, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= RATE_MAX_REQUESTS) return false;
  entry.count += 1;
  return true;
}

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'bad_request' }, { status: 400 });
  const { token, id, direction } = parsed.data;

  const { cookie, ip } = parseVisitorFromRequest(req);
  if (!allowRequest(cookie ?? ip)) {
    return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 });
  }

  const access = await checkShareMediaAccess(token, cookie, ip);
  if (!access.allowed) return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });

  const [item] = await db
    .select()
    .from(contentItems)
    .where(eq(contentItems.id, access.share.contentItemId))
    .limit(1);
  if (!item || item.platform !== 'x') return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });

  const unlock = await checkUnlocked(item);
  if (unlock.required && !unlock.unlocked) {
    return NextResponse.json({ ok: false, error: 'locked' }, { status: 403 });
  }

  const result = direction === 'replies' ? await expandReplies(item, id) : await expandParents(item, id);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  return NextResponse.json(result);
}
