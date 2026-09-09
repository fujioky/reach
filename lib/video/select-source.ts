// lib/video/select-source.ts
// D-01: Progressive source selection — has_video && has_audio, sort by filesize desc.
// D-03: 360p progressive is highest quality for direct streaming.
// D-09: Preserve all video_sources[] for URL refresh.
// Extracted from scripts/spike/test-youtube.ts lines 169-182.
// Plan 02-02, Task 1 — FTCH-05.

import { VideoSource, AgentReachVideoSource } from '@/lib/fetcher/types';

/** HLS playlists are not playable as progressive MP4 in <video> or storage upload. */
export function isHlsSource(source: Pick<AgentReachVideoSource, 'url' | 'ext'>): boolean {
  const ext = (source.ext ?? '').toLowerCase();
  if (ext === 'm3u8' || ext === 'm3u') return true;
  const url = source.url.toLowerCase();
  return url.includes('.m3u8') || url.includes('hls_playlist') || url.includes('/manifest/');
}

function isProgressivePlayable(source: AgentReachVideoSource): boolean {
  return source.has_video && source.has_audio && !isHlsSource(source);
}

/**
 * D-01: Select best progressive video source.
 * Progressive = has_video && has_audio, excluding HLS/m3u8. Sort by filesize desc.
 * Returns null if no progressive source (DASH-only — D-03: record but don't resolve).
 */
export function selectProgressiveSource(
  videoSources: AgentReachVideoSource[]
): VideoSource | null {
  const progressive = videoSources.filter(isProgressivePlayable);
  if (progressive.length === 0) return null;
  // Sort by filesize descending (proxy for quality)
  progressive.sort((a, b) => b.filesize - a.filesize);
  const best = progressive[0];
  return {
    quality: best.quality,
    url: best.url,
    ext: best.ext,
    formatId: best.format_id,
    filesize: best.filesize,
    hasVideo: best.has_video,
    hasAudio: best.has_audio,
    isProgressive: true,
  };
}

/**
 * Convert all agent-reach video_sources to VideoSource[] (preserving DASH sources for D-09).
 * Marks isProgressive = hasVideo && hasAudio for each source.
 */
export function normalizeVideoSources(
  videoSources: AgentReachVideoSource[]
): VideoSource[] {
  return videoSources.map((s) => ({
    quality: s.quality,
    url: s.url,
    ext: s.ext,
    formatId: s.format_id,
    filesize: s.filesize,
    hasVideo: s.has_video,
    hasAudio: s.has_audio,
    isProgressive: isProgressivePlayable(s),
  }));
}
