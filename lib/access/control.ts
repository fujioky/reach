// lib/access/control.ts
// Plan 05-01, Task 2 — access control engine (D-50/D-51/D-52).
//
// checkAccess() enforces all 5 control types (SHRE-03/04/05/06/07)
// with atomic viewCount increment via UPDATE...RETURNING (Pitfall 2).
// Status is checked FIRST (Pitfall 7 — never increment for non-active
// shares). Burn-after-read allows exactly one view then burns
// (Pitfall 3). Unique-visitor dedup is cookie-first, IP-fallback (D-51).

import { eq, sql, and } from 'drizzle-orm';
import { db, shares, shareVisits } from '@/lib/db';

export type AccessCheckReason =
  | 'expired'
  | 'max_views'
  | 'max_visitors'
  | 'revoked'
  | 'burned'
  | 'not_found';

export type AccessCheckResult =
  | { allowed: true; share: typeof shares.$inferSelect }
  | { allowed: false; reason: AccessCheckReason };

/**
 * Check access for a share token and record the visit if allowed.
 *
 * Flow (RESEARCH §1 Pattern 1 + Pitfalls 2/3/7):
 * 1. Query share by token. Not found → { allowed: false, reason: 'not_found' }.
 * 2. Check status FIRST (Pitfall 7). Non-active → { allowed: false, reason: status }.
 * 3. Check expiry (SHRE-03). Past expiresAt → set status 'expired', block.
 * 4. Check max views (SHRE-04). viewCount >= maxViews → set status 'max_views', block.
 * 5. Check max unique visitors (SHRE-05, D-51). At limit + new visitor → set status 'max_visitors', block. Existing visitor allowed.
 * 6. Check burn-after-read second view (SHRE-07, Pitfall 3). burnAfterRead && viewCount >= 1 → set status 'burned', block.
 * 7. All checks passed — atomically increment viewCount (Pitfall 2).
 * 8. Record the visit in share_visits (D-51).
 * 9. Increment uniqueVisitorCount if this is a new visitor.
 * 10. Burn-after-read first view → set status 'burned' (Pitfall 3).
 * 11. Return { allowed: true, share: updated }.
 */
/**
 * Read-only access check — never mutates the share.
 *
 * checkAccess() is a *consumption*: it increments the view count, tallies the
 * visitor and burns a one-shot link. That makes it wrong for anything that runs
 * before the visitor actually sees the page. generateMetadata() is exactly such
 * a caller — Next runs it on every request alongside the page — so using
 * checkAccess there spent a view for the title alone. With burnAfterRead the
 * link was consumed by the metadata pass and the page render that followed
 * found it already burned, meaning a burn-after-read link showed "已失效" to the
 * very first visitor.
 *
 * This variant answers the same question without touching anything, so callers
 * that merely need to know "may this be shown" can ask without paying for it.
 */
export async function peekAccess(
  token: string,
  visitorCookie: string | undefined,
  visitorIp: string,
): Promise<AccessCheckResult> {
  const rows = await db.select().from(shares).where(eq(shares.token, token)).limit(1);
  const share = rows[0];
  if (!share) return { allowed: false, reason: 'not_found' };
  if (share.status !== 'active') {
    return { allowed: false, reason: share.status as AccessCheckReason };
  }
  if (share.expiresAt !== null && new Date() > share.expiresAt) {
    return { allowed: false, reason: 'expired' };
  }
  if (share.maxViews !== null && share.viewCount >= share.maxViews) {
    return { allowed: false, reason: 'max_views' };
  }
  if (
    share.maxUniqueVisitors !== null &&
    share.uniqueVisitorCount >= share.maxUniqueVisitors &&
    !(await isVisitorCounted(share.id, visitorCookie, visitorIp))
  ) {
    return { allowed: false, reason: 'max_visitors' };
  }
  // A burn-after-read link is still readable on the view that burns it; only a
  // second view is refused.
  if (share.burnAfterRead === true && share.viewCount >= 1) {
    return { allowed: false, reason: 'burned' };
  }
  return { allowed: true, share };
}

