// lib/fetcher/client.ts
// Core Fetcher client — fetchContent() + refreshVideoUrl().
// FTCH-02 (agent-reach API call), FTCH-03 (normalization), FTCH-04 (structured errors).
// Plan 02-03, Task 2 — Research §4 (error handling) + §7 (API client details).
//
// Structured error handling:
// - fetchWithRetry(): exponential backoff for 429 rate limits + transient network errors
// - mapAgentReachError(): maps agent-reach errors[]/HTTP status → FetcherError
// - detectEmptyItem(): Twitter 200+empty-item discrepancy → EMPTY_ITEM error kind

import { AgentReachResponse, FetchedContent } from './types';
import { identifyPlatform } from './platforms';
import { FetcherError, ReachErrorKind, mapAgentReachError, detectEmptyItem } from './errors';
import { getSetting } from '@/lib/settings';

// Env vars remain as a build-time override; DB settings take precedence at
// runtime (getSetting() falls back to the same defaults if not set in DB).
const AGENT_REACH_BASE_ENV = process.env.AGENT_REACH_BASE_URL || '';
const AGENT_REACH_PWD_ENV = process.env.AGENT_REACH_PWD || '';

/**
 * Sleep helper for retry backoff.
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch with retry for 429 rate limiting and transient network errors.
 * Exponential backoff: baseDelayMs * 2^attempt (5s, 10s, 20s for default 3 attempts).
 *
 * - On 429: retry up to maxRetries, then throw RATE_LIMITED FetcherError.
 * - On network failure (fetch throws): retry up to maxRetries, then throw NETWORK_ERROR.
 * - On any other status: return the response immediately (caller handles errors[]).
 *
 * @param url          agent-reach API URL to fetch
 * @param maxRetries   max retry attempts (default 2 → 3 total tries)
 * @param baseDelayMs  base delay for exponential backoff (default 5000ms)
 */
async function fetchWithRetry(
  url: string,
  maxRetries: number = 2,
  baseDelayMs: number = 5000,
): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 429 && attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt); // 5s, 10s, 20s
        await sleep(delay);
        continue;
      }
      return res;
    } catch (err) {
      if (attempt < maxRetries) {
        await sleep(baseDelayMs * Math.pow(2, attempt));
        continue;
      }
      throw new FetcherError(
        ReachErrorKind.NETWORK_ERROR,
        (err as Error).message,
        undefined, undefined, url, false,
      );
    }
  }
  // Unreachable in practice — the loop returns or throws — but satisfies the
  // type checker for the case where all retries are exhausted on 429.
  throw new FetcherError(
    ReachErrorKind.RATE_LIMITED,
    'Max retries exceeded (rate limited)',
    429,
  );
}

/**
 * Main Fetcher entry point — called by API routes, Phase 3 admin UI.
 * Given a post URL, identifies platform, calls agent-reach, returns unified FetchedContent.
 * Throws FetcherError on failure (kind/retryable let callers branch appropriately).
 */
export async function fetchContent(url: string): Promise<FetchedContent> {
  // 1. Identify platform from URL (FTCH-01) — throws FetcherError(UNSUPPORTED_PLATFORM)
  const adapter = identifyPlatform(url);

  // 2. Call agent-reach HTTP API (FTCH-02) with retry for 429/network errors
  // DB settings take precedence; env vars and hardcoded defaults are the fallback.
  const [dbBase, dbPwd] = await Promise.all([
    getSetting('agent_reach_url'),
    getSetting('agent_reach_pwd'),
  ]);
  const base = (AGENT_REACH_BASE_ENV || dbBase).trim().replace(/\/$/, '');
  const pwd = AGENT_REACH_PWD_ENV || dbPwd;
  if (!base) {
    throw new FetcherError(
      ReachErrorKind.NOT_CONFIGURED,
      'Agent Reach base URL is not configured (set it in 系统设置 or AGENT_REACH_BASE_URL)',
      undefined, adapter.platform, url, false,
    );
  }
  const apiUrl = `${base}/http/?platform=${adapter.platform}&query=${encodeURIComponent(url)}&pwd=${encodeURIComponent(pwd)}`;

  const response = await fetchWithRetry(apiUrl);
  const status = response.status;

  // 3. Parse response — PARSE_ERROR if JSON parse fails
  let data: AgentReachResponse;
  try {
    data = await response.json();
  } catch {
    throw new FetcherError(
      ReachErrorKind.PARSE_ERROR,
      `Failed to parse agent-reach response (status ${status})`,
      status, adapter.platform, url, false,
    );
  }

  // 4. Check for errors — map to structured FetcherError
  if (!response.ok || data.errors?.length > 0) {
    throw mapAgentReachError(status, data.errors || [], adapter.platform, url);
  }

  // 5. Check for empty item (Twitter discrepancy — spike finding)
  // Twitter/X returns 200 with empty item for deleted/private/non-existent tweets
  if (detectEmptyItem(data.item)) {
    throw new FetcherError(
      ReachErrorKind.EMPTY_ITEM,
      'Content not found (platform returned empty item)',
      status, adapter.platform, url, false,
    );
  }

  // 6. Normalize to unified content model (FTCH-03) — happy path unchanged
  const fetchedAt = new Date().toISOString();
  return adapter.normalize(data.item!, fetchedAt);
}

/**
 * D-09: Re-fetch content to get fresh googlevideo URLs.
 * Same as fetchContent — agent-reach generates fresh URLs on each call.
 * Phase 4/5 calls this when a stored video URL is expired (~6h).
 */
export async function refreshVideoUrl(url: string): Promise<FetchedContent> {
  return fetchContent(url);
}
