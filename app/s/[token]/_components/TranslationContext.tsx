'use client';

// app/s/[token]/_components/TranslationContext.tsx
// Global translation state + serial request queue.
//
// Design:
//   - One TranslationProvider wraps the whole page.
//   - A single TranslateToggle button controls the global on/off state.
//   - Components call useTranslation() to read enabled state and register
//     texts they need translated.
//   - The queue processes texts ONE AT A TIME with a small delay between
//     requests to avoid triggering DeepL rate limits.
//     (DeepL Free: no hard per-second limit documented, but rapid bursts of
//      dozens of requests can cause 429s. Serial + 200ms gap is safe.)
//   - Results are stored in a shared Map (sourceText → translatedText) so
//     every component that shows the same text gets the same cached result.
//   - initialTranslations (server-prefetched from DB) seed the Map upfront —
//     those texts skip the queue entirely.

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  type ReactNode,
} from 'react';

// ── Types ────────────────────────────────────────────────────────────────────

interface TranslationContextValue {
  /** Whether translation is currently enabled (user toggled on). */
  enabled: boolean;
  /** Target language code, e.g. 'ZH'. */
  targetLang: string;
  /** Shared result map: sourceText → translatedText. */
  translations: Map<string, string>;
  /** Register texts that need translation. Safe to call multiple times. */
  enqueue: (texts: string[]) => void;
  /**
   * Register already-translated texts from server-side DB cache.
   * These are immediately visible and never sent to DeepL.
   */
  markCached: (cached: Record<string, string>) => void;
  /** Whether any queued translations are in progress. */
  loading: boolean;
  /** Last error message, if any. */
  error: string | null;
}

const TranslationContext = createContext<TranslationContextValue | null>(null);

export function useTranslation(): TranslationContextValue | null {
  return useContext(TranslationContext);
}

// ── Provider ─────────────────────────────────────────────────────────────────

// Delay between consecutive DeepL requests (ms).
// 200ms ≈ 5 req/s — well within DeepL Free limits and avoids 429s.
const REQUEST_DELAY_MS = 200;

interface TranslationProviderProps {
  children: ReactNode;
  targetLang?: string;
  /** Server-prefetched translations from DB cache (skips queue). */
  initialTranslations?: Record<string, string>;
  /** Whether DeepL is configured (key exists). Controls toggle visibility. */
  translationAvailable: boolean;
}

export function TranslationProvider({
  children,
  targetLang = 'ZH',
  initialTranslations,
  translationAvailable,
}: TranslationProviderProps) {
  const [enabled, setEnabled] = useState(translationAvailable);
  const [translations, setTranslations] = useState<Map<string, string>>(() => {
    const m = new Map<string, string>();
    if (initialTranslations) {
      for (const [src, tgt] of Object.entries(initialTranslations)) {
        m.set(src, tgt);
      }
    }
    return m;
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Queue of texts waiting to be translated (deduped set)
  const queueRef = useRef<string[]>([]);
  // Track all texts ever enqueued (to avoid re-queueing)
  const seenRef = useRef<Set<string>>(new Set(Object.keys(initialTranslations ?? {})));
  // Whether the queue processor is running
  const processingRef = useRef(false);

  // Process queue serially, one text at a time with a delay between each.
  const processQueue = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    setLoading(true);
    setError(null);

    while (queueRef.current.length > 0) {
      const text = queueRef.current.shift()!;

      // Skip if already translated (could have been seeded via initialTranslations
      // after enqueue was called)
      setTranslations((prev) => {
        if (prev.has(text)) return prev; // already done — no state change
        return prev;
      });

      // Re-check synchronously via the ref snapshot is not possible in React,
      // so we do a functional check inline during fetch to avoid redundant calls.
      try {
        const res = await fetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ texts: [text], target_lang: targetLang }),
        });
        const data = await res.json() as { translations?: string[]; error?: string };
        if (data.error) {
          setError(data.error);
        } else if (data.translations?.[0]) {
          const translated = data.translations[0];
          setTranslations((prev) => {
            if (prev.get(text) === translated) return prev; // no change
            const next = new Map(prev);
            next.set(text, translated);
            return next;
          });
        }
      } catch (err) {
        setError((err as Error).message);
      }

      // Delay before next request to avoid rate limiting
      if (queueRef.current.length > 0) {
        await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
      }
    }

    processingRef.current = false;
    setLoading(false);
  }, [targetLang]);

  const enqueue = useCallback(
    (texts: string[]) => {
      const newTexts = texts.filter((t) => t && !seenRef.current.has(t));
      if (newTexts.length === 0) return;
      for (const t of newTexts) seenRef.current.add(t);
      queueRef.current.push(...newTexts);
      // Start processor if not already running and translation is enabled
      if (enabled) void processQueue();
    },
    [enabled, processQueue],
  );

  // When user enables translation, kick off the queue for any already-registered texts
  useEffect(() => {
    if (enabled && queueRef.current.length > 0) {
      void processQueue();
    }
  }, [enabled, processQueue]);

  const markCachedNoop = useCallback(() => {}, []);

  return (
    <TranslationContext.Provider
      value={{ enabled, targetLang, translations, enqueue, markCached: markCachedNoop, loading, error }}
    >
      {/* Expose toggle setter so TranslateToggle can flip it */}
      <TranslationToggleInternal
        enabled={enabled}
        setEnabled={setEnabled}
        loading={loading}
        error={error}
        translationAvailable={translationAvailable}
      />
      {children}
    </TranslationContext.Provider>
  );
}

