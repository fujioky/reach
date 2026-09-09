// lib/translation/cache.ts
// Server-side translation cache backed by PostgreSQL (translation_cache table).
//
// Cache key: SHA-256(sourceText) × targetLang — content-addressed, so identical
// text reuses the same row regardless of which comment/paragraph it comes from.
//
// API:
//   lookupCache(texts, lang)  → Map<text, translatedText> for hits
//   writeCache(pairs, lang)   → upserts rows (fire-and-forget safe)
//
// Both functions are best-effort: cache misses fall back to DeepL; write errors
// are silently swallowed so a DB hiccup never breaks translation responses.

import { createHash } from 'crypto';
import { db, translationCache } from '@/lib/db';
import { inArray, and, eq } from 'drizzle-orm';

/** Compute the cache key for a source text. */
export function textHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Look up a batch of texts in the cache.
 * Returns a Map from sourceText → translatedText for cache hits.
 * Texts not in the cache are absent from the map.
 */
export async function lookupCache(
  texts: string[],
  targetLang: string,
): Promise<Map<string, string>> {
  if (texts.length === 0) return new Map();
  try {
    const hashes = texts.map(textHash);
    const rows = await db
      .select({
        textHash: translationCache.textHash,
        translatedText: translationCache.translatedText,
        sourceText: translationCache.sourceText,
      })
      .from(translationCache)
      .where(
        and(
          inArray(translationCache.textHash, hashes),
          eq(translationCache.targetLang, targetLang),
        ),
      );

    const result = new Map<string, string>();
    for (const row of rows) {
      result.set(row.sourceText, row.translatedText);
    }
    return result;
  } catch {
    // DB unavailable — treat as all cache misses
    return new Map();
  }
}

/**
 * Write translated pairs into the cache.
 * pairs: array of { source, translated }
 * Fire-and-forget: never throws, errors are silently swallowed.
 */
export async function writeCache(
  pairs: { source: string; translated: string }[],
  targetLang: string,
): Promise<void> {
  if (pairs.length === 0) return;
  try {
    const values = pairs.map((p) => ({
      textHash: textHash(p.source),
      targetLang,
      sourceText: p.source,
      translatedText: p.translated,
    }));
    await db
      .insert(translationCache)
      .values(values)
      .onConflictDoNothing(); // idempotent — same hash+lang already in cache
  } catch {
    // Best-effort — never break the caller over a cache write failure
  }
}
