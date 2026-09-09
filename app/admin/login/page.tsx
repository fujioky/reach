import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { db, users } from '@/lib/db';
import { setupAdmin, login } from './actions';
import { ReachMark } from '@/app/_components/brand/ReachMark';
import { PageBackground } from '@/app/_components/layout/PageBackground';
import { SurfaceCard } from '@/app/_components/ui/SurfaceCard';

const ERROR_MESSAGES: Record<string, string> = {
  invalid: '用户名或密码错误',
  validation: '输入不合法，请检查用户名和密码',
  password_mismatch: '两次输入的密码不一致',
  admin_exists: '管理员已存在，不允许后续添加',
  setup_failed: '管理员已创建，但自动登录失败，请手动登录',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; u?: string }>;
}) {
  const existingUsers = await db.select().from(users).limit(1);
  const isSetupMode = existingUsers.length === 0;

  // Already signed in — skip the login form (setup mode still needs the form).
  if (!isSetupMode) {
    const session = await auth();
    if (session?.user) {
      redirect('/admin');
    }
  }

  const { error: errorCode, u: prefilledUsername } = await searchParams;
  const errorMessage = errorCode ? ERROR_MESSAGES[errorCode] ?? '发生错误' : null;

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-paper px-6 font-sans">
      <PageBackground intensity="full" />

      <SurfaceCard className="relative w-full max-w-[440px] px-8 py-10 md:px-12">
        <div className="flex items-center justify-center gap-2.5">
          <ReachMark size={30} className="text-brand" />
          <span className="font-display text-[26px] font-bold text-ink">Reach</span>
        </div>
        <p className="mt-2.5 text-center text-[13px] text-muted">
          {isSetupMode ? '首次安装 · 设置管理员' : '管理后台 · 仅限管理员'}
        </p>

        {errorMessage && (
          <div className="mt-6 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-center text-sm text-danger">
            {errorMessage}
          </div>
        )}

        <div className="mt-8">
          {isSetupMode ? <SetupForm /> : <LoginForm defaultUsername={prefilledUsername ?? ''} />}
        </div>

        <p className="mt-5 text-center text-[11px] text-subtle">
          访客无需登录 · 凭分享链接直接访问
        </p>
      </SurfaceCard>
    </div>
  );
}

const inputClass =
  'w-full rounded-[10px] border border-border bg-surface px-3.5 py-3 text-sm text-ink placeholder-subtle outline-none transition-colors focus:border-brand';
const labelClass = 'mb-1.5 block text-xs text-muted';
const buttonClass =
  'w-full rounded-[10px] border-0 bg-brand py-3 text-center text-[15px] font-semibold text-white shadow-brand-lg transition-colors hover:bg-brand-hover';

function SetupForm() {
  return (
    <form action={setupAdmin} className="flex flex-col gap-4">
      <div>
        <label className={labelClass} htmlFor="username">用户名</label>
        <input className={inputClass} id="username" name="username" type="text" required placeholder="admin" />
      </div>
      <div>
        <label className={labelClass} htmlFor="password">密码</label>
        <input className={inputClass} id="password" name="password" type="password" required placeholder="••••••••" />
      </div>
      <div>
        <label className={labelClass} htmlFor="confirmPassword">确认密码</label>
        <input className={inputClass} id="confirmPassword" name="confirmPassword" type="password" required placeholder="••••••••" />
      </div>
      <button className={buttonClass} type="submit">设置并登录</button>
    </form>
  );
}

function LoginForm({ defaultUsername }: { defaultUsername?: string }) {
  return (
    <form action={login} className="flex flex-col gap-4">
      <div>
        <label className={labelClass} htmlFor="username">用户名</label>
        <input className={inputClass} id="username" name="username" type="text" required placeholder="admin" defaultValue={defaultUsername} />
      </div>
      <div>
        <label className={labelClass} htmlFor="password">密码</label>
        <input className={inputClass} id="password" name="password" type="password" required placeholder="••••••••" />
      </div>
      <label className="flex cursor-pointer items-center gap-2.5 text-[13px] text-muted">
        <input
          type="checkbox"
          name="remember"
          defaultChecked
          className="h-4 w-4 rounded border-border accent-brand"
        />
        <span>
          记住登录
          <span className="mt-0.5 block text-[11px] text-subtle">勾选后 30 天内免登录；不勾选则 8 小时后需重新登录</span>
        </span>
      </label>
      <button className={buttonClass} type="submit">登录</button>
    </form>
  );
}