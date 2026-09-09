// app/admin/mirrors/new/page.tsx
// RSC shell for the single-page streaming create wizard (D-21).
//
// Auth is already enforced by app/admin/(shell)/layout.tsx (await auth()).
// This page fetches current storage usage (D-17) and passes it to the
// client wizard so it can show inline quota color warnings (D-19).
import Link from 'next/link';
import { getStorageUsage, LIMITS } from '@/lib/quota';
import { CreateMirrorWizard } from '../_components/CreateMirrorWizard';

export default async function NewMirrorPage() {
  // D-17: real-time aggregation for inline quota warning (D-19)
  const usedBytes = await getStorageUsage();

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/admin/mirrors"
        className="inline-flex items-center gap-1 text-[12px] text-muted transition-colors hover:text-brand"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        返回镜像管理
      </Link>
      <CreateMirrorWizard
        usedBytes={usedBytes}
        totalQuota={LIMITS.totalQuota}
      />
    </div>
  );
}
