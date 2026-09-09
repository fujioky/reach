// app/admin/analytics/_components/OutlinkBarChart.tsx
// Plan 06-03, Task 1 Part D — recharts BarChart wrapper for outlink clicks (D-68 item 4).
//
// 'use client' (Pitfall 1 — recharts uses getBoundingClientRect and class
// components, no SSR support). ResponsiveContainer with initialDimension
// suppresses the width(-1) SSR warning (Pitfall 2).
//
// URL labels can be long — XAxis tickFormatter truncates to 30 chars with
// ellipsis so the chart stays readable.
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

interface OutlinkBarChartProps {
  data: { url: string; clicks: number }[];
}

// Truncate URL labels to 30 chars with ellipsis (URLs can be long).
function truncateUrl(url: string): string {
  if (url.length <= 30) return url;
  return url.slice(0, 30) + '…';
}

export function OutlinkBarChart({ data }: OutlinkBarChartProps) {
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
          dataKey="url"
          tickFormatter={truncateUrl}
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
