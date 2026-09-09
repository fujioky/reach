// lib/fetcher/index.ts
// Public API exports for the Fetcher client.
// Plan 02-02, Task 3.
// Plan 02-03, Task 2 — added error exports.

export { fetchContent, refreshVideoUrl } from './client';
export { FetcherError, ReachErrorKind, isRetryable } from './errors';
export type {
  FetchedContent,
  MediaItem,
  VideoSource,
  Author,
  Comment,
  EngagementStats,
  Platform,
} from './types';
