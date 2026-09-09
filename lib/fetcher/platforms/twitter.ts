// lib/fetcher/platforms/twitter.ts
// Twitter/X platform adapter — FTCH-01 (platform identification).
// Plan 02-02, Task 2 — Research §3 (platform abstraction).

import { PlatformAdapter } from './types';
import {
  normalizeAuthor,
  normalizeStats,
  normalizeComments,
  normalizeTwitterMedia,
} from '@/lib/fetcher/normalize';

/**
 * Detects whether a URL is a Twitter/X media URL (image/video) rather than
 * a post URL. agent-reach sometimes returns media URLs as item.url.
 */
function isMediaUrl(url: string): boolean {
  return /twimg\.com|t\.co\/[A-Za-z0-9]+$|video\.twimg/i.test(url);
}

export const twitterAdapter: PlatformAdapter = {
  platform: 'x',
  name: 'Twitter/X',
  urlPatterns: [
    /^https?:\/\/(twitter\.com|x\.com|t\.co)\/.+/i,
  ],
  matches(url) {
    return this.urlPatterns.some((p) => p.test(url));
  },
  normalize(item, fetchedAt) {
    // Guard: agent-reach sometimes returns a media URL as item.url instead of
    // the post URL. Detect this and reconstruct the canonical post URL from
    // the author handle + tweet ID so refreshMirror can re-fetch correctly.
    const postUrl = isMediaUrl(item.url)
      ? `https://x.com/${item.author.handle}/status/${item.id}`
      : item.url;

    return {
      platform: 'x',
      sourceId: item.id,
      sourceUrl: postUrl,
      title: item.title,
      content: item.content,
      body: item.content,
      author: normalizeAuthor(item.author),
      publishedAt: item.created_at,
      media: normalizeTwitterMedia(item.images || []),
      stats: normalizeStats(item.stats),
      comments: normalizeComments(item.comments || []),
      // Store sourceId so refresh can reconstruct the post URL even if
      // source_url gets corrupted.
      platformData: {
        sourceId: item.id,
        transcript: item.transcript,
        transcriptLang: item.transcript_lang,
        transcriptVtt: item.transcript_vtt,
      },
      fetchedAt,
    };
  },
};
