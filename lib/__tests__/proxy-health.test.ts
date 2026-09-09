// lib/__tests__/proxy-health.test.ts
// The video proxy's health check.
//
// The bug this covers: the check used to prove the proxy worked by pulling one
// byte of the newest stored video through it. A googlevideo URL expires within
// hours, so a healthy proxy reported HTTP 502 — the upstream was gone, not the
// proxy. Asking the proxy about itself fixes that, but only if "no health
// endpoint here" is told apart from "the proxy is down": a proxy without a
// health route treats `healthz` as a URL to go fetch, and fails in whatever way
// its upstream does. Every one of those must fall through to the byte pull, or
// the false alarm just moves.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { probeProxyHealthEndpoint, readHealthStatus } from '@/lib/health/checks';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

/** Answer each health path in order with the given responses. */
function mockPaths(responses: Response[]) {
  const spy = vi.spyOn(globalThis, 'fetch');
  for (const response of responses) spy.mockResolvedValueOnce(response);
  return spy;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('readHealthStatus', () => {
  it('reads the status word out of a JSON payload', () => {
    // Typical payload from a self-hosted proxy.
    expect(
      readHealthStatus('{"service":"dl-proxy","status":"ok","time":"2026-08-06T15:08:05Z"}'),
    ).toBe('ok');
    expect(readHealthStatus('{"state":"degraded"}')).toBe('degraded');
    expect(readHealthStatus('{"health":true}')).toBe('ok');
    expect(readHealthStatus('{"health":false}')).toBe('down');
  });

  it('returns null for JSON that states no status', () => {
    expect(readHealthStatus('{"uptime":31,"requests":900}')).toBeNull();
  });

  it('reads a bare plain-text status', () => {
    expect(readHealthStatus('ok')).toBe('ok');
    expect(readHealthStatus('OK\n')).toBe('OK');
  });

  it('returns null for prose, which is not a status word', () => {
    expect(readHealthStatus('The service is currently running normally, thanks for asking.')).toBeNull();
    expect(readHealthStatus('')).toBeNull();
  });
});

describe('probeProxyHealthEndpoint', () => {
  it('accepts a JSON ok from /healthz', async () => {
    mockPaths([new Response('{"service":"dl-proxy","status":"ok"}', { status: 200, headers: JSON_HEADERS })]);
    expect(await probeProxyHealthEndpoint('https://dl.example')).toEqual({ ok: true, status: 200 });
  });

  it('accepts a 200 whose body states nothing', async () => {
    mockPaths([new Response('{"uptime":"31s"}', { status: 200, headers: JSON_HEADERS })]);
    expect(await probeProxyHealthEndpoint('https://dl.example')).toEqual({ ok: true, status: 200 });
  });

  it('reports a proxy that says it is unwell', async () => {
    mockPaths([new Response('{"status":"degraded"}', { status: 200, headers: JSON_HEADERS })]);
    const result = await probeProxyHealthEndpoint('https://dl.example');
    expect(result?.ok).toBe(false);
    expect(result?.error).toContain('degraded');
  });

  it('falls through to /health when /healthz is missing', async () => {
    mockPaths([
      new Response('not found', { status: 404 }),
      new Response('{"status":"ok"}', { status: 200, headers: JSON_HEADERS }),
    ]);
    expect(await probeProxyHealthEndpoint('https://dl.example')).toEqual({ ok: true, status: 200 });
  });

  // The cases that must NOT become a "proxy is down" verdict. Each needs a
  // freshly built Response per call — a Response whose body has been read (or
  // cancelled) cannot be handed out twice.
  const inconclusive: Array<{ label: string; make: () => Response }> = [
    {
      label: '400 — the proxy read `healthz` as a target URL',
      make: () => new Response('bad dl target', { status: 400 }),
    },
    { label: '404 — no such route', make: () => new Response('nope', { status: 404 }) },
    { label: '502 — its upstream failed', make: () => new Response('bad gateway', { status: 502 }) },
    { label: '503 — the whole host is out', make: () => new Response('unavailable', { status: 503 }) },
    {
      label: '200 HTML — a catch-all route, not a health endpoint',
      make: () =>
        new Response('<!DOCTYPE html><html><body>ok</body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=UTF-8' },
        }),
    },
  ];

  for (const { label, make } of inconclusive) {
    it(`returns null for ${label}, leaving the byte-pull probe to decide`, async () => {
      mockPaths([make(), make()]);
      expect(await probeProxyHealthEndpoint('https://proxy.example')).toBeNull();
    });
  }

  it('returns null when the host cannot be reached at all', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await probeProxyHealthEndpoint('https://gone.example')).toBeNull();
  });

  it('appends the health path to a base that carries one', async () => {
    const spy = mockPaths([new Response('{"status":"ok"}', { status: 200, headers: JSON_HEADERS })]);
    await probeProxyHealthEndpoint('https://us.example/dl');
    expect(spy.mock.calls[0]?.[0]).toBe('https://us.example/dl/healthz');
  });
});
