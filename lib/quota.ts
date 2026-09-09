// lib/quota.ts
// Storage quota constants (D-16), real-time aggregation (D-17), and
// threshold evaluation (D-18: warnings flag, never block).
//
// Used by Dashboard (app/admin/page.tsx) and 03-04 createMirror.
// Style reference: lib/fetcher/errors.ts (pure functions + constants).
import { sql, eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { media } from '@/lib/db/schema';

const MB = 1024 * 1024;

/**
 * D-16: Storage thresholds (images only — videos use streaming proxy, D-12).
 * These are default constants; the plan allows env-var override but the
 * current implementation uses fixed values per D-16.
 */
export const LIMITS = {
  perImage: 20 * MB, // single image max
  perMirror: 200 * MB, // single mirror total images max
  totalQuota: 900 * MB, // total storage quota (1GB free tier - 100MB buffer)
} as const;

/**
 * D-18: Warning flags — all warnings only flag, never block.
 * The caller decides whether to proceed; evaluateQuota never throws.
 */
export interface QuotaEvaluation {
  usedBytes: number;
  mirrorImageBytes: number;
  largestImageBytes: number;
  warnings: {
    perImage: boolean;
    perMirror: boolean;
    totalQuota: boolean;
  };
}

/**
 * evaluateQuota — pure function that checks whether the given usage values
 * exceed the D-16 thresholds. Returns the exact shape expected by the
 * 03-01 RED test contract. Never throws (D-18: warn only).
 *
 * @param usedBytes        current total image storage usage
 * @param mirrorImageBytes total image bytes in the mirror being created
 * @param largestImageBytes size of the largest single image in the mirror
 */
export function evaluateQuota({
  usedBytes,
  mirrorImageBytes,
  largestImageBytes,
}: {
  usedBytes: number;
  mirrorImageBytes: number;
  largestImageBytes: number;
}): QuotaEvaluation {
  return {
    usedBytes,
    mirrorImageBytes,
    largestImageBytes,
    warnings: {
      perImage: largestImageBytes > LIMITS.perImage,
      perMirror: mirrorImageBytes > LIMITS.perMirror,
      totalQuota: usedBytes > LIMITS.totalQuota,
    },
  };
}

/**
 * getStorageUsage — D-17 real-time aggregation.
 * Queries SUM(size) for type='image' in the media table.
 * Returns 0 when no images exist (coalesce handles null).
 */
export async function getStorageUsage(): Promise<number> {
  const [result] = await db
    .select({
      total: sql<number>`coalesce(sum(${media.size}),0)`,
    })
    .from(media)
    .where(eq(media.type, 'image'));

  return Number(result?.total ?? 0);
}
