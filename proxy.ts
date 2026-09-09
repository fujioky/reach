// proxy.ts — Next.js 16 route gateway (replaces middleware.ts, Pitfall 2).
//
// Custom proxy that checks for the Auth.js session cookie directly.
// We do NOT use NextAuth({...}).auth as the proxy because the Auth.js
// proxy wrapper adds its own redirect logic that conflicts with the
// authorized callback for the login page (caused a 307 self-redirect
// loop on /admin/login). This custom proxy is simpler and more
// predictable: if the session cookie exists, allow; if not, allow only
// /admin/login and /api/auth/*; otherwise redirect to /admin/login.
//
// The RSC layout (app/admin/layout.tsx) does the real session validation
// via auth() in Node runtime — defense in depth.
//
// Visitor routes (/s/*): proxy sets the visitor_id cookie (D-51) because
// Server Components cannot call cookies().set() (Pitfall 1). The /s/*
// branch returns early BEFORE the admin auth logic (Pitfall 6) so
// visitor pages never redirect to /admin/login.
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { nanoid } from 'nanoid';

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Visitor routes (/s/* shares, /p/* articles) — set visitor_id cookie if
  // absent (D-51; articles joined when analytics went system-level).
  // Early return BEFORE admin auth (Pitfall 6 — no redirect to login).
  if (pathname.startsWith('/s/') || pathname.startsWith('/p/')) {
    const existing = request.cookies.get('visitor_id')?.value;
    if (existing) {
      return NextResponse.next();
    }
    const response = NextResponse.next();
    const visitorId = nanoid(21); // same entropy as share token (D-33)
    response.cookies.set('visitor_id', visitorId, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60, // 30 days (D-51)
      path: '/',
    });
    return response;
  }

  // Always allow the login page (incl. setup transform, D-28) and Auth.js API routes
  if (pathname.startsWith('/admin/login') || pathname.startsWith('/api/auth')) {
    return NextResponse.next();
  }

  // Check for Auth.js session cookie (JWT strategy uses authjs.session-token)
  const sessionCookie =
    request.cookies.get('authjs.session-token') ??
    request.cookies.get('__Secure-authjs.session-token');

  if (sessionCookie) {
    return NextResponse.next();
  }

  // No session cookie → redirect to login
  return NextResponse.redirect(new URL('/admin/login', request.url));
}

export const config = {
  matcher: ['/admin/:path*', '/s/:path*', '/p/:path*'],
};
