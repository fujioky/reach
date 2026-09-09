// app/_components/analytics/Recorder.tsx
// Self-built analytics recorder — mounted on every visitor page (mirror
// /s/<token> and article /p/<slug>). Replaces the old Vercel-Analytics-based
// Tracker entirely.
//
// One mount = one session (crypto.randomUUID), batched to
// /api/analytics/ingest every FLUSH_MS:
//   - rrweb DOM recording (full snapshot + incrementals) → analytics_chunks,
//     replayable 1:1 at the visitor's viewport size in the admin
//   - structured events → visit_events:
//       view           once on mount
//       dwell          block-level visible time (IntersectionObserver, same
//                      semantics as the old Tracker: data-track-block)
//       media_click    clicks on [data-media-id] inside the gallery block
//       outlink_click  clicks on external links (unchanged semantics)
//       click          every click, with page coords + doc/viewport size
//                      (heatmap source)
//       scroll         max scroll depth reached (one event per increase)
//       video          play / pause / seek / progress deciles / fullscreen /
//                      ended / ratechange — captured at document level in the
//                      capture phase, so it works for any <video> (plyr
//                      included) without instrumenting the players
//
// Robustness: session meta is included in every batch until one is
// acknowledged (the ingest upsert is idempotent); the final flush goes out
// via sendBeacon with a fetch-keepalive fallback.

'use client';

import { useEffect, useRef } from 'react';
import type { recordOptions } from 'rrweb';

interface RecorderProps {
  contentItemId: string;
  shareId?: string;
  visitorId: string;
  children?: React.ReactNode;
}

interface StructuredEvent {
  type: string;
  payload?: Record<string, unknown>;
  ts: string;
}

const FLUSH_MS = 5000;
// Flush early when the rrweb buffer grows past this many events (a full
// snapshot counts as one big event; incrementals are small).
const RRWEB_BUFFER_MAX = 400;
const PROGRESS_STEP = 10; // report video progress every 10%

/** Short CSS-ish path for the clicked element: `main > div.gallery > img` */
function shortSelector(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur !== document.body && parts.length < 3) {
    let part = cur.tagName.toLowerCase();
    if (cur.id) part += `#${cur.id}`;
    else if (typeof cur.className === 'string' && cur.className.trim()) {
      part += `.${cur.className.trim().split(/\s+/)[0]}`;
    }
    parts.unshift(part);
    cur = cur.parentElement;
  }
  return parts.join(' > ');
}

function mediaIdFor(video: HTMLVideoElement): string {
  const tagged = video.closest('[data-media-id]');
  if (tagged) return tagged.getAttribute('data-media-id') ?? 'video';
  try {
    const src = video.currentSrc || video.src || '';
    return src ? new URL(src, location.origin).pathname.split('/').pop() ?? 'video' : 'video';
  } catch {
    return 'video';
  }
}

