// app/admin/(shell)/analytics/content/[id]/heatmap/_components/HeatmapViewer.tsx
// 点击热图查看器 — 在页面快照上叠加热力层。
//
// 快照来自一个代表性会话的 rrweb 录制：用 rrweb Replayer 渲染首帧（暂停），
// 把回放 iframe 拉高到整页文档高度（快照处于未滚动状态，整页内容都在），
// 快照宽度即该访客的视口宽度，等比缩放进面板。热力层是自绘 canvas：
// 灰度径向渐变累积强度 → 蓝→青→绿→黄→红 色带映射，无第三方热图库。
//
// 点击坐标按事件里记录的文档尺寸归一化后再投影到快照上，因此不同屏幕
// 宽度（同一设备分桶）的点击可以聚合到同一张快照。

'use client';

import { useEffect, useRef, useState } from 'react';
import 'rrweb/dist/style.css';

export interface HeatPoint {
  x: number;
  y: number;
  docW: number;
  docH: number;
}

interface HeatmapViewerProps {
  sessionId: string;
  viewportW: number;
  docH: number; // 目标文档高度（该会话点击记录的众数，退化为视口高）
  points: HeatPoint[];
}

type Status = 'loading' | 'ready' | 'error';

const RADIUS = 26;

/** 灰度强度图 → 色带（透明→蓝→青→绿→黄→红） */
function colorize(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255; // alpha 通道即累积强度
    if (a === 0) continue;
    const t = Math.min(1, a * 1.4);
    let r = 0, g = 0, b = 0;
    if (t < 0.25) { b = 255; g = Math.round((t / 0.25) * 160); }
    else if (t < 0.5) { b = Math.round(255 * (1 - (t - 0.25) / 0.25)); g = 220; }
    else if (t < 0.75) { g = 255; r = Math.round(((t - 0.5) / 0.25) * 255); }
    else { r = 255; g = Math.round(255 * (1 - (t - 0.75) / 0.25)); }
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
    d[i + 3] = Math.round(Math.min(0.72, a + 0.18) * 255);
  }
  ctx.putImageData(img, 0, 0);
}

export function HeatmapViewer({ sessionId, viewportW, docH, points }: HeatmapViewerProps) {
  const snapshotRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const outerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [renderedH, setRenderedH] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const snapshotEl = snapshotRef.current;
    const outer = outerRef.current;

    (async () => {
      try {
        const res = await fetch(`/api/admin/analytics/session/${sessionId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { events: unknown[] };
        if (cancelled || !snapshotEl || !outer) return;
        if (!Array.isArray(data.events) || data.events.length < 2) throw new Error('empty');

        const { Replayer } = await import('rrweb');
        if (cancelled) return;

        // 事件对服务器是不透明的 unknown[]；Replayer 需要 eventWithTime[]
        const events = data.events as ConstructorParameters<typeof Replayer>[0];
        const replayer = new Replayer(events, {
          root: snapshotEl,
          mouseTail: false,
          speed: 1,
        });
        // 渲染首个全量快照后立刻暂停 — 我们只要静态页面。
        // 快照事件（type 2）可能比首事件晚若干毫秒，定位到它之后一点。
        const raw = data.events as { type?: number; timestamp?: number }[];
        const firstTs = raw[0]?.timestamp ?? 0;
        const snapEvent = raw.find((e) => e.type === 2);
        replayer.pause(snapEvent?.timestamp ? snapEvent.timestamp - firstTs + 1 : 1);

        // 快照 iframe：宽 = 访客视口，高 = 整页文档高度（页面未滚动，
        // 拉高即可露出全部内容）
        const iframe = replayer.iframe;
        const wrapper = snapshotEl.querySelector<HTMLElement>('.replayer-wrapper');
        iframe.style.width = `${viewportW}px`;
        iframe.style.height = `${docH}px`;
        if (wrapper) {
          wrapper.style.transform = 'none';
          wrapper.style.position = 'static';
        }

        const scale = Math.min(1, (outer.clientWidth || 900) / viewportW);
        snapshotEl.style.transform = `scale(${scale})`;
        snapshotEl.style.transformOrigin = 'top left';
        snapshotEl.style.width = `${viewportW}px`;
        const outH = Math.round(docH * scale);
        setRenderedH(outH);

        // ── 热力层 ──
        const canvas = canvasRef.current;
        if (canvas) {
          const cw = Math.round(viewportW * scale);
          canvas.width = cw;
          canvas.height = outH;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.clearRect(0, 0, cw, outH);
            for (const p of points) {
              if (!p.docW || !p.docH) continue;
              const px = (p.x / p.docW) * viewportW * scale;
              const py = (p.y / p.docH) * docH * scale;
              const grad = ctx.createRadialGradient(px, py, 0, px, py, RADIUS);
              grad.addColorStop(0, 'rgba(0,0,0,0.22)');
              grad.addColorStop(1, 'rgba(0,0,0,0)');
              ctx.fillStyle = grad;
              ctx.beginPath();
              ctx.arc(px, py, RADIUS, 0, Math.PI * 2);
              ctx.fill();
            }
            colorize(ctx, cw, outH);
          }
        }
        setStatus('ready');
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      if (snapshotEl) snapshotEl.innerHTML = '';
    };
  }, [sessionId, viewportW, docH, points]);

  return (
    <div ref={outerRef} className="w-full">
      {status === 'loading' && (
        <div className="rounded-lg border border-border py-16 text-center text-[13px] text-subtle">
          快照渲染中…
        </div>
      )}
      {status === 'error' && (
        <div className="rounded-lg border border-border py-16 text-center text-[13px] text-danger">
          快照加载失败 — 该会话可能没有完整录制
        </div>
      )}
      <div
        className={status === 'ready' ? 'relative overflow-hidden rounded-lg ring-1 ring-border' : 'hidden'}
        style={{ height: renderedH || undefined }}
      >
        <div ref={snapshotRef} className="pointer-events-none absolute left-0 top-0" />
        <canvas
          ref={canvasRef}
          className="pointer-events-none absolute left-0 top-0 z-10"
          aria-label="点击热图叠加层"
        />
      </div>
      {status === 'ready' && (
        <div className="mt-2 text-[11px] text-subtle">
          共 {points.length} 次点击 · 快照宽度 {viewportW}px（与访客屏幕一致）· 蓝→红 表示点击密度递增
        </div>
      )}
    </div>
  );
}
