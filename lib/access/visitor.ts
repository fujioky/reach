// lib/access/visitor.ts
// Plan 05-01, Task 2 — visitor identification helpers (D-51).
//
// extractVisitorIp(): reads x-forwarded-for, returns first segment
// trimmed, or 'unknown' if absent.
// getVisitorCookie(): reads the visitor_id cookie set by proxy.ts.

import { headers, cookies } from 'next/headers';

/**
 * Extract the visitor's client IP from the x-forwarded-for header
 * (D-51). Returns the first segment (before the comma), trimmed.
 * Falls back to 'unknown' if the header is absent.
 */
export async function extractVisitorIp(): Promise<string> {
  const headerList = await headers();
  const forwarded = headerList.get('x-forwarded-for');
  if (!forwarded) return 'unknown';
  const first = forwarded.split(',')[0]?.trim();
  return first || 'unknown';
}

/**
 * Read the visitor_id cookie (set by proxy.ts for /s/* routes).
 * Returns the cookie value or undefined if not present.
 */
export async function getVisitorCookie(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return cookieStore.get('visitor_id')?.value;
}
