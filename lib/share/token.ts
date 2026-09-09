// lib/share/token.ts
// Plan 04-01, Task 1 — GREEN phase: nanoid-based share token generator.
//
// D-33: nanoid 21 chars (URL-safe base64 alphabet A-Za-z0-9_-).
// Entropy = 21 × log₂(64) = 126 bits — exceeds ASVS L1 ≥ 64 bits and
// the plan's ≥ 122 bit bar. Satisfies SHRE-08 (high-entropy, non-
// enumerable). The unique index on shares.token (schema.ts) is the DB
// backstop for the astronomically unlikely collision.
//
// nanoid is synchronous and has no IO, so it is safe to call inside a
// db.transaction (createMirror inserts the share row atomically with
// the mirror writes — D-29).

import { nanoid } from 'nanoid';

/**
 * Generate a share token with ~126 bits of entropy (D-33).
 * nanoid 21 chars × log₂(64) = 126 bits — exceeds ASVS L1 ≥ 64 bits.
 * URL-safe base64 alphabet (A-Za-z0-9_-). Satisfies SHRE-08.
 */
export function generateShareToken(): string {
  return nanoid(21);
}
