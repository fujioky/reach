// lib/fetcher/platforms/youtube.ts
// YouTube platform adapter — FTCH-01 (platform identification), FTCH-05 (video sources).
// Plan 02-02, Task 2 — Research §3 (platform abstraction).

import { PlatformAdapter } from './types';
import {
  normalizeAuthor,
  normalizeStats,
  normalizeComments,
  normalizeYouTubeMedia,
} from '@/lib/fetcher/normalize';

const WATCH_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export const youtubeAdapter: PlatformAdapter = {
  platform: 'youtube',
  name: 'YouTube',
  urlPatterns: [
    /^https?:\/\/((?:(?:www|m)\.)?youtube\.com|youtu\.be)\/.+/i,
  ],
  matches(url) {
    return this.urlPatterns.some((p) => p.test(url));
  },
  parsePostUrl(url) {
    let id: string | null = null;
    if (url.hostname === 'youtu.be') {
      id = url.pathname.split('/')[1] ?? null;
    } else if (WATCH_HOSTS.has(url.hostname)) {
      id =
        url.pathname === '/watch'
          ? url.searchParams.get('v')
          : (url.pathname.match(/^\/(?:shorts|live|embed)\/([^/]+)/)?.[1] ?? null);
    }
    if (!id || !VIDEO_ID.test(id)) return null;
    return { sourceId: id, url: `https://www.youtube.com/watch?v=${id}` };
  },
  normalize(item, fetchedAt) {
    return {
      platform: 'youtube',
      sourceId: item.id,
      sourceUrl: item.url,
      title: item.title,
      content: item.content,
      body: item.content,
      author: normalizeAuthor(item.author),
      publishedAt: item.created_at,
      media: normalizeYouTubeMedia(item.images || [], item.video_sources || []),
      stats: normalizeStats(item.stats),
      comments: normalizeComments(item.comments || []),
      platformData: {
        duration: item.duration,
        transcript: item.transcript,
        transcriptLang: item.transcript_lang,
        transcriptVtt: item.transcript_vtt,
        sourceId: item.id,
      },
      fetchedAt,
    };
  },
};
