// app/admin/analytics/[shareId]/_components/BlockHeatmap.tsx
// 区块热图 — 水平条形热图，每个区块一行，颜色深浅 + 数值标注。
//
// 比 2×2 格子更易读：可以直接看出各区块相对停留时长。
// 无外部依赖，纯 Tailwind + inline style。

interface BlockDwell {
  blockId: string;
  dwellMs: number;
}

interface BlockHeatmapProps {
  blocks: BlockDwell[];
}

const CANONICAL_BLOCKS = ['body', 'gallery', 'video', 'comments'] as const;

const BLOCK_LABELS: Record<string, string> = {
  body: '正文',
  gallery: '媒体画廊',
  video: '视频',
  comments: '评论',
};

// Brand color in oklch-compatible rgb for opacity blending
const BRAND_RGB = '91, 79, 233'; // #5b4fe9

function formatMs(ms: number): string {
  if (ms === 0) return '—';
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m ${(s % 60).toFixed(0)}s`;
}

export function BlockHeatmap({ blocks }: BlockHeatmapProps) {
  const dwellMap = new Map<string, number>();
  for (const b of blocks) dwellMap.set(b.blockId, b.dwellMs);

  const maxDwell = Math.max(...CANONICAL_BLOCKS.map((id) => dwellMap.get(id) ?? 0), 1);

  return (
    <div className="overflow-hidden ds-card">
      {/* 图例 */}
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <span className="text-[12px] text-subtle">停留时长热图</span>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-subtle">少</span>
          {[0.1, 0.3, 0.5, 0.7, 0.9].map((op) => (
            <span
              key={op}
              className="h-3 w-4 rounded-sm"
              style={{ backgroundColor: `rgba(${BRAND_RGB}, ${op})` }}
            />
          ))}
          <span className="text-[10px] text-subtle">多</span>
        </div>
      </div>

      {/* 各区块行 */}
      <div className="flex flex-col divide-y divide-border">
        {CANONICAL_BLOCKS.map((blockId) => {
          const ms = dwellMap.get(blockId) ?? 0;
          const ratio = ms / maxDwell; // 0..1
          const pct = Math.round(ratio * 100);
          return (
            <div key={blockId} className="flex items-center gap-4 px-5 py-3.5">
              {/* 区块名 */}
              <div className="w-16 flex-shrink-0 text-[13px] font-medium text-ink">
                {BLOCK_LABELS[blockId] ?? blockId}
              </div>

              {/* 进度条 */}
              <div className="relative flex-1 h-5 overflow-hidden rounded-sm bg-surface-2">
                <div
                  className="h-full rounded-sm transition-all duration-500"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: `rgba(${BRAND_RGB}, ${Math.max(ratio, ms > 0 ? 0.15 : 0)})`,
                  }}
                />
                {/* 百分比标注（显示在条内或条后） */}
                {pct > 20 ? (
                  <span className="absolute inset-y-0 right-1.5 flex items-center text-[10px] font-semibold text-white/80">
                    {pct}%
                  </span>
                ) : null}
              </div>

              {/* 绝对时长 */}
              <div className="w-16 flex-shrink-0 text-right text-[12px] text-muted">
                {formatMs(ms)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
