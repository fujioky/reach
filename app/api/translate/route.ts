// app/api/translate/route.ts
// DeepL translation proxy with server-side DB cache.
//
// POST /api/translate
//   Body: { texts: string[], target_lang?: string }
//   Returns: { translations: string[] }  (order matches input)
//
// Cache flow:
//   1. Look up all input texts in translation_cache (by SHA-256 hash × lang).
//   2. For cache hits → return stored translations immediately.
//   3. For cache misses → call DeepL in one batch, write results to cache.
//   4. Merge hits + fresh translations, return in original input order.
//
// Auth: none required (visitor pages call this endpoint).
// Rate-limiting: DeepL Free quota (500k chars/month) is the implicit limit;
// the cache means repeated content only counts once.

export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getSetting } from '@/lib/settings';
import { lookupCache, writeCache } from '@/lib/translation/cache';

export async function POST(req: NextRequest) {
  const apiKey = await getSetting('deepl_api_key');
  if (!apiKey) {
    return NextResponse.json({ error: 'Translation not configured' }, { status: 503 });
  }

  let body: { texts?: unknown; target_lang?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const texts = body.texts;
  if (!Array.isArray(texts) || texts.length === 0) {
    return NextResponse.json({ error: 'texts must be a non-empty array' }, { status: 400 });
  }
  if (texts.length > 50) {
    return NextResponse.json({ error: 'Too many texts (max 50)' }, { status: 400 });
  }
  const targetLang = typeof body.target_lang === 'string' ? body.target_lang : 'ZH';
  const inputTexts = texts as string[];

  // ── Step 1: cache lookup ─────────────────────────────────────────────────
  const cacheHits = await lookupCache(inputTexts, targetLang);

  // Separate hits from misses (preserve original indices)
  const misses: { text: string; originalIndex: number }[] = [];
  for (let i = 0; i < inputTexts.length; i++) {
    if (!cacheHits.has(inputTexts[i])) {
      misses.push({ text: inputTexts[i], originalIndex: i });
    }
  }

  // If all texts were cached, return immediately without calling DeepL
  const translations = new Array<string>(inputTexts.length);
  for (let i = 0; i < inputTexts.length; i++) {
    const hit = cacheHits.get(inputTexts[i]);
    if (hit !== undefined) translations[i] = hit;
  }

  if (misses.length === 0) {
    return NextResponse.json({ translations, cached: true });
  }

  // ── Step 2: call DeepL for cache misses ──────────────────────────────────
  const baseUrl = apiKey.endsWith(':fx')
    ? 'https://api-free.deepl.com/v2/translate'
    : 'https://api.deepl.com/v2/translate';

  try {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        Authorization: `DeepL-Auth-Key ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: misses.map((m) => m.text),
        target_lang: targetLang,
        // Preserve formatting — important for multi-line text
        preserve_formatting: true,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return NextResponse.json(
        { error: `DeepL error ${res.status}: ${errText.slice(0, 200)}` },
        { status: 502 },
      );
    }

    const data = await res.json() as { translations: { text: string }[] };
    const freshTranslations = data.translations.map((t) => t.text);

    // ── Step 3: write new translations to cache (fire-and-forget) ───────────
    void writeCache(
      misses.map((m, i) => ({ source: m.text, translated: freshTranslations[i] })),
      targetLang,
    );

    // ── Step 4: merge hits + fresh into original order ────────────────────
    for (let i = 0; i < misses.length; i++) {
      translations[misses[i].originalIndex] = freshTranslations[i];
    }

    return NextResponse.json({ translations });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
