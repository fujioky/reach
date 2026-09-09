// app/api/turnstile/verify/route.ts
// Exchange a Turnstile widget token for a signed clearance cookie.
// Called by TurnstileGate after the challenge succeeds; the subsequent page
// reload then passes turnstileGateRequired() and renders the content.

export const runtime = 'nodejs';

import { cookies } from 'next/headers';
import {
  CLEARANCE_COOKIE,
  clearanceCookieOptions,
  createClearanceValue,
  turnstileEnabled,
  verifyTurnstileToken,
} from '@/lib/turnstile';

export async function POST(request: Request): Promise<Response> {
  if (!turnstileEnabled()) return new Response(null, { status: 404 });

  let token: unknown;
  try {
    ({ token } = (await request.json()) as { token?: unknown });
  } catch {
    return new Response(null, { status: 400 });
  }
  if (typeof token !== 'string' || !token || token.length > 4096) {
    return new Response(null, { status: 400 });
  }

  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    null;

  if (!(await verifyTurnstileToken(token, ip))) {
    return new Response(null, { status: 403 });
  }

  const jar = await cookies();
  jar.set(CLEARANCE_COOKIE, createClearanceValue(), clearanceCookieOptions());
  return new Response(null, { status: 204 });
}
