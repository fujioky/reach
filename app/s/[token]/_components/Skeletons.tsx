// app/s/[token]/_components/Skeletons.tsx
// Suspense fallback components for the visitor page (D-43, D-44).
//
// These render while the async subcomponents (MediaGallery/CommentList/
// VideoSection) are fetching data and streaming in.

// ── GallerySkeleton: grey placeholder blocks for the image grid ──
export function GallerySkeleton() {
  return (
    <div className="mt-4 grid grid-cols-2 gap-2.5" aria-hidden="true">
      <div className="aspect-square animate-pulse rounded-lg bg-surface-2" />
      <div className="aspect-square animate-pulse rounded-lg bg-surface-2" />
    </div>
  );
}

// ── CommentsSkeleton: grey bars simulating comment rows ──
export function CommentsSkeleton() {
  return (
    <div aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className={`flex gap-3 py-4 ${i < 2 ? 'border-b border-border/60' : ''}`}
        >
          <div className="h-9 w-9 animate-pulse rounded-full bg-surface-2" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 w-[120px] animate-pulse rounded-md bg-surface-2" />
            <div className="h-3.5 w-4/5 animate-pulse rounded-md bg-surface-2" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── VideoPreparing: D-43 "正在准备视频…" loading hint ──
// CSS spinner (className="spinner") + text. The spinner rotation is a CSS
// keyframe animation defined in app/s/[token]/visitor.css.
// prefers-reduced-motion disables the animation (a11y, handled in globals.css).
// The spinner is decorative (aria-hidden); the text remains readable by
// screen readers (role="status" aria-live="polite").
export function VideoPreparing() {
  return (
    <div
      className="flex aspect-video w-full items-center justify-center gap-3 bg-surface-2/70 text-sm text-muted"
      role="status"
      aria-live="polite"
    >
      <span className="spinner" aria-hidden="true" />
      <span>正在准备视频…</span>
    </div>
  );
}
