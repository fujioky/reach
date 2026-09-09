// lib/fetcher/normalize.ts
// Shared normalization helpers for converting raw agent-reach items
// to the unified FetchedContent model.
// Plan 02-02, Task 2 — FTCH-03.

import {
  AgentReachAuthor,
  AgentReachStats,
  AgentReachComment,
  AgentReachVideoSource,
  Author,
  Comment,
  EngagementStats,
  MediaItem,
} from '@/lib/fetcher/types';
import {
  selectProgressiveSource,
  normalizeVideoSources,
} from '@/lib/video/select-source';

/**
 * Normalize agent-reach author → unified Author.
 * Maps avatar_url → avatarUrl, passes through id/name/handle/url.
 */
export function normalizeAuthor(agentAuthor: AgentReachAuthor): Author {
  return {
    id: agentAuthor.id,
    name: agentAuthor.name,
    handle: agentAuthor.handle,
    url: agentAuthor.url,
    avatarUrl: agentAuthor.avatar_url,
  };
}

/**
 * Normalize agent-reach stats → unified EngagementStats.
 * Passes through all 5 fields (likes, comments, reposts, views, collects).
 */
export function normalizeStats(agentStats: AgentReachStats): EngagementStats {
  return {
    likes: agentStats.likes,
    comments: agentStats.comments,
    reposts: agentStats.reposts,
    views: agentStats.views,
    collects: agentStats.collects,
  };
}

/**
 * Normalize agent-reach comments → unified Comment[].
 * Maps content → content, author → normalizeAuthor(), created_at → createdAt,
 * stats.comments → stats.replies, stats.likes → stats.likes.
 * Recursively normalizes replies[] if present.
 */
export function normalizeComments(
  agentComments: AgentReachComment[]
): Comment[] {
  return agentComments.map((c) => ({
    id: c.id,
    content: c.content,
    author: normalizeAuthor(c.author),
    createdAt: c.created_at,
    stats: {
      likes: c.stats.likes,
      replies: c.stats.comments,
    },
    replies: c.replies ? normalizeComments(c.replies) : undefined,
  }));
}

/**
 * CRITICAL: Normalize Twitter media.
 * Twitter video URLs are plain strings (not {type:"video"} objects) —
 * detect video by domain (video.twimg.com), not by object type.
 * Handle both plain string URLs and {type:"video", url:"..."} objects.
 * For videos, create a single VideoSource with quality 'unknown', isProgressive true.
 * For images (pbs.twimg.com or other), create MediaItem with type 'image'.
 */
export function normalizeTwitterMedia(
  images: (string | { type: string; url: string })[]
): MediaItem[] {
  return images.map((img) => {
    // Extract URL and detect type
    let url: string;
    let isVideoObject = false;

    if (typeof img === 'string') {
      url = img;
    } else {
      url = img.url;
      isVideoObject = img.type === 'video';
    }

    // Detect video by domain (video.twimg.com) OR by object type
    const isVideo = isVideoObject || url.includes('video.twimg.com');

    if (isVideo) {
      return {
        type: 'video' as const,
        originalUrl: url,
        videoSources: [
          {
            quality: 'unknown',
            url,
            ext: 'mp4',
            formatId: 'twitter',
            filesize: 0,
            hasVideo: true,
            hasAudio: true,
            isProgressive: true,
          },
        ],
        selectedSource: {
          quality: 'unknown',
          url,
          ext: 'mp4',
          formatId: 'twitter',
          filesize: 0,
          hasVideo: true,
          hasAudio: true,
          isProgressive: true,
        },
        filesize: 0,
      };
    }

    return {
      type: 'image' as const,
      originalUrl: url,
    };
  });
}

/**
 * Normalize YouTube media.
 *
 * YouTube `images[]` from agent-reach contains 40+ thumbnail variants
 * (1.jpg/2.jpg/3.jpg, mq1-3, hq1-3, sd1-3, default, mqdefault, hqdefault
 * with sqp params, sddefault, hq720, maxresdefault — each in .jpg + .webp).
 * These are all the same thumbnail at different resolutions/formats.
 *
 * We deduplicate to a single best thumbnail:
 *   1. Prefer `maxresdefault.jpg` (highest resolution, no sqp param)
 *   2. Fallback `hqdefault.jpg` (without sqp param)
 *   3. Fallback first `.jpg` without `sqp` param
 *   4. Last resort: first image
 *
 * video_sources[] → single video MediaItem with:
 *   - videoSources: normalizeVideoSources(videoSources) — all sources preserved (D-09)
 *   - selectedSource: selectProgressiveSource(videoSources) — best progressive (D-01)
 *   - originalUrl: selectedSource?.url || videoSources[0]?.url || ''
 *   - filesize: selectedSource?.filesize
 */
export function normalizeYouTubeMedia(
  images: (string | { type: string; url: string })[],
  videoSources: AgentReachVideoSource[]
): MediaItem[] {
  const mediaItems: MediaItem[] = [];

  // Dedupe thumbnails to 1 — prefer maxresdefault.jpg
  const urls = images.map((img) => (typeof img === 'string' ? img : img.url));
  const bestThumb =
    urls.find((u) => u.includes('maxresdefault.jpg') && !u.includes('sqp=')) ||
    urls.find((u) => u.includes('hqdefault.jpg') && !u.includes('sqp=')) ||
    urls.find((u) => u.endsWith('.jpg') && !u.includes('sqp=')) ||
    urls[0];

  if (bestThumb) {
    mediaItems.push({
      type: 'image',
      originalUrl: bestThumb,
    });
  }

  // video_sources → single video MediaItem
  if (videoSources.length > 0) {
    const normalized = normalizeVideoSources(videoSources);
    const selected = selectProgressiveSource(videoSources);
    mediaItems.push({
      type: 'video',
      originalUrl: selected?.url || videoSources[0]?.url || '',
      videoSources: normalized,
      selectedSource: selected || undefined,
      filesize: selected?.filesize,
    });
  }

  return mediaItems;
}
