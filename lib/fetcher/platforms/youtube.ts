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

export const youtubeAdapter: PlatformAdapter = {
  platform: 'youtube',
  name: 'YouTube',
  urlPatterns: [
    /^https?:\/\/(www\.youtube\.com|youtu\.be)\/.+/i,
  ],
  matches(url) {
    return this.urlPatterns.some((p) => p.test(url));
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
