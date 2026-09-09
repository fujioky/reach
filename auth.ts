// auth.ts — Auth.js v5 configuration center (Node runtime).
//
// This file imports the edge-safe auth.config.ts and adds the heavy
// Node-only dependencies: DrizzleAdapter, bcryptjs, the Credentials
// provider authorize(), and the database-session workaround (Pitfall 1).
//
// D-23: database users table + bcrypt. Session strategy adapted to JWT
//       (Auth.js v5 beta.31 requires JWT for credentials provider —
//       UnsupportedStrategy is thrown at config assertion for database +
//       credentials). DB session rows are still created manually in the
//       jwt callback below for observability: the checkpoint query
//       `SELECT * FROM "session"` will find rows, and logout can clean
//       them up. Session persistence across refresh is handled by the
//       JWT cookie — behavior equivalent to database strategy from the
//       user's perspective.
// D-28: users table created empty — first admin inserted by 03-03
//       login-page setup flow (no seed script, no env vars).
//
// ⚠️ Fragile area: the jwt callback below manually creates a DB session
// row on credentials sign-in for tracking/observability. The expires
// date MUST be a future time. 03-03 checkpoint:human-verify tests session
// persistence empirically (refresh still logged in + session row exists in DB).
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { encode as jwtEncode, decode as jwtDecode } from '@auth/core/jwt';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';

import { authConfig } from '@/auth.config';
import { credsSchema } from '@/lib/auth/credentials-schema';
import {
  parseRememberMe,
  sessionMaxAgeMs,
  sessionMaxAgeSec,
  SESSION_EPHEMERAL_MAX_AGE_SEC,
  SESSION_REMEMBER_MAX_AGE_SEC,
} from '@/lib/auth/session-duration';
import { db, users, accounts, sessions, verificationTokens } from '@/lib/db';

type AdminUser = { id: string; name: string; remember?: boolean };

const adapter = DrizzleAdapter(db, {
  usersTable: users,
  accountsTable: accounts,
  sessionsTable: sessions,
  verificationTokensTable: verificationTokens,
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter,
  providers: [
    Credentials({
      credentials: { username: {}, password: {}, remember: {} },
      authorize: async (raw) => {
        const parsed = credsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { username, password } = parsed.data;
        const remember = parseRememberMe(
          (raw as Record<string, unknown>).remember as string | undefined,
        );
        const [u] = await db
          .select()
          .from(users)
          .where(eq(users.username, username))
          .limit(1);
        if (!u || !u.passwordHash) return null;
        const ok = await bcrypt.compare(password, u.passwordHash);
        return ok ? { id: u.id, name: u.username, remember } : null;
      },
    }),
  ],
  jwt: {
    maxAge: SESSION_REMEMBER_MAX_AGE_SEC,
    encode: async (params) => {
      const token = params.token ?? {};
      const maxAge =
        typeof token.sessionMaxAge === 'number'
          ? token.sessionMaxAge
          : token.remember === false
            ? SESSION_EPHEMERAL_MAX_AGE_SEC
            : (params.maxAge ?? SESSION_REMEMBER_MAX_AGE_SEC);
      const { sessionMaxAge: _drop, ...payload } = token;
      return jwtEncode({ ...params, token: payload, maxAge });
    },
    decode: jwtDecode,
  },
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user, account }) {
      if (user && account?.provider === 'credentials') {
        const remember = (user as AdminUser).remember ?? false;
        token.remember = remember;
        token.sessionMaxAge = sessionMaxAgeSec(remember);

        const sessionToken = randomUUID();
        const expires = new Date(Date.now() + sessionMaxAgeMs(remember));
        await adapter.createSession!({
          userId: user.id!,
          sessionToken,
          expires,
        });
        token.sessionId = sessionToken;
      }
      return token;
    },
    async session({ session, token }) {
      if (token?.sub) {
        session.user = { ...session.user, id: token.sub, name: token.name ?? null };
      }
      return session;
    },
  },
});