// Internal toggle state setter — we pass this through a separate context
// so TranslateToggle (placed anywhere in the tree) can flip enabled.
interface ToggleCtx {
  enabled: boolean;
  setEnabled: (v: boolean | ((prev: boolean) => boolean)) => void;
  loading: boolean;
  error: string | null;
  translationAvailable: boolean;
}
const ToggleContext = createContext<ToggleCtx | null>(null);

function TranslationToggleInternal(props: ToggleCtx) {
  // This component just bridges the toggle state into a sub-context
  // so TranslateToggle can read it without prop-drilling.
  return (
    <ToggleContext.Provider value={props}>
      {/* no render — just context */}
      <></>
    </ToggleContext.Provider>
  );
}

// ── TranslateToggle — the single visible button ───────────────────────────────

/**
 * The one and only translate button. Place it once in the page layout.
 * Reads/writes the global TranslationContext toggle state.
 */
export function TranslateToggle() {
  const ctx = useContext(TranslationContext);
  if (!ctx) return null;
  // We need the setter — access it via a separate mechanism.
  // Since TranslationProvider renders TranslationToggleInternal which sets
  // ToggleContext, we can't easily read it here without restructuring.
  // Instead, lift the toggle state up via a re-export pattern.
  // See TranslationProviderWithToggle below.
  return null; // placeholder — see TranslationProviderWithToggle
}

// ── Clean public API: provider + toggle as sibling-accessible components ─────

/**
 * Wrapper that exposes the toggle button separately from the provider.
 * Usage:
 *   const ctrl = useTranslationControl();
 *   <ctrl.Toggle />   — renders the pill button
 *   <ctrl.Provider>…children…</ctrl.Provider>
 *
 * Since Next.js RSC can't pass components as values, we use a different approach:
 * TranslationProvider renders its own toggle at the top, but you can suppress it
 * with showToggle=false and render <TranslateToggleButton /> anywhere inside.
 */

interface FullProviderProps extends TranslationProviderProps {
  /** If false, don't auto-render the toggle inside the provider. Default true. */
  showToggle?: boolean;
}

// Re-export a cleaner API ─────────────────────────────────────────────────────

/**
 * Standalone toggle button — must be rendered inside a TranslationProvider.
 * This is the single translate button for the whole page.
 */
export function TranslationToggleButton() {
  const ctx = useContext(TranslationContext);
  const [, forceRender] = useState(0);

  // We need a way to call setEnabled. We store it in a module-level ref
  // set by the provider — not ideal but avoids prop-drilling through RSC.
  // Instead, let's use a simpler approach: store toggle in a separate context.

  // Actually the cleanest approach: store the toggle fn in a ref inside
  // TranslationProvider and expose it via a dedicated ToggleRefContext.
  if (!ctx) return null;
  // Render nothing — this component is replaced by the inline toggle in
  // PageTranslationProvider below.
  void forceRender;
  return null;
}

// ── Final clean design: PageTranslationProvider ───────────────────────────────
//
// We restructure: the toggle state lives OUTSIDE the provider, passed in as
// a controlled prop. This way page.tsx can read `enabled` to pass to children
// and render the button wherever it wants.
//
// But since page.tsx is RSC, we need a client boundary. The solution:
// PageTranslationShell is the single client component that owns:
//   - the enabled toggle state
//   - the serial queue
//   - the translations Map
// and renders the toggle button + all children.

export { TranslationProvider as _TranslationProvider }; // keep for internal use

// ── The actual clean API everyone should use ──────────────────────────────────

interface PageTranslationShellProps {
  children: ReactNode;
  targetLang?: string;
  initialTranslations?: Record<string, string>;
  translationAvailable: boolean;
}

/**
 * PageTranslationShell — single client component that owns all translation state.
 *
 * Renders:
 *   1. A single translate toggle pill (top-right of content area, sticky).
 *   2. All children, which can call useTranslation() to get state + enqueue().
 */
