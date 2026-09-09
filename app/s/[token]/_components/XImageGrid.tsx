'use client';

// app/s/[token]/_components/XImageGrid.tsx
// X-style image grid + full-screen lightbox viewer.
//
// Grid layout mirrors the official X (Twitter) image arrangement:
//   1 image  — full width, 16:9 aspect ratio
//   2 images — side by side, each 1:1
//   3 images — left: 1 tall (half-height rows), right: 2 stacked 1:1
//   4 images — 2×2 grid, each 1:1
//   5+        — first image full-width 16:9, rest wrap 2-per-row below
//
// Lightbox:
//   - Click any image to open full-screen overlay
//   - Left/Right arrow keys and on-screen buttons to navigate
//   - ESC or backdrop click to close
//   - Swipe left/right on touch devices

import { useState, useEffect, useCallback, useRef } from 'react';

interface XImageGridProps {
  images: { src: string; alt: string }[];
}

// ─── Lightbox ────────────────────────────────────────────────────────────────

function Lightbox({
  images,
  index,
  onClose,
  onPrev,
  onNext,
}: {
  images: { src: string; alt: string }[];
  index: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  // Touch swipe
  const touchStartX = useRef<number | null>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') onPrev();
      if (e.key === 'ArrowRight') onNext();
    },
    [onClose, onPrev, onNext],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    // Prevent body scroll while lightbox is open
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [handleKeyDown]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/92"
      onClick={onClose}
      onTouchStart={(e) => { touchStartX.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        if (touchStartX.current === null) return;
        const dx = e.changedTouches[0].clientX - touchStartX.current;
        touchStartX.current = null;
        if (dx < -50) onNext();
        else if (dx > 50) onPrev();
      }}
    >
      {/* Close button */}
      <button
        type="button"
        aria-label="关闭"
        onClick={onClose}
        className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition-colors hover:bg-black/70"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      {/* Prev button */}
      {images.length > 1 && (
        <button
          type="button"
          aria-label="上一张"
          onClick={(e) => { e.stopPropagation(); onPrev(); }}
          className="absolute left-3 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition-colors hover:bg-black/70 disabled:opacity-30"
          disabled={index === 0}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      )}

      {/* Image */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={images[index].src}
        alt={images[index].alt}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90dvh] max-w-[92vw] select-none rounded-md object-contain shadow-2xl"
        draggable={false}
      />

      {/* Next button */}
      {images.length > 1 && (
        <button
          type="button"
          aria-label="下一张"
          onClick={(e) => { e.stopPropagation(); onNext(); }}
          className="absolute right-3 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition-colors hover:bg-black/70 disabled:opacity-30"
          disabled={index === images.length - 1}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      )}

      {/* Dot indicators */}
      {images.length > 1 && (
        <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-1.5">
          {images.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`第 ${i + 1} 张`}
              onClick={(e) => { e.stopPropagation(); /* navigate directly */ }}
              className={`h-1.5 rounded-full transition-all ${i === index ? 'w-4 bg-white' : 'w-1.5 bg-white/40'}`}
            />
          ))}
        </div>
      )}

      {/* Counter */}
      {images.length > 1 && (
        <div className="absolute left-4 top-4 rounded-full bg-black/50 px-2.5 py-0.5 text-[12px] text-white/80 backdrop-blur-sm">
          {index + 1} / {images.length}
        </div>
      )}
    </div>
  );
}

// ─── Image tile helper ────────────────────────────────────────────────────────

