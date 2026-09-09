// lib/content/password.ts
// Password gate shared by articles (/p/<slug>) and mirrors (/s/<token>).
//
// Each item chooses one of three modes:
//   'none'    — open
//   'inherit' — the site-wide password from app_settings
//   'custom'  — its own password
//
// Unlocking is scoped by password, not by item: entering the site password once
// opens everything that inherits it, while a custom password only opens the
// items that share it. That follows from how the cookie is keyed — it stores a
// signature over the password hash, so any item resolving to the same hash
// accepts the same credential, and an item with a different one does not.
//
// The hash never leaves the server; the cookie carries an HMAC over it, so a
// stolen cookie reveals nothing about the password and cannot be transplanted
// onto an item protected by a different one.

import bcrypt from 'bcryptjs';
import { createHmac, timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';
import { getSetting } from '@/lib/settings';

export type PasswordMode = 'none' | 'inherit' | 'custom';

/** Cookie holding the unlock credentials, one per line. */
export const UNLOCK_COOKIE = 'content_unlock';

/** How long an unlock lasts. Long enough to read without re-entering. */
const UNLOCK_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/** bcrypt cost — matches the admin login hashes. */
const BCRYPT_ROUNDS = 10;

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error('AUTH_SECRET is required for content unlock cookies');
  return value;
}

/** Normalize the stored mode; null/unknown means the item is open. */
export function readPasswordMode(raw: string | null | undefined): PasswordMode {
  return raw === 'inherit' || raw === 'custom' ? raw : 'none';
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/** The site-wide password hash, or '' when none is configured. */
export async function getSitePasswordHash(): Promise<string> {
  return (await getSetting('content_password_hash')).trim();
}

export interface ProtectedItem {
  passwordMode: string | null;
  passwordHash: string | null;
}

/**
 * Resolve which hash actually guards an item.
 *
 * Returns null when the item is open — including the case where it says
 * 'inherit' but no site password is configured. An item must never become
 * unreachable because of a missing setting; open is the safe failure here,
 * since the admin can see the mode in the editor and the setting on the
 * settings page.
 */
export async function resolveGuardHash(item: ProtectedItem): Promise<string | null> {
  const mode = readPasswordMode(item.passwordMode);
  if (mode === 'none') return null;
  if (mode === 'custom') return item.passwordHash?.trim() || null;
  const site = await getSitePasswordHash();
  return site || null;
}

/**
 * Credential stored in the cookie for one hash.
 *
 * A short HMAC of the hash: it identifies which password was satisfied without
 * carrying the hash itself, and cannot be computed by a client.
 */
function credentialFor(guardHash: string): string {
  return createHmac('sha256', secret()).update(`unlock:${guardHash}`).digest('hex').slice(0, 24);
}

function constantTimeIncludes(list: string[], value: string): boolean {
  const target = Buffer.from(value, 'utf8');
  let found = false;
  for (const entry of list) {
    const buf = Buffer.from(entry, 'utf8');
    if (buf.length === target.length && timingSafeEqual(buf, target)) found = true;
  }
  return found;
}

/** Read the credentials the visitor currently holds. */
async function readCredentials(): Promise<string[]> {
  const store = await cookies();
  const raw = store.get(UNLOCK_COOKIE)?.value ?? '';
  return raw.split('.').filter(Boolean);
}

export type UnlockState =
  | { required: false }
  | { required: true; unlocked: boolean };

/**
 * Whether the visitor may see this item.
 *
 * `required: false` means the item is open; otherwise `unlocked` says whether
 * the cookie carries a credential for the guarding password.
 */
export async function checkUnlocked(item: ProtectedItem): Promise<UnlockState> {
  const guard = await resolveGuardHash(item);
  if (!guard) return { required: false };
  const held = await readCredentials();
  return { required: true, unlocked: constantTimeIncludes(held, credentialFor(guard)) };
}

export type UnlockResult =
  | { ok: true }
  | { ok: false; reason: 'wrong_password' | 'not_protected' };

/**
 * Verify a submitted password and, on success, record the credential.
 *
 * The credential is appended rather than replacing what's there, so unlocking a
 * second item with a different password doesn't lock the visitor out of the
 * first.
 */
export async function attemptUnlock(
  item: ProtectedItem,
  password: string,
): Promise<UnlockResult> {
  const guard = await resolveGuardHash(item);
  if (!guard) return { ok: false, reason: 'not_protected' };

  if (!(await bcrypt.compare(password, guard))) {
    return { ok: false, reason: 'wrong_password' };
  }

  const credential = credentialFor(guard);
  const held = await readCredentials();
  const next = held.includes(credential) ? held : [...held, credential];

  const store = await cookies();
  store.set(UNLOCK_COOKIE, next.join('.'), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: UNLOCK_MAX_AGE_SECONDS,
    path: '/',
  });

  return { ok: true };
}
