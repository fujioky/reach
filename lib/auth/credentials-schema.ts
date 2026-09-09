// lib/auth/credentials-schema.ts
// Shared zod schema for credentials login input validation (AUTH-01).
// Used by auth.ts authorize() and the 03-03 login/setup forms.
import { z } from 'zod';

/**
 * Validates username + password submitted to the Credentials provider.
 * Both fields must be non-empty strings — the schema is intentionally
 * permissive on length/complexity so the login page can surface its own
 * UX rules; this gate only prevents empty/missing payloads from reaching
 * the DB lookup + bcrypt compare.
 */
export const credsSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
