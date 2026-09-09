// app/api/auth/[...nextauth]/route.ts — Auth.js v5 catch-all route handler.
// Re-exports the handlers from auth.ts. Must run on Node runtime because
// auth.ts imports DrizzleAdapter + bcryptjs (not edge-compatible).
export const runtime = 'nodejs';

import { handlers } from '@/auth';

export const { GET, POST } = handlers;