export function Recorder({ contentItemId, shareId, visitorId, children }: RecorderProps) {
  const startedRef = useRef(false);

  useEffect(() => {
    // React 18 StrictMode double-invokes effects in dev; one session per mount.
    if (startedRef.current) return;
    startedRef.current = true;

    const sessionId = crypto.randomUUID();
    const vid =
      visitorId && visitorId !== 'anonymous'
        ? visitorId
        : (() => {
            try {
              const existing = localStorage.getItem('reach_vid');
              if (existing) return existing;
              const fresh = crypto.randomUUID().replace(/-/g, '').slice(0, 21);
              localStorage.setItem('reach_vid', fresh);
              return fresh;
            } catch {
              return 'anonymous';
            }
          })();

    // ── Batching state ──
    // Nothing is dropped until the server acks (2xx): chunks and events move
    // to an outbox and are re-sent on the next flush after a failure. The
    // ingest route is idempotent on (session, seq), so retries are safe.
    // A lost first chunk would otherwise lose the rrweb full snapshot and
    // make the whole session unplayable.
    let rrwebBuffer: unknown[] = [];
    let structured: StructuredEvent[] = [];
    const chunkOutbox: { seq: number; events: unknown[] }[] = [];
    const MAX_OUTBOX_CHUNKS = 30;
    let seq = 0;
    let metaAcked = false;
    let inFlight = false;
    let stopped = false;

    // Active duration: accumulate only while the tab is visible.
    let activeMs = 0;
    let visibleSince = document.visibilityState === 'visible' ? Date.now() : null;

    const push = (type: string, payload?: Record<string, unknown>) => {
      structured.push({ type, payload, ts: new Date().toISOString() });
    };

    const buildMeta = () => ({
      screenW: window.screen.width,
      screenH: window.screen.height,
      viewportW: window.innerWidth,
      viewportH: window.innerHeight,
      dpr: Math.min(window.devicePixelRatio || 1, 10),
      lang: navigator.language?.slice(0, 35),
      referrer: document.referrer ? document.referrer.slice(0, 500) : undefined,
    });

    const currentDuration = () =>
      activeMs + (visibleSince != null ? Date.now() - visibleSince : 0);

    // Move the live rrweb buffer into the outbox as a numbered chunk.
    const sealChunk = () => {
      if (rrwebBuffer.length === 0) return;
      chunkOutbox.push({ seq, events: rrwebBuffer });
      seq += 1;
      rrwebBuffer = [];
      // Bound memory if the server stays unreachable: drop the oldest chunk
      // that does NOT contain a full snapshot (type 2) — losing incremental
      // frames degrades the replay, losing the snapshot kills it.
      if (chunkOutbox.length > MAX_OUTBOX_CHUNKS) {
        const idx = chunkOutbox.findIndex(
          (c) => !c.events.some((e) => (e as { type?: number }).type === 2),
        );
        chunkOutbox.splice(idx === -1 ? 0 : idx, 1);
      }
    };

    const flush = (final = false) => {
      if (stopped && !final) return;
      if (inFlight && !final) return;
      sealChunk();
      const chunks = chunkOutbox.slice(0, 10);
      const events = structured.slice(0, 200);
      if (chunks.length === 0 && events.length === 0 && metaAcked && !final) return;

      const body = JSON.stringify({
        sessionId,
        contentItemId,
        shareId: shareId ?? null,
        visitorId: vid,
        ...(metaAcked ? {} : { meta: buildMeta() }),
        ...(chunks.length ? { chunks } : {}),
        ...(events.length ? { events } : {}),
        durationMs: Math.round(currentDuration()),
      });

      const ack = () => {
        metaAcked = true;
        for (const c of chunks) {
          const i = chunkOutbox.indexOf(c);
          if (i !== -1) chunkOutbox.splice(i, 1);
        }
        structured = structured.slice(events.length);
      };

      if (final) {
        // Beacon first (survives unload); fall back to keepalive fetch.
        // No ack tracking — the page is going away.
        let sent = false;
        try {
          sent = navigator.sendBeacon(
            '/api/analytics/ingest',
            new Blob([body], { type: 'application/json' }),
          );
        } catch {
          sent = false;
        }
        if (!sent) {
          fetch('/api/analytics/ingest', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
            keepalive: true,
          }).catch(() => {});
        }
        return;
      }

      inFlight = true;
      fetch('/api/analytics/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
        .then((res) => {
          if (res.ok) ack();
          // non-2xx: keep everything queued, next flush retries
        })
        .catch(() => {}) // network failure: keep everything queued
        .finally(() => {
          inFlight = false;
        });
    };

    const flushTimer = window.setInterval(() => flush(), FLUSH_MS);

    // ── ① View event ──
    push('view');

    // ── ② rrweb recording ──
    let stopRecording: (() => void) | undefined;
    import('rrweb')
      .then(({ record }) => {
        if (stopped) return;
        const options: recordOptions<unknown> = {
          emit(event: unknown) {
            rrwebBuffer.push(event);
            if (rrwebBuffer.length >= RRWEB_BUFFER_MAX) flush();
          },
          maskAllInputs: false,
          sampling: { mousemove: 60, scroll: 150, media: 800, input: 'last' },
          slimDOMOptions: { script: true, comment: true },
          inlineStylesheet: true,
          collectFonts: false,
        };
        stopRecording = record(options);
      })
      .catch(() => {}); // recording is best-effort

    // ── ③ Block dwell (old Tracker semantics: data-track-block) ──
    const blockTimers = new Map<string, number>();
    const recordDwell = (blockId: string) => {
      const start = blockTimers.get(blockId);
      if (start === undefined) return;
      blockTimers.delete(blockId);
      const dwellMs = Date.now() - start;
      if (dwellMs > 0) push('dwell', { blockId, dwellMs });
    };
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const blockId = entry.target.getAttribute('data-track-block');
          if (!blockId) continue;
          if (entry.isIntersecting) blockTimers.set(blockId, Date.now());
          else recordDwell(blockId);
        }
      },
      { threshold: 0, rootMargin: '0px 0px -20% 0px' },
    );
    const observeBlocks = () => {
      document.querySelectorAll('[data-track-block]').forEach((el) => io.observe(el));
    };
    observeBlocks();
    const mo = new MutationObserver(() => observeBlocks());
    mo.observe(document.body, { childList: true, subtree: true });

    // ── ④ Clicks: heatmap source + media_click + outlink_click ──
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      const doc = document.documentElement;
      push('click', {
        x: Math.round(e.pageX),
        y: Math.round(e.pageY),
        docW: doc.scrollWidth,
        docH: doc.scrollHeight,
        viewportW: window.innerWidth,
        viewportH: window.innerHeight,
        selector: shortSelector(target),
        text: (target.textContent ?? '').trim().slice(0, 80) || undefined,
      });

      const mediaEl = target.closest('[data-media-id]');
      if (mediaEl && mediaEl.closest('[data-track-block="gallery"]')) {
        const mediaId = mediaEl.getAttribute('data-media-id');
        if (mediaId) {
          push('media_click', {
            mediaId,
            mediaType: mediaEl.tagName === 'IMG' ? 'image' : 'video',
          });
        }
        return;
      }

      const linkEl = target.closest('a[href]');
      if (!linkEl) return;
      const href = linkEl.getAttribute('href');
      if (!href) return;
      try {
        const url = new URL(href, window.location.origin);
        if (url.origin !== window.location.origin) {
          push('outlink_click', {
            url: href,
            linkContext: linkEl.getAttribute('data-link-context') ?? 'unknown',
          });
        }
      } catch {
        // invalid URL — skip
      }
    };
    document.addEventListener('click', onClick, true);

    // ── ⑤ Scroll depth ──
    let maxDepthPct = 0;
    let scrollRaf = 0;
    const onScroll = () => {
      if (scrollRaf) return;
      scrollRaf = requestAnimationFrame(() => {
        scrollRaf = 0;
        const doc = document.documentElement;
        const denom = doc.scrollHeight - window.innerHeight;
        const pct = denom > 0
          ? Math.min(100, Math.round(((window.scrollY + window.innerHeight) / doc.scrollHeight) * 100))
          : 100;
        if (pct >= maxDepthPct + 10 || (pct === 100 && maxDepthPct < 100)) {
          maxDepthPct = pct;
          push('scroll', { scrollY: Math.round(window.scrollY), depthPct: pct });
        }
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });

    // ── ⑥ Video events — document-level capture works for non-bubbling
    // media events, so every <video> (plyr-wrapped or not) is covered. ──
    const progressSent = new WeakMap<HTMLVideoElement, number>();
    // Continuous-watch spans: spanStart = where uninterrupted playback began;
    // lastTime = last observed currentTime ('seeking' fires AFTER currentTime
    // jumps, so the true seek origin is the last timeupdate position).
    const spanStart = new Map<HTMLVideoElement, number>();
    const lastTime = new Map<HTMLVideoElement, number>();
    const round1 = (n: number) => Math.round(n * 10) / 10;
    const videoPayload = (v: HTMLVideoElement, extra?: Record<string, unknown>) => ({
      mediaId: mediaIdFor(v),
      position: round1(v.currentTime),
      duration: Number.isFinite(v.duration) ? round1(v.duration) : undefined,
      ...extra,
    });
    const isVideo = (t: EventTarget | null): t is HTMLVideoElement =>
      t instanceof HTMLVideoElement;

    // Close the open watch span up to `endAt` and emit a 'range' event —
    // the per-session video timeline (看了哪些段落) is built from these.
    const closeSpan = (v: HTMLVideoElement, endAt: number) => {
      const start = spanStart.get(v);
      spanStart.delete(v);
      if (start == null || endAt <= start + 0.3) return;
      push('video', videoPayload(v, { action: 'range', from: round1(start), to: round1(endAt) }));
    };

    const onPlay = (e: Event) => {
      if (!isVideo(e.target)) return;
      spanStart.set(e.target, e.target.currentTime);
      lastTime.set(e.target, e.target.currentTime);
      push('video', videoPayload(e.target, { action: 'play' }));
    };
    const onPause = (e: Event) => {
      if (!isVideo(e.target)) return;
      const v = e.target;
      closeSpan(v, v.currentTime);
      // Skip the implicit pause right before 'ended'
      if (!v.ended) push('video', videoPayload(v, { action: 'pause' }));
    };
    const onEnded = (e: Event) => {
      if (!isVideo(e.target)) return;
      closeSpan(e.target, e.target.currentTime);
      push('video', videoPayload(e.target, { action: 'ended' }));
    };
    const onSeeking = (e: Event) => {
      if (!isVideo(e.target)) return;
      const v = e.target;
      // currentTime is already the seek target here — the origin is lastTime
      closeSpan(v, lastTime.get(v) ?? v.currentTime);
    };
    const onSeeked = (e: Event) => {
      if (!isVideo(e.target)) return;
      const v = e.target;
      const from = lastTime.get(v);
      push('video', videoPayload(v, {
        action: 'seek',
        from: from != null ? round1(from) : undefined,
        to: round1(v.currentTime),
      }));
      lastTime.set(v, v.currentTime);
      if (!v.paused) spanStart.set(v, v.currentTime);
    };
    const onRateChange = (e: Event) => {
      if (isVideo(e.target)) {
        push('video', videoPayload(e.target, { action: 'ratechange', rate: e.target.playbackRate }));
      }
    };
    const onTimeUpdate = (e: Event) => {
      if (!isVideo(e.target)) return;
      const v = e.target;
      if (v.seeking) return;
      lastTime.set(v, v.currentTime);
      if (!Number.isFinite(v.duration) || v.duration <= 0) return;
      const pct = Math.floor((v.currentTime / v.duration) * 100);
      const decile = Math.floor(pct / PROGRESS_STEP) * PROGRESS_STEP;
      const last = progressSent.get(v) ?? -1;
      if (decile > last && decile > 0) {
        progressSent.set(v, decile);
        push('video', videoPayload(v, { action: 'progress', pct: decile }));
      }
    };
    // On leave: close any span still open so long uninterrupted watching is
    // not lost, then re-open at the same spot in case the tab comes back.
    const flushOpenSpans = () => {
      for (const [v] of spanStart) {
        const at = lastTime.get(v) ?? v.currentTime;
        closeSpan(v, at);
        if (!v.paused) spanStart.set(v, at);
      }
    };
    const onFullscreenChange = () => {
      const fsEl =
        document.fullscreenElement ??
        (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement ??
        null;
      const video = fsEl?.querySelector?.('video') ?? (fsEl instanceof HTMLVideoElement ? fsEl : null);
      if (fsEl && video) {
        push('video', videoPayload(video, { action: 'fullscreen_enter' }));
      } else if (!fsEl) {
        push('video', { action: 'fullscreen_exit' });
      }
    };
    document.addEventListener('play', onPlay, true);
    document.addEventListener('pause', onPause, true);
    document.addEventListener('ended', onEnded, true);
    document.addEventListener('seeking', onSeeking, true);
    document.addEventListener('seeked', onSeeked, true);
    document.addEventListener('ratechange', onRateChange, true);
    document.addEventListener('timeupdate', onTimeUpdate, true);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);

    // ── ⑦ Visibility / unload ──
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        if (visibleSince != null) {
          activeMs += Date.now() - visibleSince;
          visibleSince = null;
        }
        for (const blockId of Array.from(blockTimers.keys())) recordDwell(blockId);
        flushOpenSpans();
        flush(true);
      } else if (visibleSince == null) {
        visibleSince = Date.now();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    const onPageHide = () => {
      for (const blockId of Array.from(blockTimers.keys())) recordDwell(blockId);
      flushOpenSpans();
      flush(true);
    };
    window.addEventListener('pagehide', onPageHide);

    return () => {
      stopped = true;
      window.clearInterval(flushTimer);
      stopRecording?.();
      io.disconnect();
      mo.disconnect();
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('play', onPlay, true);
      document.removeEventListener('pause', onPause, true);
      document.removeEventListener('ended', onEnded, true);
      document.removeEventListener('seeking', onSeeking, true);
      document.removeEventListener('seeked', onSeeked, true);
      document.removeEventListener('ratechange', onRateChange, true);
      document.removeEventListener('timeupdate', onTimeUpdate, true);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
    };
    // Recorder is mounted once per page view; identity props never change in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <>{children}</>;
}
