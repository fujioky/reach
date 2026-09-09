'use client';

import { useCallback, useEffect, useState } from 'react';
import { Line, LineChart, ResponsiveContainer, YAxis } from 'recharts';
import { SurfaceCard } from '@/app/_components/ui/SurfaceCard';
import type { ServiceStatus } from '@/lib/health/checks';
import { historyToChartSeries, type HealthSample } from '@/lib/health/history';

type HealthPayload = {
  version: string;
  checkedAt: string;
  services: ServiceStatus[];
  history: HealthSample[];
};

const POLL_MS = 60_000;

function StateBadge({ state }: { state: ServiceStatus['state'] }) {
  if (state === 'ok') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-3 py-1 text-xs font-medium text-success">
        <span className="h-2 w-2 rounded-full bg-success" />
        正常
      </span>
    );
  }
  if (state === 'skipped') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1 text-xs font-medium text-muted">
        <span className="h-2 w-2 rounded-full bg-border" />
        未启用
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-danger/15 px-3 py-1 text-xs font-medium text-danger">
      <span className="h-2 w-2 rounded-full bg-danger" />
      异常
    </span>
  );
}

function LatencySparkline({
  data,
  stroke,
}: {
  data: { latency: number | null }[];
  stroke: string;
}) {
  const points = data.filter((d) => d.latency != null);
  if (points.length < 2) {
    return (
      <div className="flex h-10 w-28 items-center justify-center rounded-md bg-surface-2/60 text-[10px] text-subtle">
        积累中
      </div>
    );
  }

  return (
    <div className="h-10 w-28 shrink-0">
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 112, height: 40 }}>
        <LineChart data={points} margin={{ top: 4, right: 2, left: 2, bottom: 4 }}>
          <YAxis domain={['dataMin - 20', 'dataMax + 20']} hide />
          <Line
            type="monotone"
            dataKey="latency"
            stroke={stroke}
            strokeWidth={1.75}
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function sparklineColor(state: ServiceStatus['state']): string {
  if (state === 'ok') return '#22c55e';
  if (state === 'error') return '#ef4444';
  return '#9ca3af';
}

export function StatusDashboard({ initial }: { initial: HealthPayload }) {
  const [payload, setPayload] = useState(initial);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/status/health', { cache: 'no-store' });
      if (res.ok) {
        setPayload((await res.json()) as HealthPayload);
      }
    } catch {
      // Keep last good snapshot on transient errors.
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const operational = payload.services.filter((s) => s.state === 'ok').length;
  const monitored = payload.services.filter((s) => s.state !== 'skipped').length;
  const allOk =
    monitored > 0 && payload.services.every((s) => s.state === 'ok' || s.state === 'skipped');

  return (
    <>
      <SurfaceCard className="mb-6 p-5 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-xs font-medium uppercase tracking-wider text-subtle">总体</div>
            <div className={`mt-1 font-display text-lg font-bold ${allOk ? 'text-success' : 'text-ink'}`}>
              {allOk ? '核心服务运行正常' : '部分服务需要关注'}
            </div>
            <div className="mt-1 text-xs text-muted">
              {operational}/{monitored} 项已启用服务正常
            </div>
          </div>
          <div className="text-right text-xs text-subtle">
            <div>
              版本{' '}
              <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-muted">
                {payload.version}
              </code>
            </div>
            <div className="mt-1">
              检测于{' '}
              {new Date(payload.checkedAt).toLocaleString('zh-CN', {
                month: 'numeric',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
              {refreshing && <span className="ml-2 text-brand">刷新中…</span>}
            </div>
          </div>
        </div>
      </SurfaceCard>

      <div className="space-y-3">
        {payload.services.map((service) => {
          const series = historyToChartSeries(payload.history, service.id);
          const showLatency = service.state !== 'skipped';

          return (
            <SurfaceCard key={service.id} className="p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-display text-base font-semibold text-ink">{service.name}</h2>
                <StateBadge state={service.state} />
              </div>

              {showLatency && (
                <div className="mt-4 flex items-center justify-between gap-4 border-t border-border/50 pt-4">
                  <div className="min-w-0">
                    <div className="text-xs text-subtle">延迟</div>
                    <div className="mt-0.5 text-sm font-medium text-ink">
                      {service.latencyMs != null ? `${service.latencyMs} ms` : '—'}
                    </div>
                  </div>
                  <LatencySparkline data={series} stroke={sparklineColor(service.state)} />
                </div>
              )}

              {service.message && (
                <p
                  className={`text-xs ${service.state === 'error' ? 'text-danger' : 'text-muted'} ${showLatency ? 'mt-3' : 'mt-4 border-t border-border/50 pt-4'}`}
                >
                  {service.message}
                </p>
              )}
            </SurfaceCard>
          );
        })}
      </div>
    </>
  );
}