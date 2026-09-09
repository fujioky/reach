'use client';

// app/s/[token]/_components/TranslatedTitleUpdater.tsx
// Updates document.title with the Chinese translation of the post title.
//
// On first visits the server-side translation cache is empty, so
// generateMetadata ships the original title. This component enqueues the
// title into the translation queue and updates document.title when the
// translation arrives. On repeat visits the cache is warm and
// generateMetadata already set the correct title — this component is a
// no-op (the translation is already in the Map, no DeepL call needed).

import { useEffect } from 'react';
import { useTranslation } from './TranslationContext';

export function TranslatedTitleUpdater({ title }: { title: string }) {
  const ctx = useTranslation();

  useEffect(() => {
    if (!ctx || !ctx.enabled || !title) return;
    // Enqueue the title for translation if not already cached
    if (!ctx.translations.has(title)) {
      ctx.enqueue([title]);
    }
  }, [ctx?.enabled, title]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update document.title when the translation becomes available
  useEffect(() => {
    if (!ctx || !ctx.enabled || !title) return;
    const translated = ctx.translations.get(title);
    if (translated) {
      document.title = `${translated} — Reach`;
    }
  }, [ctx?.enabled, title, ctx?.translations]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
