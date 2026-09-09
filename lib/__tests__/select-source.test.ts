import { describe, it, expect } from 'vitest';
import { isHlsSource, selectProgressiveSource } from '@/lib/video/select-source';
import type { AgentReachVideoSource } from '@/lib/fetcher/types';

function source(overrides: Partial<AgentReachVideoSource>): AgentReachVideoSource {
  return {
    quality: '360p',
    url: 'https://example.com/video.mp4',
    ext: 'mp4',
    format_id: '18',
    filesize: 1_000_000,
    has_video: true,
    has_audio: true,
    ...overrides,
  };
}

describe('isHlsSource', () => {
  it('detects m3u8 by extension', () => {
    expect(isHlsSource(source({ ext: 'm3u8' }))).toBe(true);
  });

  it('detects HLS by URL pattern', () => {
    expect(
      isHlsSource(
        source({
          ext: 'mp4',
          url: 'https://example.com/hls_playlist/91/playlist.m3u8',
        }),
      ),
    ).toBe(true);
  });
});

describe('selectProgressiveSource', () => {
  it('skips HLS sources and picks progressive MP4', () => {
    const selected = selectProgressiveSource([
      source({
        quality: '720p',
        ext: 'm3u8',
        filesize: 5_000_000,
        url: 'https://example.com/hls_playlist/91/playlist.m3u8',
      }),
      source({
        quality: '360p',
        ext: 'mp4',
        filesize: 2_000_000,
        url: 'https://example.com/videoplayback?id=abc&itag=18',
      }),
    ]);

    expect(selected?.ext).toBe('mp4');
    expect(selected?.url).toContain('itag=18');
  });
});