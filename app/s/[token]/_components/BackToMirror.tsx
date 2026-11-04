'use client';

// app/s/[token]/_components/BackToMirror.tsx
// 「返回镜像」 on an opened post. When the reader came from the mirror page it
// goes back in history: instant, and it does not open the share again (a fresh
// visit would count a view, and a burn-after-read link would already be
// spent). Arriving any other way, it navigates to the mirror page.

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function BackToMirror({ token, title }: { token: string; title: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  function goBack() {
    setPending(true);
    const fromHere = document.referrer && new URL(document.referrer).origin === window.location.origin;
    if (fromHere && window.history.length > 1) router.back();
    else router.push(`/s/${token}`);
  }

  return (
    <button
      type="button"
      onClick={goBack}
      disabled={pending}
      className="mb-4 inline-flex max-w-full items-center gap-1.5 truncate text-[13px] text-muted transition-colors hover:text-ink disabled:opacity-70"
    >
      {pending ? (
        <span
          aria-hidden="true"
          className="inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent"
        />
      ) : (
        <span aria-hidden="true">←</span>
      )}
      <span className="truncate">返回镜像：{title}</span>
    </button>
  );
}
