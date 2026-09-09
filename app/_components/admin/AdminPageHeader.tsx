import Link from 'next/link';

export function AdminPageHeader({
  label,
  title,
  description,
  actions,
  backHref,
  backLabel,
  className = '',
}: {
  label?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  /** 上级页面路径 — 提供时在标题上方渲染「← 返回xxx」 */
  backHref?: string;
  backLabel?: string;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between ${className}`}>
      <div>
        {backHref && (
          <Link
            href={backHref}
            className="mb-2 inline-flex items-center gap-1 text-[12px] text-muted transition-colors hover:text-brand"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 18l-6-6 6-6" />
            </svg>
            返回{backLabel ?? '上一页'}
          </Link>
        )}
        {label && <div className="ds-section-label">{label}</div>}
        <h1 className={`${label ? 'mt-1.5' : ''} ds-page-heading`}>{title}</h1>
        {description && (
          <p className="mt-1 text-[13px] text-subtle">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}