// lib/fetcher/platforms/types.ts
// Platform adapter interface — one adapter per supported platform.
// FTCH-06: adding a platform = 1 file + 1 line in registry.
// Plan 02-02, Task 2 — Research §3 (platform abstraction).

import { AgentReachItem, FetchedContent } from '@/lib/fetcher/types';

/** Platform adapter — one per supported platform */
export interface PlatformAdapter {
  /** reach-upstream platform parameter value */
  platform: string;  // 'x', 'youtube', 'xhs', 'web'

  /** Human-readable platform name */
  name: string;      // 'Twitter/X', 'YouTube'

  /** URL patterns that identify this platform */
  urlPatterns: RegExp[];

  /** Identify whether a URL belongs to this platform */
  matches(url: string): boolean;

  /**
   * Parse a link to a single post into its platform-native ID (the same ID
   * the normalizer stores as platformData.sourceId) and the canonical URL to
   * fetch. Null for anything that is not one post on this platform — a
   * profile, the home feed, another site.
   */
  parsePostUrl(url: URL): { sourceId: string; url: string } | null;

  /** Normalize reach-upstream item response → FetchedContent */
  normalize(item: AgentReachItem, fetchedAt: string): FetchedContent;
}
