// lib/access/share-media.ts
// Media API access for share pages (video-status, proxy-video).
//
// Burn-after-read sets status to 'burned' on the first view, but the visitor
// who opened the page still needs media endpoints while the player loads.

import { eq, and } from 'drizzle-orm';
import { db, shares, shareVisits } from '@/lib/db';

export type ShareMediaAccessResult =
  | { allowed: true; share: typeof shares.$inferSelect }
  | { allowed: false; reason: 'not_found' | 'forbidden' };

async function isReturningVisitor(
  shareId: string,
  visitorCookie: string | undefined,
  visitorIp: string,
): Promise<boolean> {
  if (visitorCookie) {
    const rows = await db
      .select()
      .from(shareVisits)
      .where(
        and(
          eq(shareVisits.shareId, shareId),
          eq(shareVisits.visitorCookie, visitorCookie),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  const rows = await db
    .select()
    .from(shareVisits)
    .where(
      and(eq(shareVisits.shareId, shareId), eq(shareVisits.visitorIp, visitorIp)),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Allow media fetches for active shares, or burned burn-after-read shares
 * when the visitor already opened the page (recorded in share_visits).
 */
export async function checkShareMediaAccess(
  token: string,
  visitorCookie: string | undefined,
  visitorIp: string,
): Promise<ShareMediaAccessResult> {
  const [share] = await db
    .select()
    .from(shares)
    .where(eq(shares.token, token))
    .limit(1);
  if (!share) return { allowed: false, reason: 'not_found' };

  if (share.status === 'active') {
    return { allowed: true, share };
  }

  if (share.status === 'burned' && share.burnAfterRead) {
    const returning = await isReturningVisitor(share.id, visitorCookie, visitorIp);
    if (returning) return { allowed: true, share };
  }

  return { allowed: false, reason: 'forbidden' };
}

export function parseVisitorFromRequest(req: Request): {
  cookie?: string;
  ip: string;
} {
  const cookieHeader = req.headers.get('cookie') ?? '';
  const match = cookieHeader.match(/(?:^|;\s*)visitor_id=([^;]*)/);
  const cookie = match ? decodeURIComponent(match[1]) : undefined;
  const forwarded = req.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || 'unknown';
  return { cookie, ip };
}