// lib/fetcher/platforms/twitter.ts
// Twitter/X platform adapter — FTCH-01 (platform identification).
// Plan 02-02, Task 2 — Research §3 (platform abstraction).

import { PlatformAdapter } from './types';
import type { AgentReachComment, Comment } from '@/lib/fetcher/types';
import {
  normalizeAuthor,
  normalizeStats,
  normalizeComments,
  normalizeTwitterMedia,
} from '@/lib/fetcher/normalize';

/**
 * Detects whether a URL is a Twitter/X media URL (image/video) rather than
 * a post URL. reach-upstream sometimes returns media URLs as item.url.
 */
function isMediaUrl(url: string): boolean {
  return /twimg\.com|t\.co\/[A-Za-z0-9]+$|video\.twimg/i.test(url);
}

const POST_HOSTS = new Set([
  'x.com',
  'www.x.com',
  'mobile.x.com',
  'twitter.com',
  'www.twitter.com',
  'mobile.twitter.com',
]);

export const twitterAdapter: PlatformAdapter = {
  platform: 'x',
  name: 'Twitter/X',
  urlPatterns: [
    /^https?:\/\/(twitter\.com|x\.com|t\.co)\/.+/i,
  ],
  matches(url) {
    return this.urlPatterns.some((p) => p.test(url));
  },
  parsePostUrl(url) {
    if (!POST_HOSTS.has(url.hostname)) return null;
    // /<handle>/status/<id> or /i/web/status/<id>, optionally followed by
    // /photo/1, /analytics and the like.
    const match = url.pathname.match(/^\/(?:i\/web|([A-Za-z0-9_]{1,15}))\/status(?:es)?\/(\d+)/);
    if (!match) return null;
    const [, handle = 'i', id] = match;
    return { sourceId: id, url: `https://x.com/${handle}/status/${id}` };
  },
  normalize(item, fetchedAt) {
    // Guard: reach-upstream sometimes returns a media URL as item.url instead of
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
      comments: buildReplyTree(item.id, normalizeComments(item.comments || []), item.comments || []),
      thread: {
        parents: normalizeComments(item.parents || []),
        parentMissing: item.parent_missing ?? null,
      },
      // Store sourceId so refresh can reconstruct the post URL even if
      // source_url gets corrupted.
      platformData: {
        sourceId: item.id,
        transcript: item.transcript,
        transcriptLang: item.transcript_lang,
        transcriptVtt: item.transcript_vtt,
        xArticle: item.x_article === true,
      },
      fetchedAt,
    };
  },
};

/**
 * Nest X replies under the tweet they answer. reach-upstream returns the
 * conversation flat, each reply carrying `in_reply_to`; a reply whose parent is
 * the post itself, or is not in the batch, becomes a top-level comment.
 */
export function buildReplyTree(postId: string, comments: Comment[], raw: AgentReachComment[]): Comment[] {
  const parentOf = new Map(raw.map((c) => [c.id, c.in_reply_to ?? null]));
  const byId = new Map(comments.map((c) => [c.id, { ...c, replies: [] as Comment[] }]));
  const roots: Comment[] = [];
  for (const comment of byId.values()) {
    const parentId = parentOf.get(comment.id);
    const parent = parentId && parentId !== postId ? byId.get(parentId) : undefined;
    if (parent) parent.replies.push(comment);
    else roots.push(comment);
  }
  return roots;
}
