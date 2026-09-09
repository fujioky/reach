// app/admin/shares/actions.ts
// Plan 05-02, Task 1 — Server Actions for share management (D-54).
//
// SHRE-06: revokeShare — admin manually revokes a share link
//   (status → 'revoked'). Two-click confirmation handled client-side.
// D-50: updateAccessControl — admin edits access control params
//   (expiry / maxViews / maxUniqueVisitors / burnAfterRead) on an
//   existing share from the management list.
//
// Auth (T-05-05): both actions call auth() for defense-in-depth (not
//   just proxy.ts gating /admin/*). Tampering (T-05-06): shareId
//   validated with zod z.string().uuid(); access control params
//   validated with a zod schema (positive ints, valid datetime, boolean).

'use server';

import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { auth } from '@/auth';
import { db, shares } from '@/lib/db';

// ─── zod schemas ─────────────────────────────────────────────────────
const shareIdSchema = z.string().uuid();

const accessControlParamsSchema = z.object({
  expiresAt: z.string().datetime().nullable().optional(),
  maxViews: z.number().int().positive().nullable().optional(),
  maxUniqueVisitors: z.number().int().positive().nullable().optional(),
  burnAfterRead: z.boolean().optional(),
});

export interface AccessControlParams {
  expiresAt?: string | null;
  maxViews?: number | null;
  maxUniqueVisitors?: number | null;
  burnAfterRead?: boolean;
}

export interface ShareActionResult {
  ok: boolean;
  error?: string;
}

// ─── revokeShare (SHRE-06) ───────────────────────────────────────────
export async function revokeShare(
  shareId: string,
): Promise<ShareActionResult> {
  // 1. Auth self-check (T-05-05 defense-in-depth)
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: 'Unauthorized' };
  }

  // 2. Validate shareId (T-05-06: zod uuid prevents injection)
  const parsed = shareIdSchema.safeParse(shareId);
  if (!parsed.success) {
    return { ok: false, error: 'invalid shareId' };
  }
  const id = parsed.data;

  // 3. Update shares status → 'revoked'
  try {
    await db
      .update(shares)
      .set({ status: 'revoked' })
      .where(eq(shares.id, id));
  } catch (err) {
    return {
      ok: false,
      error: `Revoke failed: ${(err as Error).message}`,
    };
  }

  // 4. Revalidate
  revalidatePath('/admin/shares');
  revalidatePath('/admin/mirrors');

  return { ok: true };
}

// ─── updateAccessControl (D-50: edit after creation) ────────────────
export async function updateAccessControl(
  shareId: string,
  params: AccessControlParams,
): Promise<ShareActionResult> {
  // 1. Auth self-check (T-05-05 defense-in-depth)
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: 'Unauthorized' };
  }

  // 2. Validate shareId (T-05-06: zod uuid)
  const idParsed = shareIdSchema.safeParse(shareId);
  if (!idParsed.success) {
    return { ok: false, error: 'invalid shareId' };
  }
  const id = idParsed.data;

  // 3. Validate access control params (T-05-06: positive ints, datetime, boolean)
  const paramsParsed = accessControlParamsSchema.safeParse(params);
  if (!paramsParsed.success) {
    return {
      ok: false,
      error: paramsParsed.error.issues[0]?.message ?? 'Invalid params',
    };
  }
  const parsedParams = paramsParsed.data;

  // 4. Fetch current share to compute new status
  const [current] = await db.select().from(shares).where(eq(shares.id, id)).limit(1);
  if (!current) {
    return { ok: false, error: 'Share not found' };
  }

  // 5. Normalize access control values (empty / null / undefined → null = unlimited)
  const newExpiresAt = parsedParams.expiresAt ? new Date(parsedParams.expiresAt) : null;
  const newMaxViews = parsedParams.maxViews ?? null;
  const newMaxUniqueVisitors = parsedParams.maxUniqueVisitors ?? null;
  const newBurnAfterRead = parsedParams.burnAfterRead ?? false;

  // Re-evaluate status: reset auto-set statuses (max_views, expired, max_visitors)
  // back to 'active' when the admin changes limits that previously triggered them.
  // Never reset 'revoked' or 'burned' — those are intentional terminal states.
  let newStatus = current.status;
  if (['max_views', 'expired', 'max_visitors'].includes(current.status)) {
    const nowExpired = newExpiresAt !== null && new Date() > newExpiresAt;
    const nowMaxViews = newMaxViews !== null && current.viewCount >= newMaxViews;
    const nowMaxVisitors = newMaxUniqueVisitors !== null && current.uniqueVisitorCount >= newMaxUniqueVisitors;
    if (!nowExpired && !nowMaxViews && !nowMaxVisitors) {
      newStatus = 'active';
    }
  }

  // 6. Persist all four columns explicitly — using null for unlimited values.
  //    This ensures the DB is always updated, even when every limit is removed.
  try {
    await db
      .update(shares)
      .set({
        expiresAt: newExpiresAt,
        maxViews: newMaxViews,
        maxUniqueVisitors: newMaxUniqueVisitors,
        burnAfterRead: newBurnAfterRead,
        status: newStatus,
      })
      .where(eq(shares.id, id));
  } catch (err) {
    return {
      ok: false,
      error: `Update failed: ${(err as Error).message}`,
    };
  }

  // 6. Revalidate
  revalidatePath('/admin/shares');
  revalidatePath('/admin/mirrors');

  return { ok: true };
}