function Tile({
  src,
  alt,
  className,
  onClick,
}: {
  src: string;
  alt: string;
  className: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`overflow-hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${className}`}
      aria-label={`查看 ${alt}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className="h-full w-full object-cover transition-transform duration-200 hover:scale-[1.02]"
        draggable={false}
      />
    </button>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function XImageGrid({ images }: XImageGridProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const n = images.length;

  const open = (i: number) => setLightboxIndex(i);
  const close = () => setLightboxIndex(null);
  const prev = () => setLightboxIndex((i) => (i !== null && i > 0 ? i - 1 : i));
  const next = () => setLightboxIndex((i) => (i !== null && i < n - 1 ? i + 1 : i));

  if (n === 0) return null;

  // ── 1 image ──────────────────────────────────────────────────────────────
  if (n === 1) {
    return (
      <>
        <div className="mt-3 overflow-hidden rounded-xl">
          <Tile
            src={images[0].src}
            alt={images[0].alt}
            className="aspect-[16/9] w-full"
            onClick={() => open(0)}
          />
        </div>
        {lightboxIndex !== null && (
          <Lightbox images={images} index={lightboxIndex} onClose={close} onPrev={prev} onNext={next} />
        )}
      </>
    );
  }

  // ── 2 images ─────────────────────────────────────────────────────────────
  if (n === 2) {
    return (
      <>
        <div className="mt-3 grid grid-cols-2 gap-0.5 overflow-hidden rounded-xl">
          {images.map((img, i) => (
            <Tile key={i} src={img.src} alt={img.alt} className="aspect-square" onClick={() => open(i)} />
          ))}
        </div>
        {lightboxIndex !== null && (
          <Lightbox images={images} index={lightboxIndex} onClose={close} onPrev={prev} onNext={next} />
        )}
      </>
    );
  }

  // ── 3 images ─────────────────────────────────────────────────────────────
  if (n === 3) {
    return (
      <>
        <div className="mt-3 grid grid-cols-2 gap-0.5 overflow-hidden rounded-xl" style={{ height: 280 }}>
          {/* Left: one tall tile */}
          <Tile src={images[0].src} alt={images[0].alt} className="h-full" onClick={() => open(0)} />
          {/* Right: two stacked */}
          <div className="flex flex-col gap-0.5">
            <Tile src={images[1].src} alt={images[1].alt} className="flex-1" onClick={() => open(1)} />
            <Tile src={images[2].src} alt={images[2].alt} className="flex-1" onClick={() => open(2)} />
          </div>
        </div>
        {lightboxIndex !== null && (
          <Lightbox images={images} index={lightboxIndex} onClose={close} onPrev={prev} onNext={next} />
        )}
      </>
    );
  }

  // ── 4 images ─────────────────────────────────────────────────────────────
  if (n === 4) {
    return (
      <>
        <div className="mt-3 grid grid-cols-2 gap-0.5 overflow-hidden rounded-xl">
          {images.map((img, i) => (
            <Tile key={i} src={img.src} alt={img.alt} className="aspect-square" onClick={() => open(i)} />
          ))}
        </div>
        {lightboxIndex !== null && (
          <Lightbox images={images} index={lightboxIndex} onClose={close} onPrev={prev} onNext={next} />
        )}
      </>
    );
  }

  // ── 5+ images: first full-width 16:9, rest 2-per-row ─────────────────────
  const rest = images.slice(1);
  // Pad to even number for clean 2-col rows
  const restPadded = rest.length % 2 === 1 ? [...rest, null] : rest;

  return (
    <>
      <div className="mt-3 flex flex-col gap-0.5 overflow-hidden rounded-xl">
        <Tile src={images[0].src} alt={images[0].alt} className="aspect-[16/9] w-full" onClick={() => open(0)} />
        <div className="grid grid-cols-2 gap-0.5">
          {restPadded.map((img, i) =>
            img ? (
              <Tile key={i + 1} src={img.src} alt={img.alt} className="aspect-square" onClick={() => open(i + 1)} />
            ) : (
              <div key="pad" className="aspect-square bg-surface-2" />
            ),
          )}
        </div>
      </div>
      {lightboxIndex !== null && (
        <Lightbox images={images} index={lightboxIndex} onClose={close} onPrev={prev} onNext={next} />
      )}
    </>
  );
}
