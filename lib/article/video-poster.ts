'use client';

// lib/article/video-poster.ts
// Grab a still frame from a video, in the browser.
//
// Server-side frame extraction means ffmpeg, and a serverless function has no
// ffmpeg binary — bundling one costs ~50MB of deployment size for something the
// browser already does. At upload time the file is right there in the page, so
// a <video> element decodes the first frame and a <canvas> reads it out. Zero
// dependencies, zero function time.
//
// The same path works for a video already in storage: point it at the in-app
// media URL and the browser range-requests just enough of the file to decode
// one frame, rather than downloading the whole thing.

/** Cap on the stored poster's width — it is a thumbnail, not a copy. */
const MAX_POSTER_WIDTH = 1280;

/** JPEG quality for the poster. */
const POSTER_QUALITY = 0.82;

/**
 * Where to seek before capturing.
 *
 * Not 0: many encodes open on a black or near-black frame, which makes a
 * useless thumbnail. A fraction of a second in is usually the first frame with
 * actual content.
 */
const SEEK_SECONDS = 0.4;

/** How long to wait for metadata + seek before giving up. */
const TIMEOUT_MS = 15_000;

export interface VideoPoster {
  blob: Blob;
  width: number;
  height: number;
}

/**
 * Capture a poster frame from a video file or URL.
 *
 * Resolves null rather than throwing: a poster is an enhancement, and a codec
 * the browser can't decode should not fail the upload that produced it.
 */
export async function captureVideoPoster(source: File | string): Promise<VideoPoster | null> {
  const objectUrl = typeof source === 'string' ? null : URL.createObjectURL(source);
  const src = objectUrl ?? (source as string);

  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  // Needed to read pixels back out of the canvas for a cross-origin file;
  // same-origin media URLs are unaffected.
  video.crossOrigin = 'anonymous';
  video.src = src;

  const cleanup = () => {
    video.removeAttribute('src');
    video.load();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  };

  try {
    const poster = await new Promise<VideoPoster | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), TIMEOUT_MS);

      const fail = () => {
        clearTimeout(timer);
        resolve(null);
      };

      video.onerror = fail;

      video.onloadedmetadata = () => {
        if (!video.videoWidth || !video.videoHeight) return fail();
        // A video shorter than the seek target still has a frame at 0.
        video.currentTime = Math.min(SEEK_SECONDS, Math.max(0, (video.duration || 0) / 2));
      };

      video.onseeked = () => {
        try {
          const scale = Math.min(1, MAX_POSTER_WIDTH / video.videoWidth);
          const width = Math.round(video.videoWidth * scale);
          const height = Math.round(video.videoHeight * scale);

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext('2d');
          if (!context) return fail();
          context.drawImage(video, 0, 0, width, height);

          canvas.toBlob(
            (blob) => {
              clearTimeout(timer);
              resolve(blob ? { blob, width, height } : null);
            },
            'image/jpeg',
            POSTER_QUALITY,
          );
        } catch {
          // Tainted canvas (cross-origin without CORS) lands here.
          fail();
        }
      };
    });

    return poster;
  } finally {
    cleanup();
  }
}
