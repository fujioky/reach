'use client';

// app/_components/content/TurnstileGate.tsx
// Cloudflare Turnstile challenge shown in place of visitor content until the
// browser proves it is not a crawler. Mirrors the UnlockGate layout.
//
// Managed mode: for real visitors the widget usually auto-passes without
// interaction; the page reloads itself once the clearance cookie is set.

import { useEffect, useRef, useState } from 'react';
import { PageBackground } from '@/app/_components/layout/PageBackground';
import { PublicHeader } from '@/app/_components/layout/PublicHeader';
import { PublicFooter } from '@/app/_components/layout/PublicFooter';

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

interface TurnstileApi {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string;
      theme?: 'auto' | 'light' | 'dark';
      callback: (token: string) => void;
      'error-callback'?: () => void;
      'expired-callback'?: () => void;
    },
  ) => string;
  reset: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('turnstile script failed')));
      return;
    }
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('turnstile script failed'));
    document.head.appendChild(script);
  });
}

export function TurnstileGate({ siteKey }: { siteKey: string }) {
  const slotRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let widgetId: string | null = null;

    (async () => {
      try {
        await loadScript();
        if (cancelled || !slotRef.current || !window.turnstile) return;
        widgetId = window.turnstile.render(slotRef.current, {
          sitekey: siteKey,
          theme: 'auto',
          callback: async (token) => {
            setVerifying(true);
            try {
              const res = await fetch('/api/turnstile/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token }),
              });
              if (res.status === 204) {
                window.location.reload();
                return;
              }
              setVerifying(false);
              setError('验证未通过，请重试');
              if (widgetId && window.turnstile) window.turnstile.reset(widgetId);
            } catch {
              setVerifying(false);
              setError('网络错误，请重试');
              if (widgetId && window.turnstile) window.turnstile.reset(widgetId);
            }
          },
          'error-callback': () => setError('人机验证加载失败，请刷新页面'),
          'expired-callback': () => {
            if (widgetId && window.turnstile) window.turnstile.reset(widgetId);
          },
        });
      } catch {
        if (!cancelled) setError('人机验证加载失败，请刷新页面');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [siteKey]);

  return (
    <main className="relative flex min-h-screen flex-col bg-paper text-ink">
      <PageBackground intensity="subtle" />
      <PublicHeader showNav={false} />

      <div className="relative flex flex-1 items-center justify-center px-5 py-16">
        <div className="w-full max-w-[380px]">
          <div className="ds-card p-6">
            <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-tint text-brand">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 3l7 3v5c0 4.4-3 8.4-7 10-4-1.6-7-5.6-7-10V6z" />
                <path d="M9 12l2 2 4-4" />
              </svg>
            </div>

            <h1 className="mt-4 text-center font-display text-lg font-bold text-ink">
              安全验证
            </h1>
            <p className="mt-1.5 text-center text-[13px] leading-relaxed text-muted">
              {verifying ? '验证中，即将进入…' : '请完成人机验证以继续访问。'}
            </p>

            <div ref={slotRef} className="mt-5 flex justify-center" />

            {error && (
              <p role="alert" className="mt-3 text-center text-[13px] text-danger">
                {error}
              </p>
            )}
          </div>

          <p className="mt-4 text-center text-xs text-subtle">
            由 Cloudflare Turnstile 提供保护
          </p>
        </div>
      </div>

      <PublicFooter note="" />
    </main>
  );
}
