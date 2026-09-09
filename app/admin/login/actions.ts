// app/admin/login/actions.ts
// Server Actions for the dual-mode login page (D-28).
//
// setupAdmin: first-admin initialization — only succeeds when users table is
//   empty. zod validates input → race-safety re-check → hash → insert →
//   auto sign-in → redirect /admin. No subsequent admins allowed (D-23+D-28).
//
// login: normal credentials login — calls signIn('credentials') and redirects
//   to /admin on success, or back to /admin/login?error=invalid on failure.
'use server';

import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { AuthError } from 'next-auth';
import { redirect } from 'next/navigation';

import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { credsSchema } from '@/lib/auth/credentials-schema';
import { parseRememberMe } from '@/lib/auth/session-duration';
import { signIn } from '@/auth';

// Setup schema: reuses credsSchema's username/password fields, adds
// confirmPassword with a refinement for password match.
const setupSchema = z
  .object({
    username: credsSchema.shape.username,
    password: credsSchema.shape.password,
    confirmPassword: z.string().min(1),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: '两次输入的密码不一致',
    path: ['confirmPassword'],
  });

/**
 * setupAdmin — D-28 first-admin initialization Server Action.
 *
 * 1. zod validate (including confirmPassword match)
 * 2. race-safety re-check: users table must still be empty
 * 3. hash password (work factor 10)
 * 4. insert first admin row
 * 5. auto sign-in + redirect /admin
 *
 * On any failure, redirects back to /admin/login with an error code.
 */
export async function setupAdmin(formData: FormData) {
  const input = {
    username: String(formData.get('username') ?? ''),
    password: String(formData.get('password') ?? ''),
    confirmPassword: String(formData.get('confirmPassword') ?? ''),
  };

  // 1. zod validation (including confirmPassword match)
  const parsed = setupSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const code = issue.path.includes('confirmPassword') ? 'password_mismatch' : 'validation';
    redirect(`/admin/login?error=${code}`);
  }

  // 2. Race-safety re-check: users table must still be empty (D-28 + D-23)
  const existing = await db.select().from(users).limit(1);
  if (existing.length > 0) {
    redirect('/admin/login?error=admin_exists');
  }

  // 3. hash password (default work factor 10)
  const passwordHash = await bcrypt.hash(parsed.data.password, 10);

  // 4. insert first admin row
  await db.insert(users).values({
    username: parsed.data.username,
    passwordHash,
    name: parsed.data.username,
  });

  // 5. auto sign-in and redirect to /admin
  try {
    await signIn('credentials', {
      username: parsed.data.username,
      password: parsed.data.password,
      remember: 'true',
      redirectTo: '/admin',
    });
  } catch (error) {
    if (error instanceof AuthError) {
      // Admin row was created but auto-login failed — user can log in manually
      redirect('/admin/login?error=setup_failed');
    }
    throw error; // re-throw NEXT_REDIRECT so Next.js performs the redirect
  }
}

/**
 * login — normal credentials login Server Action (non-setup mode).
 * On success, signIn redirects to /admin. On failure, redirects back with error.
 */
export async function login(formData: FormData) {
  const username = String(formData.get('username') ?? '');
  const remember = parseRememberMe(formData.get('remember'));

  try {
    await signIn('credentials', {
      username,
      password: String(formData.get('password') ?? ''),
      remember: remember ? 'true' : 'false',
      redirectTo: '/admin',
    });
  } catch (error) {
    if (error instanceof AuthError) {
      redirect(`/admin/login?error=invalid&u=${encodeURIComponent(username)}`);
    }
    throw error; // re-throw NEXT_REDIRECT so Next.js performs the redirect
  }
}
