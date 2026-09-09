// lib/article/slug.ts
// Slug generation and validation for the public /p/<slug> article URL.
//
// New articles get a random ASCII slug. Deriving one from the title was the
// first design, but titles here are usually Chinese, and a Chinese slug has to
// survive percent-encoding on every hop between the browser, the router and the
// database — one link that skips the round trip and the article 404s while
// still showing up in the index. A random slug sidesteps that class of bug
// entirely, and article URLs are shared as links rather than typed.
//
// An admin-supplied slug is still honoured, CJK included: slugify() normalizes
// it and the public route decodes params before looking it up.

import { customAlphabet } from 'nanoid';

/** Max slug length — keeps URLs readable and fits comfortably in an index. */
export const MAX_SLUG_LENGTH = 80;

/** Length of a generated slug: 36^10 ≈ 3.7e15, collision-checked anyway. */
const RANDOM_SLUG_LENGTH = 10;

/**
 * Lowercase alphanumerics only — no hyphen or underscore.
 *
 * nanoid's default alphabet can produce a leading or trailing hyphen, which
 * isValidSlug rejects, and mixed case would make the URL look case-sensitive
 * when the lookup is not.
 */
const randomSlug = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', RANDOM_SLUG_LENGTH);

/** A fresh random slug. Uniqueness is the caller's business. */
export function generateRandomSlug(): string {
  return randomSlug();
}

/**
 * A random slug that isn't taken yet.
 *
 * Collisions are vanishingly unlikely at this length, but the column is unique
 * so a retry loop is cheaper than an insert that throws.
 */
export async function generateUniqueSlug(
  isTaken: (slug: string) => Promise<boolean>,
): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = generateRandomSlug();
    if (!(await isTaken(candidate))) return candidate;
  }
  // Five collisions in a row means something is wrong with isTaken, not with
  // randomness — widen the space rather than loop forever.
  return `${generateRandomSlug()}${generateRandomSlug()}`.slice(0, MAX_SLUG_LENGTH);
}

/**
 * Derive a URL slug from an article title.
 *
 * Returns '' when the title yields no usable characters — the caller decides
 * the fallback (usually a random suffix), because an empty slug must never
 * reach the database.
 */
export function slugify(title: string): string {
  return (
    title
      .normalize('NFKC')
      .toLowerCase()
      .trim()
      // Keep: latin alphanumerics, CJK ideographs, hiragana/katakana, hangul.
      // Everything else (punctuation, spaces, emoji) becomes a separator.
      .replace(/[^a-z0-9㐀-䶿一-鿿぀-ヿ가-힯]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, MAX_SLUG_LENGTH)
      .replace(/-+$/g, '')
  );
}

/**
 * Validate an admin-supplied slug. Same character class as slugify() plus the
 * hyphen separator; no leading/trailing hyphen, no empty string.
 */
export function isValidSlug(slug: string): boolean {
  if (!slug || slug.length > MAX_SLUG_LENGTH) return false;
  if (slug.startsWith('-') || slug.endsWith('-')) return false;
  return /^[a-z0-9㐀-䶿一-鿿぀-ヿ가-힯-]+$/.test(slug);
}

/**
 * Normalize an admin-supplied slug, then make it unique.
 *
 * `slugify` runs first so a typed "My First Post" becomes `my-first-post`
 * instead of being rejected for spaces and capitals. Returns null when the
 * input normalizes to nothing usable — the caller reports that to the admin
 * rather than silently substituting something.
 */
export async function normalizeRequestedSlug(
  requested: string,
  isTaken: (slug: string) => Promise<boolean>,
): Promise<{ ok: true; slug: string } | { ok: false; reason: 'invalid' | 'taken' }> {
  const normalized = slugify(requested);
  if (!normalized || !isValidSlug(normalized)) return { ok: false, reason: 'invalid' };
  if (await isTaken(normalized)) return { ok: false, reason: 'taken' };
  return { ok: true, slug: normalized };
}
