// lib/fetcher/errors.ts
// Structured error handling for the Fetcher client — FTCH-04.
// Plan 02-03, Task 1 — Research §4 (error handling design).
//
// Exports: ReachErrorKind enum, FetcherError class, isRetryable(),
// mapAgentReachError(), detectEmptyItem().
//
// Spike findings encoded:
// - Twitter deleted tweets return 200 + empty item (not 404) → detectEmptyItem() + EMPTY_ITEM
// - YouTube correctly returns 404 for non-existent videos → NOT_FOUND
// - 429 rate limiting from upstream Twitter → fetchWithRetry() (client.ts) + RATE_LIMITED
// - Transient network errors (fetch failed, no JSON) → NETWORK_ERROR (retryable)

import { AgentReachError, AgentReachItem } from '@/lib/fetcher/types';

/**
 * Reach error kinds — maps to agent-reach error kinds + Reach-specific ones.
 * Callers (Phase 3 admin UI) can `switch (error.kind)` to show appropriate UI
 * (retry button for rate-limited, "not found" for deleted content, etc.).
 */
export enum ReachErrorKind {
  // From agent-reach errors[].kind
  RATE_LIMITED = 'rate_limited',
  NOT_FOUND = 'not_found',
  AUTH_REQUIRED = 'auth_required',
  UNSUPPORTED = 'unsupported',         // platform not supported by agent-reach
  NOT_CONFIGURED = 'not_configured',   // backend not installed
  TIMEOUT = 'timeout',
  INTERNAL = 'internal',
  // Reach-specific
  UNSUPPORTED_PLATFORM = 'unsupported_platform',  // URL doesn't match any adapter
  EMPTY_ITEM = 'empty_item',           // 200 but empty item (Twitter deleted tweet discrepancy)
  NETWORK_ERROR = 'network_error',     // fetch failed, no JSON response
  PARSE_ERROR = 'parse_error',         // JSON parse failed
  UNKNOWN = 'unknown',
}

/**
 * FetcherError — the single error class thrown by the Fetcher.
 * Carries structured metadata so callers can branch on `kind` and decide
 * whether to retry, show a "not found" message, prompt for auth, etc.
 */
export class FetcherError extends Error {
  constructor(
    public kind: ReachErrorKind,
    message: string,
    public statusCode?: number,      // HTTP status from agent-reach
    public platform?: string,        // which platform was being fetched
    public sourceUrl?: string,       // the URL that was fetched
    public retryable?: boolean,      // can the caller retry? (429, timeout, network)
  ) {
    super(message);
    this.name = 'FetcherError';
  }
}

/**
 * Whether a given error kind is worth retrying (transient failures).
 * RATE_LIMITED, TIMEOUT, and NETWORK_ERROR are transient — the caller may
 * retry after a delay. All other kinds are deterministic and retrying won't help.
 */
export function isRetryable(kind: ReachErrorKind): boolean {
  return kind === ReachErrorKind.RATE_LIMITED ||
         kind === ReachErrorKind.TIMEOUT ||
         kind === ReachErrorKind.NETWORK_ERROR;
}

/**
 * Map agent-reach HTTP status + errors[] array to a structured FetcherError.
 * Checks errors[] first (more specific than HTTP status), then falls back to
 * HTTP status code mapping.
 *
 * @param status   HTTP status code from the agent-reach response
 * @param errors   agent-reach errors[] array (may be empty)
 * @param platform which platform was being fetched (adapter.platform)
 * @param url      the source URL that was fetched
 */
export function mapAgentReachError(
  status: number,
  errors: AgentReachError[],
  platform: string,
  url: string,
): FetcherError {
  // Check errors[] first (more specific than HTTP status)
  if (errors.length > 0) {
    const err = errors[0];
    const kind = err.kind as ReachErrorKind;
    return new FetcherError(
      kind,
      err.message || `agent-reach error: ${kind}`,
      status,
      platform,
      url,
      isRetryable(kind),
    );
  }

  // Fall back to HTTP status
  switch (status) {
    case 401:
      return new FetcherError(ReachErrorKind.AUTH_REQUIRED, 'Invalid agent-reach password', 401, platform, url, false);
    case 429:
      return new FetcherError(ReachErrorKind.RATE_LIMITED, 'Rate limited by upstream platform', 429, platform, url, true);
    case 504:
      return new FetcherError(ReachErrorKind.TIMEOUT, 'Upstream platform timeout', 504, platform, url, true);
    case 503:
      return new FetcherError(ReachErrorKind.NOT_CONFIGURED, 'Backend not configured', 503, platform, url, false);
    case 500:
      return new FetcherError(ReachErrorKind.INTERNAL, 'Internal agent-reach error', 500, platform, url, false);
    default:
      return new FetcherError(ReachErrorKind.UNKNOWN, `Unexpected status ${status}`, status, platform, url, false);
  }
}

/**
 * Detect Twitter/X's 200+empty-item discrepancy.
 * Twitter/X returns 200 with an empty item (all fields empty strings/0) for
 * deleted/private/non-existent tweets, instead of a 404. The Fetcher MUST
 * check for this after a successful 200 response.
 *
 * @param item the agent-reach item (may be undefined/null if not present)
 * @returns true if the item is effectively empty (deleted/private tweet)
 */
export function detectEmptyItem(item: AgentReachItem | undefined | null): boolean {
  // Twitter/X returns 200 with empty item for deleted/private tweets
  // All fields are empty strings or 0
  return !item?.content && !item?.author?.id && !item?.id;
}
