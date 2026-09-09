// 页面背景装饰 — 品牌光晕 + 点阵网格 + 弧线标识

type PageBackgroundProps = {
  /** full: 首页级装饰；subtle: 内页轻量装饰 */
  intensity?: 'full' | 'subtle';
};

export function PageBackground({ intensity = 'full' }: PageBackgroundProps) {
  const isFull = intensity === 'full';

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div
        className={
          isFull
            ? 'absolute -left-32 top-24 h-[480px] w-[480px] rounded-full bg-brand/[0.07] blur-3xl'
            : 'absolute -left-20 top-0 h-[320px] w-[320px] rounded-full bg-brand/[0.04] blur-3xl'
        }
      />
      <div
        className={
          isFull
            ? 'absolute -right-24 top-0 h-[560px] w-[560px] rounded-full bg-brand/10 blur-3xl'
            : 'absolute -right-16 top-8 h-[360px] w-[360px] rounded-full bg-brand/[0.06] blur-3xl'
        }
      />
      {isFull && (
        <div className="absolute bottom-0 left-1/2 h-[400px] w-[800px] -translate-x-1/2 rounded-full bg-tint/60 blur-3xl dark:bg-brand/[0.06]" />
      )}
      {isFull && (
        <svg
          className="absolute -right-16 top-32 hidden text-brand/[0.08] md:block"
          width="420"
          height="420"
          viewBox="0 0 24 24"
          fill="none"
        >
          <path d="M3.5 18.5 C3.5 9.5, 10.5 4.5, 20.5 4.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          <circle cx="20.5" cy="4.5" r="2.6" fill="currentColor" />
          <circle cx="3.5" cy="18.5" r="2.6" fill="currentColor" />
        </svg>
      )}
      <div
        className={`absolute inset-0 ${isFull ? 'opacity-[0.35] dark:opacity-[0.12]' : 'opacity-[0.2] dark:opacity-[0.08]'}`}
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, var(--color-border) 1px, transparent 0)',
          backgroundSize: '28px 28px',
        }}
      />
    </div>
  );
}