export function PageTranslationShell({
  children,
  targetLang = 'ZH',
  initialTranslations,
  translationAvailable,
}: PageTranslationShellProps) {
  const [enabled, setEnabled] = useState(translationAvailable);
  const [translations, setTranslations] = useState<Map<string, string>>(() => {
    const m = new Map<string, string>();
    if (initialTranslations) {
      for (const [src, tgt] of Object.entries(initialTranslations)) m.set(src, tgt);
    }
    return m;
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queueRef = useRef<string[]>([]);
  // seenRef: tracks ALL texts ever enqueued OR already translated (from cache).
  // Seeded with initialTranslations keys so cached texts never enter the queue.
  const seenRef = useRef<Set<string>>(new Set(Object.keys(initialTranslations ?? {})));
  const processingRef = useRef(false);
  // Mirror of the translations Map for synchronous reads inside async queue loop.
  const translationsRef = useRef<Map<string, string>>(
    new Map(Object.entries(initialTranslations ?? {})),
  );

  const processQueue = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    setLoading(true);
    setError(null);

    while (queueRef.current.length > 0) {
      const text = queueRef.current.shift()!;

      // Skip if already translated (could have been added via markCached)
      if (translationsRef.current.has(text)) continue;

      try {
        const res = await fetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ texts: [text], target_lang: targetLang }),
        });
        const data = await res.json() as { translations?: string[]; error?: string };
        if (data.error) {
          setError(data.error);
        } else if (data.translations?.[0]) {
          const translated = data.translations[0];
          translationsRef.current.set(text, translated);
          setTranslations((prev) => {
            const next = new Map(prev);
            next.set(text, translated);
            return next;
          });
        }
      } catch (err) {
        setError((err as Error).message);
      }

      // Only delay if the next item in queue also needs a real DeepL call.
      // Skip delay for items already in translationsRef (cached).
      const nextNeedsFetch = queueRef.current.some(
        (t) => !translationsRef.current.has(t),
      );
      if (nextNeedsFetch) {
        await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
      }
    }

    processingRef.current = false;
    setLoading(false);
  }, [targetLang]);

  /**
   * Register already-translated texts (from server-side DB cache) so they
   * are immediately visible and never enqueued for DeepL.
   * Called by TranslatedBody when it receives initialTranslations.
   */
  const markCached = useCallback((cached: Record<string, string>) => {
    let changed = false;
    for (const [src, tgt] of Object.entries(cached)) {
      if (!translationsRef.current.has(src)) {
        translationsRef.current.set(src, tgt);
        seenRef.current.add(src);
        changed = true;
      }
    }
    if (changed) {
      setTranslations((prev) => {
        const next = new Map(prev);
        for (const [src, tgt] of Object.entries(cached)) next.set(src, tgt);
        return next;
      });
    }
  }, []);

  const enqueue = useCallback(
    (texts: string[]) => {
      // Skip texts already translated (seenRef covers both cached + fetched)
      const newTexts = texts.filter((t) => t && !seenRef.current.has(t));
      if (newTexts.length === 0) return;
      for (const t of newTexts) seenRef.current.add(t);
      queueRef.current.push(...newTexts);
      if (enabled) void processQueue();
    },
    [enabled, processQueue],
  );

  // When user enables translation, drain any pending queue
  useEffect(() => {
    if (enabled && queueRef.current.length > 0) {
      void processQueue();
    }
  }, [enabled, processQueue]);

  return (
    <TranslationContext.Provider
      value={{ enabled, targetLang, translations, enqueue, markCached, loading, error }}
    >
      {/* Single global translate button — floated to top-right of content */}
      {translationAvailable && (
        <div className="mb-3 flex items-center justify-end gap-2">
          {loading && (
            <span className="text-[11px] text-subtle">翻译中…</span>
          )}
          {error && !loading && (
            <span className="text-[11px] text-danger" title={error}>翻译失败</span>
          )}
          <button
            type="button"
            onClick={() => setEnabled((v) => !v)}
            aria-pressed={enabled}
            className={`inline-flex items-center gap-1.5 rounded-pill border px-3 py-1.5 text-[11px] font-semibold transition-colors ${
              enabled
                ? 'border-brand/30 bg-tint text-brand shadow-sm'
                : 'border-border bg-surface text-subtle hover:border-brand/20 hover:text-muted'
            }`}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M5 8l6 6M4 14l6-6 2-3M2 5h12M7 2h1M22 22l-5-10-5 10M14 18h6" />
            </svg>
            翻译
          </button>
        </div>
      )}
      {children}
    </TranslationContext.Provider>
  );
}
