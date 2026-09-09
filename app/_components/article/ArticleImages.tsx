'use client';

// app/_components/article/ArticleImages.tsx
// Image presentation for article bodies: an X-style grid for a run of images,
// a full-bleed single image, and a shared full-screen viewer.
//
// The grid geometry follows X (Twitter) because that arrangement is what
// readers already parse at a glance. Single images deliberately do NOT: a feed
// crops everything to a uniform ratio to keep the timeline even, but a photo in
// an article is content — cropping a tall screenshot to 16:9 would cut away the
// thing the paragraph is talking about. So one image keeps its own aspect
// ratio; two or more get the grid.

import { useCallback, useEffect, useRef, useState } from 'react';
import { responsiveImage, SIZES } from '@/lib/article/image-srcset';

export interface ArticleImage {
  src: string;
  alt: string;
}

// ─── Full-screen viewer ──────────────────────────────────────────────────────

function Viewer({
  images,
  index,
  onClose,
  onNavigate,
}: {
  images: ArticleImage[];
  index: number;
  onClose: () => void;
  onNavigate: (next: number) => void;
}) {
  const touchStartX = useRef<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const many = images.length > 1;

  const prev = useCallback(() => {
    if (index > 0) onNavigate(index - 1);
  }, [index, onNavigate]);
  const next = useCallback(() => {
    if (index < images.length - 1) onNavigate(index + 1);
  }, [index, images.length, onNavigate]);

  useEffect(() => {
    setLoaded(false);
  }, [index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'ArrowRight') next();
    };
    document.addEventListener('keydown', onKey);

    // Lock the page behind the overlay, and compensate for the scrollbar so
    // the article doesn't visibly shift as it disappears.
    const { body } = document;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    const prevOverflow = body.style.overflow;
    const prevPadding = body.style.paddingRight;
    body.style.overflow = 'hidden';
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;

    return () => {
      document.removeEventListener('keydown', onKey);
      body.style.overflow = prevOverflow;
      body.style.paddingRight = prevPadding;
    };
  }, [onClose, prev, next]);

  const current = images[index];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={current.alt || '图片查看器'}
      className="fixed inset-0 z-50 flex flex-col bg-black/95 backdrop-blur-sm"
      onClick={onClose}
      onTouchStart={(e) => {
        touchStartX.current = e.touches[0].clientX;
      }}
      onTouchEnd={(e) => {
        if (touchStartX.current === null) return;
        const dx = e.changedTouches[0].clientX - touchStartX.current;
        touchStartX.current = null;
        if (dx < -50) next();
        else if (dx > 50) prev();
      }}
    >
      {/* Top bar */}
      <div className="flex shrink-0 items-center justify-between px-4 py-3">
        <span className="text-[13px] tabular-nums text-white/70">
          {many ? `${index + 1} / ${images.length}` : ''}
        </span>
        <button
          type="button"
          aria-label="关闭"
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Stage */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-4">
        {many && index > 0 && (
          <button
            type="button"
            aria-label="上一张"
            onClick={(e) => {
              e.stopPropagation();
              prev();
            }}
            className="absolute left-2 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 md:left-6"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        )}

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={current.src}
          src={current.src}
          alt={current.alt}
          onLoad={() => setLoaded(true)}
          onClick={(e) => e.stopPropagation()}
          draggable={false}
          className={`max-h-full max-w-full select-none object-contain transition-opacity duration-200 ${
            loaded ? 'opacity-100' : 'opacity-0'
          }`}
        />

        {many && index < images.length - 1 && (
          <button
            type="button"
            aria-label="下一张"
            onClick={(e) => {
              e.stopPropagation();
              next();
            }}
            className="absolute right-2 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 md:right-6"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        )}
      </div>

      {/* Bottom: caption + thumbnails */}
      <div className="shrink-0 px-4 pb-4 pt-3" onClick={(e) => e.stopPropagation()}>
        {current.alt && (
          <p className="mx-auto mb-3 max-w-2xl text-center text-[13px] leading-relaxed text-white/70">
            {current.alt}
          </p>
        )}
        {many && (
          <div className="flex justify-center gap-2 overflow-x-auto">
            {images.map((image, i) => (
              <button
                key={image.src}
                type="button"
                aria-label={`第 ${i + 1} 张`}
                aria-current={i === index}
                onClick={() => onNavigate(i)}
                className={`h-12 w-12 shrink-0 overflow-hidden rounded-md transition-all ${
                  i === index
                    ? 'ring-2 ring-white'
                    : 'opacity-45 hover:opacity-80'
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  {...responsiveImage(image.src, '48px')}
                  alt=""
                  className="h-full w-full object-cover"
                  draggable={false}
                />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Grid tile ───────────────────────────────────────────────────────────────

function Tile({
  image,
  className,
  onOpen,
}: {
  image: ArticleImage;
  className: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={image.alt ? `查看图片：${image.alt}` : '查看图片'}
      className={`group relative overflow-hidden bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${className}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        {...responsiveImage(image.src, SIZES.half)}
        alt={image.alt}
        loading="lazy"
        decoding="async"
        draggable={false}
        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
      />
    </button>
  );
}

// ─── Single image ────────────────────────────────────────────────────────────

/**
 * One image, at its own aspect ratio.
 *
 * `max-h-[80vh]` is the one concession: a very tall screenshot would otherwise
 * push the following paragraph a full screen away.
 */
export function ArticleFigure({ image }: { image: ArticleImage }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <figure className="my-7">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={image.alt ? `查看图片：${image.alt}` : '查看图片'}
          className="block w-full cursor-zoom-in overflow-hidden rounded-xl ring-1 ring-border/70 transition-shadow hover:shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            {...responsiveImage(image.src, SIZES.column)}
            alt={image.alt}
            loading="lazy"
            decoding="async"
            className="mx-auto max-h-[80vh] w-auto max-w-full object-contain"
          />
        </button>
        {image.alt && (
          <figcaption className="mt-2.5 text-center text-[13px] leading-relaxed text-subtle">
            {image.alt}
          </figcaption>
        )}
      </figure>

      {open && (
        <Viewer images={[image]} index={0} onClose={() => setOpen(false)} onNavigate={() => {}} />
      )}
    </>
  );
}

// ─── Grid ────────────────────────────────────────────────────────────────────

/**
 * A run of images, laid out the way X arranges an attachment set.
 *
 * 2 → side by side · 3 → one tall + two stacked · 4 → 2×2 ·
 * 5+ → first full width, the rest in pairs.
 */
export function ArticleImageGrid({ images }: { images: ArticleImage[] }) {
  const [index, setIndex] = useState<number | null>(null);
  const open = (i: number) => setIndex(i);
  const n = images.length;

  if (n === 0) return null;
  if (n === 1) return <ArticleFigure image={images[0]} />;

  const viewer =
    index !== null ? (
      <Viewer images={images} index={index} onClose={() => setIndex(null)} onNavigate={setIndex} />
    ) : null;

  const shell = 'my-7 grid gap-1 overflow-hidden rounded-xl ring-1 ring-border/70';

  if (n === 2) {
    return (
      <>
        <div className={`${shell} grid-cols-2`}>
          {images.map((image, i) => (
            <Tile key={image.src} image={image} className="aspect-square" onOpen={() => open(i)} />
          ))}
        </div>
        {viewer}
      </>
    );
  }

  if (n === 3) {
    return (
      <>
        {/* aspect-[16/10] rather than a fixed pixel height: the article column
            is much wider than a tweet, and 280px would look like a filmstrip. */}
        <div className={`${shell} aspect-[16/10] grid-cols-2`}>
          <Tile image={images[0]} className="h-full" onOpen={() => open(0)} />
          <div className="grid grid-rows-2 gap-1">
            <Tile image={images[1]} className="h-full" onOpen={() => open(1)} />
            <Tile image={images[2]} className="h-full" onOpen={() => open(2)} />
          </div>
        </div>
        {viewer}
      </>
    );
  }

  if (n === 4) {
    return (
      <>
        <div className={`${shell} grid-cols-2`}>
          {images.map((image, i) => (
            <Tile key={image.src} image={image} className="aspect-square" onOpen={() => open(i)} />
          ))}
        </div>
        {viewer}
      </>
    );
  }

  const rest = images.slice(1);
  return (
    <>
      <div className={`${shell} grid-cols-1`}>
        <Tile image={images[0]} className="aspect-[16/9]" onOpen={() => open(0)} />
        <div className="grid grid-cols-2 gap-1">
          {rest.map((image, i) => (
            <Tile key={image.src} image={image} className="aspect-square" onOpen={() => open(i + 1)} />
          ))}
          {/* Odd tail: fill the gap so the last row keeps the grid rhythm. */}
          {rest.length % 2 === 1 && <div className="aspect-square bg-surface-2" aria-hidden="true" />}
        </div>
      </div>
      {viewer}
    </>
  );
}
