'use client';

// app/admin/(shell)/mirrors/_components/MirrorPasswordPanel.tsx
// Password gate for a mirror, on its detail page.
//
// The gate lives on the content item rather than on a share link: a password
// protects the content, while expiry / view caps / burn-after-read are
// properties of one link. So adding a second share link to the same mirror
// inherits the password automatically, which is what you want when the point is
// "this content needs a password".

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { setMirrorPassword } from '../actions';
import { PasswordSetting } from '@/app/admin/(shell)/articles/_components/PasswordSetting';
import type { PasswordMode } from '@/lib/content/password';

export function MirrorPasswordPanel({
  contentItemId,
  initialMode,
  hasStoredPassword,
  sitePasswordConfigured,
}: {
  contentItemId: string;
  initialMode: PasswordMode;
  hasStoredPassword: boolean;
  sitePasswordConfigured: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<PasswordMode>(initialMode);
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const dirty = mode !== initialMode || password.length > 0;

  const save = () => {
    startTransition(async () => {
      const result = await setMirrorPassword({ contentItemId, mode, password });
      if (!result.ok) {
        setMessage({ kind: 'error', text: result.error ?? '保存失败' });
        return;
      }
      setPassword('');
      setMessage({
        kind: 'ok',
        text: mode === 'none' ? '已取消密码保护' : '密码设置已保存',
      });
      router.refresh();
    });
  };

  return (
    <div className="ds-card p-5">
      <h2 className="text-lg font-semibold text-ink">访问密码</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">
        密码作用于这份内容，因此它的所有分享链接都需要同一个密码。
        密码在链接的有效期、次数限制之前验证——输错不会消耗访问次数，也不会触发阅后即焚。
      </p>

      <PasswordSetting
        mode={mode}
        onModeChange={setMode}
        password={password}
        onPasswordChange={setPassword}
        hasStoredPassword={hasStoredPassword}
        sitePasswordConfigured={sitePasswordConfigured}
      />

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={pending || !dirty}
          className="ds-btn-primary text-sm disabled:opacity-50"
        >
          {pending ? '保存中…' : '保存密码设置'}
        </button>
        {message && (
          <span
            className={`text-[13px] ${
              message.kind === 'ok' ? 'text-success' : 'text-danger'
            }`}
          >
            {message.text}
          </span>
        )}
      </div>
    </div>
  );
}
