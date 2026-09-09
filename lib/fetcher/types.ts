// lib/fetcher/types.ts
// Unified content model + raw agent-reach response types.
// Plan 02-02, Task 1 — FTCH-03 (unified FetchedContent model).

// ─── Platform ─────────────────────────────────────────

/**
 * Platform identifier — maps to agent-reach platform parameter.
 * Extensible: add 'xhs' | 'web' when those adapters are implemented.
 */
export type Platform = 'x' | 'youtube';

// ─── Unified Model (normalized output) ────────────────

/**
 * YouTube video source, preserved for D-09 URL refresh.
 * googlevideo direct URLs expire ~6h; refreshVideoUrl() re-calls fetchContent().
 */
export interface VideoSource {
  quality: string;            // "360p", "1080p", etc.
  url: string;                // googlevideo direct URL (~6h expiry)
  ext: string;                // "mp4", "webm"
  formatId: string;           // yt-dlp format ID
  filesize: number;           // estimated bytes
  hasVideo: boolean;
  hasAudio: boolean;
  isProgressive: boolean;     // hasVideo && hasAudio
}

/**
 * Normalized media item from platform-specific media arrays.
 * Twitter: images[] (strings or {type,url} objects) → image/video MediaItems.
 * YouTube: images[] (thumbnails) + video_sources[] → image + video MediaItems.
 */
export interface MediaItem {
  type: 'image' | 'video';
  originalUrl: string;       // original platform URL (twimg, googlevideo, ytimg)
  // Video-specific (undefined for images)
  videoSources?: VideoSource[];  // YouTube only — all sources from agent-reach
  selectedSource?: VideoSource;  // Best progressive source (D-01 selection)
  // Metadata
  filesize?: number;          // from selectedSource.filesize
}

/**
 * Author of a post or comment.
 */
export interface Author {
  id: string;
  name: string;
  handle: string;
  url: string;
  avatarUrl: string;
}

/**
 * Comment on a post. Replies are recursive.
 */
export interface Comment {
  id: string;
  content: string;
  author: Author;
  createdAt: string;          // ISO 8601 UTC
  stats: {
    likes: number;
    replies: number;          // platform-reported reply count
  };
  replies?: Comment[];
}

/**
 * Engagement stats. Platform-reported totals (may differ from comments[] length).
 */
export interface EngagementStats {
  likes: number;
  comments: number;           // platform-reported total
  reposts: number;            // Twitter: reposts; YouTube: 0
  views: number;
  collects: number;           // Twitter: collects; YouTube: 0
}

/**
 * The core Fetcher output — unified content model across platforms.
 * FTCH-03: normalized from agent-reach platform-specific responses.
 */
export interface FetchedContent {
  // Identity
  platform: Platform;
  sourceId: string;           // platform-native ID (tweet ID, video ID)
  sourceUrl: string;          // original post URL

  // Content
  title: string;              // Twitter: first 100 chars; YouTube: video title
  content: string;            // Twitter: full text; YouTube: description
  body: string;               // alias for content (used by PRD ContentItem.body)

  // Author & timing
  author: Author;
  publishedAt: string;        // ISO 8601 UTC (from created_at)

  // Media (normalized)
  media: MediaItem[];         // images + videos, unified

  // Engagement
  stats: EngagementStats;

  // Comments
  comments: Comment[];

  // Platform-specific extras (preserved for rendering)
  platformData: {
    duration?: number;        // YouTube: seconds
    transcript?: string;      // video subtitle text (YouTube; X when the video has a track)
    transcriptLang?: string;  // subtitle track language ('zh-CN', 'en', ...) — zh needs no translation
    transcriptVtt?: string;   // timed WEBVTT for in-player captions (normalized by agent-reach)
    sourceId?: string;        // platform-native ID (tweet ID, video ID) — for URL reconstruction
  };

  // Fetch metadata
  fetchedAt: string;          // ISO 8601 — when Fetcher called agent-reach
}

// ─── Raw agent-reach response types (internal) ────────

export interface AgentReachResponse {
  ok: boolean;
  platform: string;
  query: string;
  type: 'item' | 'search';
  source: string;
  item?: AgentReachItem;
  results?: AgentReachItem[];
  count: number;
  errors: AgentReachError[];
}

export interface AgentReachItem {
  id: string;
  url: string;
  title: string;
  content: string;
  author: AgentReachAuthor;
  created_at: string;
  stats: AgentReachStats;
  images?: (string | { type: string; url: string })[];  // Twitter: mixed
  video_sources?: AgentReachVideoSource[];                // YouTube only
  comments?: AgentReachComment[];
  // Video subtitle extras (YouTube always probed; X only for video tweets)
  duration?: number;
  transcript?: string;
  transcript_lang?: string;
  transcript_vtt?: string;
}

export interface AgentReachAuthor {
  id: string;
  name: string;
  handle: string;
  url: string;
  avatar_url: string;
}

export interface AgentReachStats {
  likes: number;
  comments: number;
  reposts: number;
  views: number;
  collects: number;
}

export interface AgentReachVideoSource {
  quality: string;
  url: string;
  ext: string;
  format_id: string;
  filesize: number;
  has_video: boolean;
  has_audio: boolean;
}

export interface AgentReachComment {
  id: string;
  content: string;
  author: AgentReachAuthor;
  created_at: string;
  stats: AgentReachStats;
  images?: (string | object)[];
  replies?: AgentReachComment[];
}

export interface AgentReachError {
  stage: string;
  kind: string;
  message: string;
}
