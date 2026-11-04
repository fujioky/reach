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

import { useEffect, useState } from 'react';
import { Viewer } from '@/app/_components/article/ArticleImages';
import { useTranslation } from './TranslationContext';
import { bodyImageUrl } from '@/lib/content/body-images';

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
  /**
   * Inline images: original URL → displayable src. A paragraph that is an
   * inline-image line renders as that image (or nothing, when it has no src);
   * it is never shown as text or sent for translation.
   */
  inlineImages?: Record<string, string>;
  /**
   * Render `#`-marked paragraphs as headings (h2 for # and ##, h3 below) with
   * ids, so a TableOfContents can outline them. X Articles only.
   */
  headings?: boolean;
  /** Prefix for heading ids; also the outline's container id is up to the caller. */
  headingIdPrefix?: string;
}

const HEADING_RE = /^(#{1,6})\s+(.+)$/;

/** Heading level and text when the paragraph is a single `#` line. */
function parseHeading(para: string): { level: number; text: string } | null {
  if (para.includes('\n')) return null;
  const m = HEADING_RE.exec(para);
  return m ? { level: m[1]!.length, text: m[2]!.trim() } : null;
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
  inlineImages = {},
  headings = false,
  headingIdPrefix = 'h',
}: TranslatedBodyProps) {
  const ctx = useTranslation();
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  const paragraphs = splitByParagraph
    ? splitParagraphs(text)
    : [text.trim()].filter(Boolean);
  // What gets translated: a heading's text without its `#` marker.
  const translatable = (p: string) => (headings ? (parseHeading(p)?.text ?? p) : p);
  // Inline images in order, for the full-screen viewer's prev/next.
  const viewerImages = paragraphs.flatMap((p) => {
    const url = bodyImageUrl(p);
    const src = url ? inlineImages[url] : undefined;
    return src ? [{ src, alt: '' }] : [];
  });

  // On mount and when ctx.enabled changes, enqueue paragraphs that aren't
  // yet translated AND aren't already in Simplified Chinese (no point translating
  // Chinese to Chinese — wastes DeepL quota and shows a redundant line).
  useEffect(() => {
    if (!ctx || !ctx.enabled) return;
    const missing = paragraphs
      .filter((p) => !bodyImageUrl(p))
      .map(translatable)
      .filter((p) => !ctx.translations.has(p) && !isChinese(p));
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
          const imageUrl = bodyImageUrl(para);
          if (imageUrl) {
            const src = inlineImages[imageUrl];
            if (!src) return null;
            const index = viewerImages.findIndex((img) => img.src === src);
            return (
              <button
                key={i}
                type="button"
                onClick={() => setViewerIndex(index)}
                aria-label="查看图片"
                className="my-1 block w-full cursor-zoom-in overflow-hidden rounded-xl ring-1 ring-border/50 transition-shadow hover:shadow-lg"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="" loading="lazy" className="w-full" />
              </button>
            );
          }
          const heading = headings ? parseHeading(para) : null;
          const source = heading ? heading.text : para;
          // Skip translation entirely for Chinese content (already the target language)
          const skipTranslation = isChinese(source);
          const translation = ctx?.enabled && !skipTranslation
            ? ctx.translations.get(source)
            : undefined;
          const isLoading = ctx?.enabled && !skipTranslation && !translation && ctx.loading;
          if (heading) {
            const Tag = heading.level <= 2 ? 'h2' : 'h3';
            return (
              <div key={i} className={heading.level <= 2 ? 'mt-4' : 'mt-2'}>
                <Tag
                  id={`${headingIdPrefix}-${i}`}
                  className={`scroll-mt-24 font-display font-bold leading-snug text-ink ${
                    heading.level <= 2 ? 'text-[1.25em]' : 'text-[1.1em]'
                  }`}
                >
                  {heading.text}
                </Tag>
                {translation && <p className="mt-1 text-[0.92em] text-muted/70">{translation}</p>}
              </div>
            );
          }
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
      {viewerIndex !== null && viewerImages.length > 0 && (
        <Viewer
          images={viewerImages}
          index={viewerIndex}
          onClose={() => setViewerIndex(null)}
          onNavigate={setViewerIndex}
        />
      )}
    </div>
  );
}
