// auth.config.ts — edge-safe Auth.js configuration (Pitfall 4).
//
// This file MUST stay edge-safe: it must not import the password-hashing
// library, the ORM, or the Postgres driver. It is imported by proxy.ts
// (03-03) which runs on the edge runtime. The heavy Node-only deps live
// in auth.ts.
import type { NextAuthConfig } from 'next-auth';
import { SESSION_REMEMBER_MAX_AGE_SEC } from '@/lib/auth/session-duration';

/**
 * Coarse-grained authorization callback used by the proxy/middleware to
 * decide whether a request to /admin/* should be allowed through. The
 * `auth` parameter is the session derived from the cookie; with database
 * strategy on edge it may be null even when logged in — 03-03's proxy.ts
 * will refine this logic. Here we provide a baseline that:
 *   - always allows /admin/login (the sign-in page + setup transform)
 *   - always allows /api/auth/* (Auth.js callback routes)
 *   - allows other /admin/* paths only when a session is present
 */
export const authConfig = {
  pages: {
    signIn: '/admin/login',
  },
  session: {
    strategy: 'jwt',
    // Upper bound for cookie; actual JWT lifetime is set per login in auth.ts (remember me).
    maxAge: SESSION_REMEMBER_MAX_AGE_SEC,
  },
  callbacks: {
    authorized({ auth, request }) {
      const pathname = request.nextUrl.pathname;
      // Always allow the login page and Auth.js API routes
      if (pathname.startsWith('/admin/login') || pathname.startsWith('/api/auth')) {
        return true;
      }
      // Other admin pages require an authenticated session
      return !!auth?.user;
    },
  },
  providers: [], // populated in auth.ts (Node side)
} satisfies NextAuthConfig;
