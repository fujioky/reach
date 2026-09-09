// 限宽容器 — 与设计稿 1120px 画布对齐

export function PageContainer({
  children,
  className = '',
  as: Tag = 'div',
}: {
  children: React.ReactNode;
  className?: string;
  as?: 'div' | 'main';
}) {
  return (
    <Tag className={`relative mx-auto w-full max-w-[1120px] ${className}`}>
      {children}
    </Tag>
  );
}