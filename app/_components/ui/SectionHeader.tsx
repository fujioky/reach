export function SectionHeader({
  label,
  title,
  description,
  className = '',
}: {
  label?: string;
  title: string;
  description?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      {label && <div className="ds-section-label">{label}</div>}
      <h2 className={`${label ? 'mt-2' : ''} ds-page-heading`}>{title}</h2>
      {description && <p className="ds-page-subtitle">{description}</p>}
    </div>
  );
}