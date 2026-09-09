import { describe, it, expect } from 'vitest';
import {
  buildVideoProxyChain,
  buildProxyFetchUrl,
  describeVideoProxyFailoverChain,
  isRetryableProxyFailure,
} from '@/lib/video/failover';

const VIDEO_URL = 'https://video.twimg.com/ext_tw_video/123.mp4';

describe('buildVideoProxyChain', () => {
  it('returns a single direct hop when failover is off and proxy is Vercel', () => {
    expect(buildVideoProxyChain('', false)).toEqual([{ type: 'direct' }]);
  });

  it('returns a single external hop when failover is off', () => {
    expect(buildVideoProxyChain('https://proxy.example.com/token', false)).toEqual([
      { type: 'external', base: 'https://proxy.example.com/token' },
    ]);
  });

  it('falls back to direct after the external proxy when failover is on', () => {
    expect(buildVideoProxyChain('https://proxy.example.com/token/', true)).toEqual([
      { type: 'external', base: 'https://proxy.example.com/token' },
      { type: 'direct' },
    ]);
  });

  it('stays direct when no external proxy is configured, even with failover on', () => {
    expect(buildVideoProxyChain('', true)).toEqual([{ type: 'direct' }]);
  });
});

describe('buildProxyFetchUrl', () => {
  it('returns the raw video URL for direct hops', () => {
    expect(buildProxyFetchUrl({ type: 'direct' }, VIDEO_URL)).toBe(VIDEO_URL);
  });

  it('prefixes external proxy bases', () => {
    expect(
      buildProxyFetchUrl({ type: 'external', base: 'https://proxy.example.com/token' }, VIDEO_URL),
    ).toBe(`https://proxy.example.com/token/${VIDEO_URL}`);
  });
});

describe('isRetryableProxyFailure', () => {
  it('treats block and 5xx statuses as retryable', () => {
    expect(isRetryableProxyFailure(403)).toBe(true);
    expect(isRetryableProxyFailure(429)).toBe(true);
    expect(isRetryableProxyFailure(502)).toBe(true);
  });

  it('does not retry on 404', () => {
    expect(isRetryableProxyFailure(404)).toBe(false);
  });
});

describe('describeVideoProxyFailoverChain', () => {
  it('describes the failover order for UI copy', () => {
    expect(describeVideoProxyFailoverChain('https://proxy.example.com/token')).toBe(
      'https://proxy.example.com/token → 直连上游',
    );
  });
});