// app/admin/(shell)/analytics/session/[id]/_components/SessionPlayer.tsx
// rrweb 会话回放播放器 — 画布尺寸与访客视口一致（等比缩放适配面板宽度）。
//
// 事件数据经 /api/admin/analytics/session/[id] 拉取（录制可达数 MB，不随
// HTML 下发）。rrweb-player 自带进度条/倍速/跳过空闲控制器。

'use client';

import { useEffect, useRef, useState } from 'react';
import 'rrweb-player/dist/style.css';
import { attachIframeMediaGate, createReplayMediaGate } from './replay-media-gate';
import {
  buildMediaTimelines,
  createReplayVideoSync,
  type TimelineEvent,
} from './replay-video-sync';

interface SessionPlayerProps {
  sessionId: string;
  viewportW: number | null;
  viewportH: number | null;
}

type Status = 'loading' | 'empty' | 'no-snapshot' | 'ready' | 'error';
type MediaHint = 'idle' | 'waiting' | 'blocked';

export function SessionPlayer({ sessionId, viewportW, viewportH }: SessionPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const continueRef = useRef<(() => void) | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [mediaHint, setMediaHint] = useState<MediaHint>('idle');

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    let detachGate: (() => void) | undefined;
    setMediaHint('idle');

    (async () => {
      try {
        const res = await fetch(`/api/admin/analytics/session/${sessionId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { events: unknown[]; timeline?: TimelineEvent[] };
        if (cancelled || !container) return;
        if (!Array.isArray(data.events) || data.events.length < 2) {
          setStatus('empty');
          return;
        }
        // 回放必须有全量快照（rrweb type 2）；早期版本的录制器在首批
        // 上报失败时会永久丢失它，这类会话只能看事件时间线
        if (!data.events.some((e) => (e as { type?: number }).type === 2)) {
          setStatus('no-snapshot');
          return;
        }
        const { default: rrwebPlayer } = await import('rrweb-player');
        if (cancelled) return;
        // 事件对服务器是不透明的 unknown[]；播放器需要 eventWithTime[]
        type PlayerProps = ConstructorParameters<typeof rrwebPlayer>[0]['props'];
        const events = data.events as PlayerProps['events'];

        const w = viewportW || 1280;
        const h = viewportH || 720;
        // 等比缩小到容器宽度；不放大（1:1 才是访客真实所见）
        const scale = Math.min(1, (container.clientWidth || 900) / w);
        const player = new rrwebPlayer({
          target: container,
          props: {
            events,
            width: Math.round(w * scale),
            height: Math.round(h * scale),
            autoPlay: true,
            skipInactive: true,
            mouseTail: { strokeStyle: '#5b4fe9', lineWidth: 2, duration: 600 },
          },
        });

        // ── 确定性视频同步：回放里的 <video> 与访客当时的状态完全一致 ──
        // 以结构化 video 事件为事实来源，每帧校正位置/播放态/倍速；
        // rrweb 事件时间戳与结构化事件时间戳来自访客同一时钟，可直接对齐。
        const replayer = player.getReplayer();
        const baseTs = (data.events[0] as { timestamp?: number })?.timestamp ?? 0;
        const sync = createReplayVideoSync({
          timelines: buildMediaTimelines(data.timeline ?? []),
          getVideos: () =>
            replayer.iframe.contentDocument?.querySelectorAll('video') ?? [],
          getSpeed: () => replayer.config.speed,
        });
        player.addEventListener('ui-update-current-time', (detail) => {
          const t = (detail as { payload?: number } | undefined)?.payload;
          if (typeof t === 'number') sync.reconcile(baseTs + t);
        });

        let userPaused = false;
        let gateOwnsPause = false;
        player.addEventListener('ui-update-player-state', (detail) => {
          const state = (detail as { payload?: string } | undefined)?.payload;
          if (state === 'playing') {
            userPaused = false;
            gateOwnsPause = false;
          } else if (state === 'paused') {
            // 只豁免门控自己触发的那一次 paused；随后的 paused 一定来自用户
            if (!gateOwnsPause) userPaused = true;
            gateOwnsPause = false;
          }
          sync.setPlayerPlaying(state === 'playing');
        });
        sync.setPlayerPlaying(true); // autoPlay: true — 初始即在播放

        const gatedPlayer = {
          pause: () => {
            gateOwnsPause = true;
            player.pause();
          },
          play: () => {
            gateOwnsPause = false;
            player.play();
          },
        };
        const gate = createReplayMediaGate({
          player: gatedPlayer,
          isUserPaused: () => userPaused,
          onWaitingChange: (waiting) => {
            if (!cancelled) setMediaHint((prev) => (waiting ? 'waiting' : prev === 'blocked' ? 'blocked' : 'idle'));
          },
          onBlocked: () => {
            if (!cancelled) setMediaHint('blocked');
          },
        });
        continueRef.current = () => {
          gate.continueAnyway();
          if (!cancelled) setMediaHint('idle');
        };
        detachGate = attachIframeMediaGate(player.getReplayer().iframe, gate);

        setStatus('ready');
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      continueRef.current = null;
      detachGate?.();
      if (container) container.innerHTML = '';
    };
  }, [sessionId, viewportW, viewportH]);

  return (
    <div className="flex flex-col gap-3">
      {status === 'loading' && (
        <div className="rounded-lg border border-border py-16 text-center text-[13px] text-subtle">
          录制加载中…
        </div>
      )}
      {status === 'empty' && (
        <div className="rounded-lg border border-border py-16 text-center text-[13px] text-subtle">
          此会话没有可回放的录制（访客可能开启了脚本拦截，或停留过短）
        </div>
      )}
      {status === 'no-snapshot' && (
        <div className="rounded-lg border border-border py-16 text-center text-[13px] text-subtle">
          录制缺少初始页面快照（首批上报当时失败），无法回放 —
          下方行为时间线仍然完整
        </div>
      )}
      {status === 'error' && (
        <div className="rounded-lg border border-border py-16 text-center text-[13px] text-danger">
          录制加载失败，请刷新重试
        </div>
      )}
      <div
        ref={containerRef}
        className={status === 'ready' ? 'overflow-x-auto rounded-lg ring-1 ring-border' : 'hidden'}
      />
      {status === 'ready' && mediaHint === 'waiting' && (
        <div className="text-[12px] text-muted">等待视频加载…</div>
      )}
      {status === 'ready' && mediaHint === 'blocked' && (
        <div className="flex items-center gap-3 text-[12px] text-muted">
          <span>视频未就绪，回放已暂停</span>
          <button
            type="button"
            className="rounded-md border border-border px-2 py-0.5 text-[12px] text-ink hover:bg-surface-2"
            onClick={() => continueRef.current?.()}
          >
            继续回放
          </button>
        </div>
      )}
      {status === 'ready' && viewportW && viewportH && (
        <div className="text-[11px] text-subtle">
          访客视口 {viewportW}×{viewportH} · 画面按等比缩放，与访客屏幕内容一致
        </div>
      )}
    </div>
  );
}
