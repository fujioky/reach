// app/admin/analytics/_components/MediaBarChart.tsx
// Plan 06-03, Task 1 Part D — recharts BarChart wrapper for media interactions (D-68 item 3).
//
// 'use client' (Pitfall 1 — recharts uses getBoundingClientRect and class
// components, no SSR support). ResponsiveContainer with initialDimension
// suppresses the width(-1) SSR warning (Pitfall 2).
//
// Chart colors use hex values matching design tokens:
//   #5b4fe9 (--color-brand), #6c6b75 (--color-text-muted), #ecebf1 (--color-border).
'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface MediaBarChartProps {
  data: { mediaId: string; clicks: number }[];
}

export function MediaBarChart({ data }: MediaBarChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-[300px] items-center justify-center rounded-sm border border-border text-sm text-muted">
        暂无数据
      </div>
    );
  }

  return (
    <ResponsiveContainer
      width="100%"
      height={300}
      initialDimension={{ width: 600, height: 300 }} // SSR safety (Pitfall 2)
    >
      <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#ecebf1" />
        <XAxis
          dataKey="mediaId"
          tick={{ fontSize: 12, fill: '#6c6b75' }}
          axisLine={{ stroke: '#ecebf1' }}
        />
        <YAxis
          tick={{ fontSize: 12, fill: '#6c6b75' }}
          axisLine={{ stroke: '#ecebf1' }}
          allowDecimals={false}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: '#ffffff',
            border: '1px solid #ecebf1',
            borderRadius: 8,
            fontSize: 14,
          }}
        />
        <Bar dataKey="clicks" fill="#5b4fe9" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