export async function checkAccess(
  token: string,
  visitorCookie: string | undefined,
  visitorIp: string,
): Promise<AccessCheckResult> {
  // 1. Query share by token
  const rows = await db
    .select()
    .from(shares)
    .where(eq(shares.token, token))
    .limit(1);
  const share = rows[0];
  if (!share) {
    return { allowed: false, reason: 'not_found' };
  }

  // 2. Check status FIRST (Pitfall 7 — never increment for non-active)
  if (share.status !== 'active') {
    return { allowed: false, reason: share.status as AccessCheckReason };
  }

  // 3. Check expiry (SHRE-03, D-50)
  if (share.expiresAt !== null && new Date() > share.expiresAt) {
    await db
      .update(shares)
      .set({ status: 'expired' })
      .where(eq(shares.id, share.id));
    return { allowed: false, reason: 'expired' };
  }

  // 4. Check view count limit (SHRE-04)
  if (share.maxViews !== null && share.viewCount >= share.maxViews) {
    await db
      .update(shares)
      .set({ status: 'max_views' })
      .where(eq(shares.id, share.id));
    return { allowed: false, reason: 'max_views' };
  }

  // 5. Check unique visitor limit (SHRE-05, D-51)
  if (
    share.maxUniqueVisitors !== null &&
    share.uniqueVisitorCount >= share.maxUniqueVisitors
  ) {
    // Is THIS visitor already counted? Dedup cookie-first, IP-fallback.
    const isExistingVisitor = await isVisitorCounted(
      share.id,
      visitorCookie,
      visitorIp,
    );
    if (!isExistingVisitor) {
      // New visitor would exceed the limit — block and transition status
      await db
        .update(shares)
        .set({ status: 'max_visitors' })
        .where(eq(shares.id, share.id));
      return { allowed: false, reason: 'max_visitors' };
    }
    // Existing visitor — allow through (don't block returning visitors)
  }

  // 6. Check burn-after-read second view (SHRE-07, Pitfall 3)
  if (share.burnAfterRead === true && share.viewCount >= 1) {
    await db
      .update(shares)
      .set({ status: 'burned' })
      .where(eq(shares.id, share.id));
    return { allowed: false, reason: 'burned' };
  }

  // 7. All checks passed — atomically increment viewCount (Pitfall 2)
  const updatedRows = await db
    .update(shares)
    .set({ viewCount: sql`${shares.viewCount} + 1` })
    .where(eq(shares.id, share.id))
    .returning();
  const updated = updatedRows[0];

  // 9. Check if this is a new unique visitor BEFORE recording the visit
  // (checking after the insert would always find the just-inserted row).
  // Dedup: cookie-first, IP-fallback (D-51).
  const wasNewVisitor = !(await isVisitorCounted(
    share.id,
    visitorCookie,
    visitorIp,
  ));

  // 8. Record the visit (D-51 — every visit is logged)
  await db.insert(shareVisits).values({
    shareId: share.id,
    visitorCookie: visitorCookie ?? 'none',
    visitorIp,
  });

  if (wasNewVisitor) {
    await db
      .update(shares)
      .set({ uniqueVisitorCount: sql`${shares.uniqueVisitorCount} + 1` })
      .where(eq(shares.id, share.id));
  }

  // 10. Burn-after-read first view (Pitfall 3) — first visitor sees
  // content, but the share is now burned for all subsequent visits.
  if (share.burnAfterRead === true && updated.viewCount === 1) {
    await db
      .update(shares)
      .set({ status: 'burned' })
      .where(eq(shares.id, share.id));
  }

  // 11. Return allowed with the updated share
  return { allowed: true, share: updated };
}

/**
 * Check if a visitor has already been counted for this share.
 * Dedup: cookie-first (if visitorCookie exists), IP-fallback (D-51).
 */
async function isVisitorCounted(
  shareId: string,
  visitorCookie: string | undefined,
  visitorIp: string,
): Promise<boolean> {
  if (visitorCookie) {
    const existing = await db
      .select()
      .from(shareVisits)
      .where(
        and(
          eq(shareVisits.shareId, shareId),
          eq(shareVisits.visitorCookie, visitorCookie),
        ),
      )
      .limit(1);
    return existing.length > 0;
  }
  // Fallback: dedup by IP when no cookie
  const existing = await db
    .select()
    .from(shareVisits)
    .where(
      and(
        eq(shareVisits.shareId, shareId),
        eq(shareVisits.visitorIp, visitorIp),
      ),
    )
    .limit(1);
  return existing.length > 0;
}
