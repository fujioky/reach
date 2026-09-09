'use client';

// app/admin/(shell)/articles/_components/PasswordSetting.tsx
// Password mode picker, shared by the article editor and the mirror settings.
//
// Three modes rather than a single password field, because "use the site
// password" and "use this specific password" behave differently over time:
// changing the site password should move every inheriting item at once, which
// it can't if the password was copied into each one at save time.
//
// The existing password is never sent to the browser — only whether one is set.
// Leaving the field blank on an already-protected item keeps the current
// password, matching how every password form works.

import type { PasswordMode } from '@/lib/content/password';

export function PasswordSetting({
  mode,
  onModeChange,
  password,
  onPasswordChange,
  hasStoredPassword,
  sitePasswordConfigured,
}: {
  mode: PasswordMode;
  onModeChange: (mode: PasswordMode) => void;
  password: string;
  onPasswordChange: (password: string) => void;
  /** True when this item already has a custom password saved. */
  hasStoredPassword: boolean;
  /** False when no site-wide password exists, making 'inherit' a no-op. */
  sitePasswordConfigured: boolean;
}) {
  const OPTIONS: Array<{ value: PasswordMode; label: string; hint: string }> = [
    { value: 'none', label: '不加密', hint: '任何人凭链接可读' },
    {
      value: 'inherit',
      label: '使用系统密码',
      hint: sitePasswordConfigured
        ? '跟随「系统设置」里的统一密码，改一处即可全部生效'
        : '系统密码尚未设置——保存后内容仍是公开的',
    },
    { value: 'custom', label: '单独设置密码', hint: '只对这一篇生效' },
  ];

  return (
    <div className="mt-4">
      <div className="text-xs font-medium text-muted">访问密码</div>

      <div className="mt-1.5 flex flex-col gap-1.5">
        {OPTIONS.map((option) => (
          <label
            key={option.value}
            className={`flex cursor-pointer items-start gap-2.5 rounded-md border p-2.5 transition-colors ${
              mode === option.value
                ? 'border-brand bg-brand/5'
                : 'border-border bg-surface hover:bg-surface-2'
            }`}
          >
            <input
              type="radio"
              name="passwordMode"
              value={option.value}
              checked={mode === option.value}
              onChange={() => onModeChange(option.value)}
              className="mt-0.5 h-3.5 w-3.5 accent-brand"
            />
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-ink">{option.label}</span>
              <span
                className={`mt-0.5 block text-xs leading-relaxed ${
                  option.value === 'inherit' && !sitePasswordConfigured
                    ? 'text-warning'
                    : 'text-subtle'
                }`}
              >
                {option.hint}
              </span>
            </span>
          </label>
        ))}
      </div>

      {mode === 'custom' && (
        <div className="mt-2.5">
          <input
            type="password"
            value={password}
            onChange={(e) => onPasswordChange(e.target.value)}
            autoComplete="new-password"
            placeholder={hasStoredPassword ? '留空则保持当前密码' : '设置密码'}
            className="ds-input text-[13px]"
          />
          {hasStoredPassword && !password && (
            <p className="mt-1 text-xs text-subtle">已设置密码，留空保存则不改动。</p>
          )}
        </div>
      )}

      {mode !== 'none' && (
        <p className="mt-2 text-xs leading-relaxed text-subtle">
          访客输对密码后，使用同一个密码的其他内容也会一并解锁，有效期 7 天。
        </p>
      )}
    </div>
  );
}
