// lib/fetcher/platforms/index.ts
// Platform adapter registry + identifyPlatform() — FTCH-01 (platform identification).
// FTCH-06: adding a platform = 1 file + 1 line in registry.
// Plan 02-02, Task 2 — Research §3 (platform abstraction).
// Plan 02-03, Task 2 — upgraded identifyPlatform() to throw FetcherError.
// Plan 02-03, Task 3 — FTCH-06 extension documentation verified.

/**
 * Platform Adapter Registry (FTCH-06)
 *
 * To add a new platform:
 * 1. Create a new adapter file in this directory (e.g., `xhs.ts`)
 *    implementing the PlatformAdapter interface.
 * 2. Import it here and add to the `adapters` array.
 *
 * No other changes are needed — the Fetcher client, API route,
 * and all upstream code work generically via the adapter interface.
 */

import { twitterAdapter } from './twitter';
import { youtubeAdapter } from './youtube';
import { PlatformAdapter } from './types';
import { FetcherError, ReachErrorKind } from '@/lib/fetcher/errors';

export const adapters: PlatformAdapter[] = [twitterAdapter, youtubeAdapter];

/**
 * Identify platform from URL — throws FetcherError(UNSUPPORTED_PLATFORM) if no match.
 * FTCH-01: platform identification from URL.
 */
export function identifyPlatform(url: string): PlatformAdapter {
  for (const adapter of adapters) {
    if (adapter.matches(url)) return adapter;
  }
  throw new FetcherError(
    ReachErrorKind.UNSUPPORTED_PLATFORM,
    `Unsupported platform URL: ${url}`,
    undefined, undefined, url, false,
  );
}
