// app/_components/brand/ReachMark.tsx — Reach 弧线 wordmark（D-83）
//
// 标记是一道「触达」的弧线：从受限的一端跨过去，连上对方。
// 两个节点 + 上扬弧线，信号感、克制。
//
// SVG path: M3.5 18.5 C3.5 9.5, 10.5 4.5, 20.5 4.5
//   左下圆点（受限端）→ 上扬弧线 → 右上圆点（触达端）
//
// 颜色：亮色 #5B4FE9 / 暗色 #8B82FF（通过 currentColor + text-brand 工具类自动适配）
//
// 用法：
//   <ReachMark />                    // 仅弧线 logo（30x30）
//   <ReachMark size={20} />          // 自定义尺寸
//   <ReachMarkWordmark />            // logo + "Reach" 文字（水平排列）
//   <ReachMarkWordmark size="lg" />  // 大号 wordmark

type ReachMarkProps = {
  size?: number;
  className?: string;
};

/** 仅弧线 logo — 两个圆点 + 上扬弧线 */
export function ReachMark({ size = 30, className }: ReachMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M3.5 18.5 C3.5 9.5, 10.5 4.5, 20.5 4.5"
        stroke="currentColor"
        strokeWidth={2.4}
        strokeLinecap="round"
      />
      <circle cx="20.5" cy="4.5" r="2.6" fill="currentColor" />
      <circle cx="3.5" cy="18.5" r="2.6" fill="currentColor" />
    </svg>
  );
}

type ReachMarkWordmarkProps = {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
};

const WORDMARK_SIZES = {
  sm: { mark: 18, text: 'text-base', gap: 'gap-1.5' },
  md: { mark: 24, text: 'text-xl', gap: 'gap-2' },
  lg: { mark: 30, text: 'text-2xl', gap: 'gap-2.5' },
} as const;

/** logo + "Reach" 文字 — Space Grotesk 700，字间距收紧 */
export function ReachMarkWordmark({
  size = 'md',
  className,
}: ReachMarkWordmarkProps) {
  const s = WORDMARK_SIZES[size];
  return (
    <span
      className={`inline-flex items-center ${s.gap} text-brand ${className ?? ''}`}
    >
      <ReachMark size={s.mark} />
      <span
        className={`font-display font-bold ${s.text} text-ink tracking-tight`}
      >
        Reach
      </span>
    </span>
  );
}
