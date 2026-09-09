'use client';

// app/_components/content/UnlockGate.tsx
// Password prompt shown in place of protected content.
//
// Deliberately says as little as the situation allows: it confirms something is
// here and that it needs a password, and nothing about what. The title, author
// and excerpt all stay behind the gate — a preview would defeat the point of
// locking it.

import { useActionState } from 'react';
import { PageBackground } from '@/app/_components/layout/PageBackground';
import { PublicHeader } from '@/app/_components/layout/PublicHeader';
import { PublicFooter } from '@/app/_components/layout/PublicFooter';
import { unlockContent, type UnlockFormState } from '@/app/unlock-action';

export function UnlockGate({
  /** Where to look the item up again on submit. */
  kind,
  identifier,
  /** Optional hint the admin wrote, e.g. "生日八位数字". */
  hint,
}: {
  kind: 'article' | 'mirror';
  identifier: string;
  hint?: string | null;
}) {
  const [state, formAction, pending] = useActionState<UnlockFormState, FormData>(
    unlockContent,
    { ok: false },
  );

  return (
    <main className="relative flex min-h-screen flex-col bg-paper text-ink">
      <PageBackground intensity="subtle" />
      <PublicHeader showNav={false} />

      <div className="relative flex flex-1 items-center justify-center px-5 py-16">
        <div className="w-full max-w-[380px]">
          <div className="ds-card p-6">
            <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-tint text-brand">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="4" y="10" width="16" height="11" rx="2" />
                <path d="M8 10V7a4 4 0 0 1 8 0v3" />
              </svg>
            </div>

            <h1 className="mt-4 text-center font-display text-lg font-bold text-ink">
              此内容需要密码
            </h1>
            <p className="mt-1.5 text-center text-[13px] leading-relaxed text-muted">
              {hint ? hint : '请输入访问密码继续阅读。'}
            </p>

            <form action={formAction} className="mt-5 flex flex-col gap-3">
              <input type="hidden" name="kind" value={kind} />
              <input type="hidden" name="identifier" value={identifier} />

              <input
                name="password"
                type="password"
                required
                autoFocus
                autoComplete="current-password"
                placeholder="访问密码"
                className="ds-input text-center"
              />

              <button
                type="submit"
                disabled={pending}
                className="ds-btn-primary w-full py-3 disabled:opacity-60"
              >
                {pending ? '验证中…' : '进入'}
              </button>

              {state.error && (
                <p role="alert" className="text-center text-[13px] text-danger">
                  {state.error}
                </p>
              )}
            </form>
          </div>

          <p className="mt-4 text-center text-xs text-subtle">
            密码由分享者提供
          </p>
        </div>
      </div>

      <PublicFooter note="" />
    </main>
  );
}
