// lib/health/history.ts — rolling health probe history for status charts.

import { getSetting, setSetting } from '@/lib/settings';
import type { ServiceStatus } from '@/lib/health/checks';

export type HealthSamplePoint = {
  serviceId: ServiceStatus['id'];
  state: 'ok' | 'error' | 'skipped';
  latencyMs: number | null;
};

export type HealthSample = {
  checkedAt: string;
  points: HealthSamplePoint[];
};

const HISTORY_KEY = 'health_history' as const;
const MAX_SAMPLES = 288; // 24h @ 5 min
const MIN_INTERVAL_MS = 4 * 60 * 1000;

function parseHistory(raw: string): HealthSample[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as HealthSample[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function getHealthHistory(): Promise<HealthSample[]> {
  const raw = await getSetting(HISTORY_KEY);
  return parseHistory(raw);
}

export async function appendHealthSample(services: ServiceStatus[]): Promise<HealthSample | null> {
  const history = await getHealthHistory();
  const now = Date.now();
  const last = history[history.length - 1];
  if (last && now - new Date(last.checkedAt).getTime() < MIN_INTERVAL_MS) {
    return null;
  }

  const sample: HealthSample = {
    checkedAt: new Date().toISOString(),
    points: services.map((s) => ({
      serviceId: s.id,
      state: s.state,
      latencyMs: s.latencyMs ?? null,
    })),
  };

  const next = [...history, sample].slice(-MAX_SAMPLES);
  await setSetting(HISTORY_KEY, JSON.stringify(next));
  return sample;
}

export function historyToChartSeries(
  history: HealthSample[],
  serviceId: ServiceStatus['id'],
): { time: string; latency: number | null; up: number }[] {
  return history.map((sample) => {
    const point = sample.points.find((p) => p.serviceId === serviceId);
    const date = new Date(sample.checkedAt);
    return {
      time: date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
      latency: point?.latencyMs ?? null,
      up: point?.state === 'ok' ? 1 : point?.state === 'error' ? 0 : 0.5,
    };
  });
}