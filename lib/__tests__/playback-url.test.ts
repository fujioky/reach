import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveVideoPlaybackUrl, proxyVideoPath } from '@/lib/video/playback-url';
import { videoStorageKey } from '@/lib/storage/s3';

vi.mock('@/lib/settings', () => ({
  getSetting: vi.fn(),
}));

import { getSetting } from '@/lib/settings';

const mockedGetSetting = vi.mocked(getSetting);

function mockSettings(values: Record<string, string>) {
  mockedGetSetting.mockImplementation(async (key: string) => values[key] ?? '');
}

const originalUrl = 'https://video.twimg.com/ext_tw_video/123.mp4';
const video = {
  id: 'media-1',
  originalUrl,
  blobUrl: videoStorageKey(originalUrl),
};

describe('resolveVideoPlaybackUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns storage CDN URL when stored and Vercel proxy is off', async () => {
    mockSettings({
      video_storage_enabled: 'true',
      video_storage_use_vercel_proxy: 'false',
      video_storage_endpoint: 'https://r2.example.com',
      video_storage_region: 'auto',
      video_storage_bucket: 'reach-videos',
      video_storage_access_key: 'key',
      video_storage_secret_key: 'secret',
      video_storage_custom_domain: 'https://cdn.example.com',
      video_proxy_url: 'https://proxy.example.com',
    });

    const url = await resolveVideoPlaybackUrl('tok', video);
    expect(url).toBe(`https://cdn.example.com/${video.blobUrl}`);
  });

  it('returns external proxy URL when configured and proxy-video is not required', async () => {
    mockSettings({
      video_storage_enabled: 'false',
      video_proxy_url: 'https://proxy.example.com',
      video_proxy_failover_enabled: 'false',
    });

    const url = await resolveVideoPlaybackUrl('tok', {
      ...video,
      blobUrl: null,
    });
    expect(url).toBe('https://proxy.example.com/https://video.twimg.com/ext_tw_video/123.mp4');
  });

  it('returns proxy-video when external proxy failover is enabled', async () => {
    mockSettings({
      video_storage_enabled: 'false',
      video_proxy_url: 'https://proxy.example.com',
      video_proxy_failover_enabled: 'true',
    });

    const url = await resolveVideoPlaybackUrl('tok', {
      ...video,
      blobUrl: null,
    });
    expect(url).toBe(proxyVideoPath('tok', 'media-1'));
  });

  it('returns proxy-video for lazy storage upload', async () => {
    mockSettings({
      video_storage_enabled: 'true',
      video_storage_use_vercel_proxy: 'false',
      video_proxy_url: 'https://proxy.example.com',
    });

    const url = await resolveVideoPlaybackUrl('share-token', {
      ...video,
      blobUrl: null,
    });
    expect(url).toBe(proxyVideoPath('share-token', 'media-1'));
  });

  it('returns proxy-video when stored with Vercel proxy enabled', async () => {
    mockSettings({
      video_storage_enabled: 'true',
      video_storage_use_vercel_proxy: 'true',
      video_proxy_url: 'https://proxy.example.com',
    });

    const url = await resolveVideoPlaybackUrl('share-token', video);
    expect(url).toBe(proxyVideoPath('share-token', 'media-1'));
  });
});