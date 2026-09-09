// lib/article/image-srcset.ts
// Build srcset/sizes for an in-app article image URL.
//
// Kept apart from image-transform.ts because that module pulls in sharp and the
// Blob SDK — server-only weight that a client component must not drag in. This
// half is pure string work and safe to import anywhere.

/** Must stay in step with IMAGE_WIDTHS in image-transform.ts. */
export const SRCSET_WIDTHS = [400, 700, 1000, 1400, 2000] as const;

/** Only our own media route serves derivatives; anything else is left alone. */
const IN_APP_MEDIA = /^\/api\/article-media\//;

/** Append `w=` to a URL that may already carry an access token. */
function withWidth(url: string, width: number): string {
  return `${url}${url.includes('?') ? '&' : '?'}w=${width}`;
}

export interface ResponsiveImage {
  src: string;
  srcSet?: string;
  sizes?: string;
}

/**
 * Produce a responsive source set for an article image.
 *
 * `sizes` tells the browser how wide the image will actually be laid out, which
 * is what lets it pick a width before layout happens. Getting it wrong is the
 * usual reason srcset saves nothing — a browser given no `sizes` assumes 100vw
 * and fetches the largest candidate.
 *
 * Non-app URLs (a remote image someone pasted directly into the Markdown) come
 * back untouched: there is no derivative pipeline behind them.
 */
export function responsiveImage(src: string, sizes: string): ResponsiveImage {
  if (!IN_APP_MEDIA.test(src)) return { src };

  return {
    // Default for browsers that ignore srcset: the reading-column width.
    src: withWidth(src, 1000),
    srcSet: SRCSET_WIDTHS.map((w) => `${withWidth(src, w)} ${w}w`).join(', '),
    sizes,
  };
}

/** Layout widths, as `sizes` strings. */
export const SIZES = {
  /** Full reading column (max 700px). */
  column: '(max-width: 760px) 100vw, 700px',
  /** Half-width grid tile. */
  half: '(max-width: 760px) 50vw, 350px',
  /** Full-bleed hero behind the title. */
  hero: '(max-width: 760px) 100vw, 700px',
  /** Small thumbnail in a list. */
  thumb: '130px',
} as const;
