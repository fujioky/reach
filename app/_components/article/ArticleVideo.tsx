'use client';

// app/_components/article/ArticleVideo.tsx
// Plyr-based player for videos embedded in an article.
//
// ⚠️ Plyr touches `document` at import time, so it must never be imported at
// module scope in a component that Next renders on the server. The pattern here
// matches the mirror player: type-only import for the types, dynamic import
// inside an effect for the implementation, destroy() on unmount.
//
// Sizing lives in CSS (`.article-video` in globals.css), not inline styles.
// The height cap has to be lifted in fullscreen, and an inline style can only
// be overridden with !important — a rule that then leaks into every state.

import { useEffect, useRef, useState } from 'react';
import 'plyr/dist/plyr.css';
import type * as PlyrModule from 'plyr';

type PlyrInstance = PlyrModule.default;

/**
 * Poster URL for an in-app media path, carrying any access token along.
 *
 * The route answers 404 when no frame was ever captured, which a browser treats
 * exactly like no poster at all — so this is safe to set unconditionally.
 */
function posterUrl(src: string): string | undefined {
  if (!src.startsWith('/api/article-media/')) return undefined;
  return `${src}${src.includes('?') ? '&' : '?'}poster=1`;
}

export function ArticleVideo({ src, caption }: { src: string; caption?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const plyrRef = useRef<PlyrInstance | null>(null);
  const [portrait, setPortrait] = useState(false);

  useEffect(() => {
    if (!videoRef.current) return;
    let instance: PlyrInstance | null = null;
    let cancelled = false;

    import('plyr')
      .then((mod) => {
        if (cancelled || !videoRef.current) return;
        instance = new mod.default(videoRef.current, {
          controls: [
            'play-large',
            'play',
            'progress',
            'current-time',
            'duration',
            'mute',
            'volume',
            'settings',
            'fullscreen',
          ],
          settings: ['speed'],
          speed: { selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 2] },
          ratio: undefined, // let the file's own dimensions decide
          hideControls: true,
          keyboard: { focused: true, global: false },
        });
        plyrRef.current = instance;
      })
      .catch(() => {
        // Plyr failed to load — the native <video controls> underneath still
        // plays, so there is nothing to recover from.
      });

    return () => {
      cancelled = true;
      instance?.destroy();
      plyrRef.current = null;
    };
  }, []);

  return (
    <figure className="my-7">
      <div
        className={`article-video mx-auto overflow-hidden rounded-xl bg-black shadow-md ring-1 ring-border/60 ${
          portrait ? 'article-video--portrait' : 'w-full'
        }`}
      >
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          ref={videoRef}
          src={src}
          // A captured first frame, when one exists. The route 404s if not,
          // which the browser treats the same as no poster at all.
          poster={posterUrl(src)}
          controls
          playsInline
          preload="metadata"
          onLoadedMetadata={(e) => {
            const el = e.currentTarget;
            // Portrait clips shrink to their natural width so they sit as a
            // centered column instead of a letterboxed full-width band.
            if (el.videoHeight > el.videoWidth) setPortrait(true);
          }}
          className="block h-auto w-full"
        />
      </div>
      {caption && (
        <figcaption className="mt-2.5 text-center text-[13px] leading-relaxed text-subtle">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}
