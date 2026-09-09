type SurfaceCardProps = {
  children: React.ReactNode;
  className?: string;
  interactive?: boolean;
  as?: 'div' | 'section' | 'article';
};

export function SurfaceCard({
  children,
  className = '',
  interactive = false,
  as: Tag = 'div',
}: SurfaceCardProps) {
  return (
    <Tag className={`${interactive ? 'ds-card-interactive' : 'ds-card'} ${className}`}>
      {children}
    </Tag>
  );
}