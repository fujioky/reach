'use client';

// app/s/[token]/_components/TranslatedBody.tsx
// Translatable text display — consumes PageTranslationShell context.
//
// On mount (and when enabled changes) enqueues all paragraphs/texts into
// the global serial queue. The queue processes them one-by-one with a delay
// to avoid DeepL rate limits. Results come back via the shared translations
// Map in context, triggering a re-render here.
//
// Props:
//   text              — source text
//   className         — wrapper class
//   splitByParagraph  — true (default): split on blank lines; false: single unit
//   initialTranslations — server-prefetched Map to seed into context on first mount

import { useEffect } from 'react';
import { useTranslation } from './TranslationContext';

interface TranslatedBodyProps {
  text: string;
  className?: string;
  /** true (default): split on blank lines. false: treat whole text as one unit. */
  splitByParagraph?: boolean;
  /**
   * Server-prefetched translations (RSC → client).
   * Passed once; the parent PageTranslationShell seeds these into the shared Map
   * via initialTranslations. This prop is only used to enqueue missing texts.
   */
  initialTranslations?: Record<string, string>;
}

function splitParagraphs(text: string): string[] {
  return text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
}

/**
 * Detect whether a text is already Chinese (Simplified or Traditional).
 * If so, translating to ZH is a no-op — skip it to save DeepL quota and
 * avoid showing a redundant "translation" line under the original.
 *
 * Heuristic: count CJK Unified Ideographs vs total non-whitespace characters.
 * If ≥40% are CJK, the text is predominantly Chinese. This works for both
 * Simplified and Traditional — both should be skipped since DeepL's target
 * is ZH (Simplified). Traditional Chinese → Simplified conversion is a
 * nice-to-have but not worth the quota cost for what is already readable.
 *
 * For non-Chinese text (English, Japanese kana, Korean, etc.) the CJK ratio
 * will be low or zero, so translation proceeds normally.
 */
function isChinese(text: string): boolean {
  const chars = text.replace(/\s/g, '');
  if (chars.length === 0) return false;

  let cjkCount = 0;
  for (const ch of chars) {
    const code = ch.codePointAt(0)!;
    // CJK Unified Ideographs + CJK Extension A
    if ((code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf)) {
      cjkCount++;
    }
  }

  if (cjkCount === 0) return false;

  // 40% threshold allows mixed content (Chinese text with URLs/emojis/English terms)
  return cjkCount / chars.length >= 0.4;
}

export function TranslatedBody({
  text,
  className = '',
  splitByParagraph = true,
  initialTranslations,
}: TranslatedBodyProps) {
  const ctx = useTranslation();

  const paragraphs = splitByParagraph
    ? splitParagraphs(text)
    : [text.trim()].filter(Boolean);

  // On mount and when ctx.enabled changes, enqueue paragraphs that aren't
  // yet translated AND aren't already in Simplified Chinese (no point translating
  // Chinese to Chinese — wastes DeepL quota and shows a redundant line).
  useEffect(() => {
    if (!ctx || !ctx.enabled) return;
    const missing = paragraphs.filter(
      (p) => !ctx.translations.has(p) && !isChinese(p),
    );
    if (missing.length > 0) ctx.enqueue(missing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx?.enabled]);

  // Register server-prefetched translations into the shared context Map.
  // Uses markCached (not enqueue) — no DeepL call needed, instant display.
  useEffect(() => {
    if (!initialTranslations || !ctx) return;
    ctx.markCached(initialTranslations);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={className}>
      <div className="flex flex-col gap-3">
        {paragraphs.map((para, i) => {
          // Skip translation entirely for Chinese content (already the target language)
          const skipTranslation = isChinese(para);
          const translation = ctx?.enabled && !skipTranslation
            ? ctx.translations.get(para)
            : undefined;
          const isLoading = ctx?.enabled && !skipTranslation && !translation && ctx.loading;
          return (
            <div key={i}>
              <p className="whitespace-pre-wrap leading-relaxed">{para}</p>
              {translation && (
                <p className="mt-1 whitespace-pre-wrap text-[0.92em] leading-relaxed text-muted/70">
                  {translation}
                </p>
              )}
              {isLoading && (
                <div className="mt-1 h-3.5 w-3/4 animate-pulse rounded bg-surface-2" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
