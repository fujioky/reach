// lib/turnstile.ts
// Cloudflare Turnstile gate for visitor-facing content pages (/s/<token>,
// /p/<slug>) — blocks crawlers from scraping content.
//
// Flow: a visitor without a clearance cookie gets the TurnstileGate page
// instead of content. The widget produces a token, /api/turnstile/verify
// checks it against Cloudflare siteverify (needs TURNSTILE_SECRET_KEY) and
// sets an HMAC-signed clearance cookie; the reload then renders content.
//
// The cookie follows the content-unlock pattern: value is `<exp>.<hmac(exp)>`
// signed with AUTH_SECRET, so it cannot be forged and nothing secret is
// stored client-side.
//
// Unset TURNSTILE_SITE_KEY / TURNSTILE_SECRET_KEY disables the gate entirely
// (deploy-order safe). The gate is always off in development.

import { createHmac, timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';

export const CLEARANCE_COOKIE = 'ts_clearance';
const CLEARANCE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export function turnstileSiteKey(): string {
  return process.env.TURNSTILE_SITE_KEY ?? '';
}

function turnstileSecretKey(): string {
  return process.env.TURNSTILE_SECRET_KEY ?? '';
}

export function turnstileEnabled(): boolean {
  if (process.env.NODE_ENV === 'development') return false;
  return Boolean(turnstileSiteKey() && turnstileSecretKey());
}

function sign(payload: string): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET is required for turnstile clearance cookies');
  return createHmac('sha256', secret).update(`turnstile:${payload}`).digest('base64url');
}

/** Cookie value proving the visitor passed the challenge, valid until exp. */
export function createClearanceValue(now = Date.now()): string {
  const exp = String(now + CLEARANCE_MAX_AGE_SECONDS * 1000);
  return `${exp}.${sign(exp)}`;
}

export function isClearanceValid(value: string | undefined, now = Date.now()): boolean {
  if (!value) return false;
  const dot = value.indexOf('.');
  if (dot === -1) return false;
  const exp = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  if (!/^\d+$/.test(exp) || Number(exp) < now) return false;
  const expected = sign(exp);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function clearanceCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: CLEARANCE_MAX_AGE_SECONDS,
  } as const;
}

/** True when the gate is on and this visitor has not passed it yet. */
export async function turnstileGateRequired(): Promise<boolean> {
  if (!turnstileEnabled()) return false;
  const jar = await cookies();
  return !isClearanceValid(jar.get(CLEARANCE_COOKIE)?.value);
}

/** Server-side token validation against Cloudflare siteverify. */
export async function verifyTurnstileToken(
  token: string,
  remoteIp: string | null,
): Promise<boolean> {
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      secret: turnstileSecretKey(),
      response: token,
      ...(remoteIp ? { remoteip: remoteIp } : {}),
    }),
  });
  if (!res.ok) return false;
  const data = (await res.json()) as { success?: boolean };
  return data.success === true;
}
