'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ServiceStatus } from '@/lib/health/checks';
import { historyToChartSeries, type HealthSample } from '@/lib/health/history';

type Payload = {
  checkedAt: string;
  services: ServiceStatus[];
  history: HealthSample[];
};

const POLL_MS = 60_000;

function StateBadge({ state }: { state: ServiceStatus['state'] }) {
  if (state === 'ok') {
    return <span className="text-xs font-medium text-success">正常</span>;
  }
  if (state === 'skipped') {
    return <span className="text-xs font-medium text-muted">未启用</span>;
  }
  return <span className="text-xs font-medium text-danger">异常</span>;
}

function LatencyChart({
  title,
  data,
}: {
  title: string;
  data: { time: string; latency: number | null }[];
}) {
  const chartData = data.filter((d) => d.latency != null);
  if (chartData.length < 2) {
    return (
      <div className="rounded-md border border-border bg-surface px-3 py-5 text-center text-[11px] text-subtle">
        {title} · 数据积累中
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border bg-surface p-3">
      <div className="mb-2 text-[11px] font-medium text-muted">{title}</div>
      <ResponsiveContainer width="100%" height={120} initialDimension={{ width: 320, height: 120 }}>
        <LineChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#ecebf1" />
          <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#6c6b75' }} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 9, fill: '#6c6b75' }} width={40} unit="ms" />
          <Tooltip
            contentStyle={{ fontSize: 11, borderRadius: 6, border: '1px solid #ecebf1' }}
            formatter={(v) => [`${v} ms`, '延迟']}
          />
          <Line type="monotone" dataKey="latency" stroke="#5b4fe9" strokeWidth={2} dot={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function AdminSystemHealth() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/system-health', { cache: 'no-store' });
      if (res.ok) setPayload((await res.json()) as Payload);
    } catch {
      // Keep last snapshot.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const chartServices = useMemo(
    () => (payload?.services ?? []).filter((s) => s.state !== 'skipped'),
    [payload?.services],
  );

  return (
    <div className="mt-5 overflow-hidden ds-card">
      <div className="border-b border-border px-5 py-3.5">
        <h2 className="text-[15px] font-semibold text-ink">服务监控</h2>
        <p className="mt-0.5 text-[12px] text-subtle">
          管理员视图，显示真实上游地址与延迟趋势。公开 /status 页不展示具体域名。
        </p>
      </div>
      <div className="space-y-4 p-5">
        {loading && !payload && <p className="text-[12px] text-muted">加载监控数据…</p>}

        {payload && (
          <>
            <p className="text-[11px] text-subtle">
              最近检测：{' '}
              {new Date(payload.checkedAt).toLocaleString('zh-CN', {
                month: 'numeric',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
              {' · '}
              每 60 秒刷新
            </p>

            <div className="space-y-2">
              {payload.services.map((service) => (
                <div
                  key={service.id}
                  className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-border bg-paper px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="text-[12px] font-medium text-ink">{service.name}</div>
                    <div className="mt-0.5 break-all font-mono text-[11px] text-muted">
                      {service.configLabel}
                    </div>
                    {service.message && (
                      <div className="mt-1 text-[11px] text-danger">{service.message}</div>
                    )}
                  </div>
                  <div className="text-right text-[11px] text-muted">
                    <StateBadge state={service.state} />
                    {service.latencyMs != null && <div className="mt-1">{service.latencyMs} ms</div>}
                  </div>
                </div>
              ))}
            </div>

            {chartServices.length > 0 && (
              <div>
                <div className="mb-2 text-[12px] font-medium text-ink">延迟趋势（近 24 小时）</div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {chartServices.map((service) => (
                    <LatencyChart
                      key={service.id}
                      title={service.configLabel}
                      data={historyToChartSeries(payload.history, service.id)}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}