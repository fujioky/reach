// lib/auth/session-duration.ts
// Session lifetimes for admin "remember me" login.

/** 30 days — persistent login when "remember me" is checked */
export const SESSION_REMEMBER_MAX_AGE_SEC = 30 * 24 * 60 * 60;
export const SESSION_REMEMBER_MAX_AGE_MS = SESSION_REMEMBER_MAX_AGE_SEC * 1000;

/** 8 hours — browser session when "remember me" is unchecked */
export const SESSION_EPHEMERAL_MAX_AGE_SEC = 8 * 60 * 60;
export const SESSION_EPHEMERAL_MAX_AGE_MS = SESSION_EPHEMERAL_MAX_AGE_SEC * 1000;

export function parseRememberMe(value: FormDataEntryValue | null | undefined): boolean {
  if (value === null || value === undefined) return false;
  const s = String(value);
  return s === 'true' || s === 'on' || s === '1';
}

export function sessionMaxAgeSec(remember: boolean): number {
  return remember ? SESSION_REMEMBER_MAX_AGE_SEC : SESSION_EPHEMERAL_MAX_AGE_SEC;
}

export function sessionMaxAgeMs(remember: boolean): number {
  return remember ? SESSION_REMEMBER_MAX_AGE_MS : SESSION_EPHEMERAL_MAX_AGE_MS;
}