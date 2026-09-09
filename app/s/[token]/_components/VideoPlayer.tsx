// app/s/[token]/_components/VideoPlayer.tsx
// Client component — Plyr video player wrapper (D-42) with step indicator observability.
//
// ⚠️ CRITICAL LANDMINE (D-42, RESEARCH §7, PATTERNS §15):
// Plyr accesses `document` at import time. In a Next.js SSR environment
// this throws `ReferenceError: document is not defined`. Mitigation:
//   1. 'use client' — this component only runs in the browser
//   2. `import type Plyr from 'plyr'` — type-only import, erased at build,
//      does NOT execute plyr module code during SSR
//   3. `import('plyr')` inside useEffect — dynamic import deferred to
//      client-side hydration, after `document` exists
//   4. cleanup: `plyrInstance?.destroy()` — prevent memory leaks on unmount
//
// Observability:
//   Step indicator while loading (above the video on X, below on YouTube).
//   Backend steps (download / upload / refresh) use server byte progress;
//   playback ends with 「加载首帧」(browser progress) → 「准备播放」. After
//   the first frame renders, the indicator dwells ~3s then fades out.

'use client';

import { useEffect, useRef, useState, useCallback, Fragment } from 'react';
import 'plyr/dist/plyr.css';

import type * as PlyrModule from 'plyr';
import { decodeEntities, looksChinese, parseVttCues, buildVtt } from './subtitle-utils';
type PlyrInstance = PlyrModule.default;

/** /api/translate 单次请求上限（服务端限制 50） */
const TRANSLATE_BATCH_SIZE = 50;

interface VideoStatusResponse {
  status: string;
  label: string;
  done: boolean;
  hasStorage: boolean;
  storageEnabled: boolean;
  storageStale?: boolean;
  playbackUrl?: string;
  errorDetail: string | null;
  progress: number | null; // 0-100, null when backend has no progress to report
}

interface Step {
  id: string;
  label: string;
}

// Show the step indicator immediately — users should see what's happening
// from the first moment, not after a delay.
const STATUS_SHOW_DELAY_MS = 0;
// How often to poll video-status while waiting (ms)
const STATUS_POLL_INTERVAL_MS = 3000;
// Keep the indicator visible after the first frame before fading (ms)
const FIRST_FRAME_DWELL_MS = 3000;
// Fade-out duration before removing indicator from DOM (ms)
const FADE_OUT_MS = 1200;

const PLAYBACK_TAIL: Step[] = [
  { id: 'firstframe', label: '加载首帧' },
  { id: 'play', label: '准备播放' },
];

/** Storage pipeline: mirrors video-status refreshing → downloading → uploading. */
const STORAGE_PIPELINE_STEPS: Step[] = [
  { id: 'refresh', label: '更新链接' },
  { id: 'download', label: '下载视频' },
  { id: 'upload', label: '上传存储' },
  ...PLAYBACK_TAIL,
];

function storagePipelineIndex(status: string, storageStale: boolean): number {
  if (status === 'uploading') return 2;
  if (status === 'downloading') return 1;
  if (status === 'refreshing') return 0;
  // Stale blob but URL still valid — refresh is skipped, re-upload starts at download.
  if (storageStale) return 1;
  return 0;
}

/**
 * Build a dynamic step list from backend status + first-frame state.
 * Backend steps (download/upload/refresh) precede the playback tail:
 * connect → 加载首帧 (browser progress) → 准备播放 (dwell after first frame).
 */
function buildSteps(
  status: string,
  hasStorage: boolean,
  storageEnabled: boolean,
  storageStale: boolean,
  firstFrameLoaded: boolean,
): { steps: Step[]; currentIndex: number } {
  if (status === 'error') {
    return { steps: [], currentIndex: -1 };
  }

  if (firstFrameLoaded) {
    const connectLabel = hasStorage || status === 'ready' ? '从存储加载' : '连接视频源';
    const steps = [{ id: 'connect', label: connectLabel }, ...PLAYBACK_TAIL];
    return { steps, currentIndex: steps.length };
  }

  if (
    storageEnabled &&
    (storageStale || ['refreshing', 'downloading', 'uploading'].includes(status))
  ) {
    return {
      steps: STORAGE_PIPELINE_STEPS,
      currentIndex: storagePipelineIndex(status, storageStale),
    };
  }

  if (status === 'refreshing') {
    const prefix = [
      { id: 'refresh', label: '更新链接' },
      { id: 'connect', label: '连接视频源' },
    ];
    return { steps: [...prefix, ...PLAYBACK_TAIL], currentIndex: 0 };
  }

  const connectLabel = hasStorage || status === 'ready' ? '从存储加载' : '连接视频源';
  const playbackSteps: Step[] = [
    { id: 'connect', label: connectLabel },
    ...PLAYBACK_TAIL,
  ];

  if (['fresh', 'ready'].includes(status)) {
    return { steps: playbackSteps, currentIndex: 1 };
  }

  return { steps: playbackSteps, currentIndex: 0 };
}

/** Steps backed by server-reported byte progress */
const BACKEND_PROGRESS_STEPS = new Set(['download', 'upload']);
/** Step that tracks browser progress toward the first frame */
const FIRST_FRAME_PROGRESS_STEP = 'firstframe';

/** Estimate 0–100% progress until the first frame is available */
function computeFirstFrameProgress(video: HTMLVideoElement): number {
  if (video.readyState >= 2) return 100;
  if (video.readyState >= 1) {
    let pct = 20;
    if (video.buffered.length > 0) {
      const end = video.buffered.end(video.buffered.length - 1);
      const dur = video.duration;
      if (dur && isFinite(dur) && dur > 0) {
        pct = Math.max(pct, Math.min(95, Math.round((end / dur) * 100)));
      } else {
        pct = Math.max(pct, 55);
      }
    }
    return pct;
  }
  if (video.networkState === 2) return 10;
  return 0;
}

const RING_SIZE = 20;
const RING_SIZE_LARGE = 24;
const RING_STROKE = 2.5;

/** Circular progress ring — determinate when percent is set, spinner otherwise */
function StepProgressIcon({
  percent,
  large = false,
}: {
  percent: number | null;
  large?: boolean;
}) {
  const size = large ? RING_SIZE_LARGE : RING_SIZE;
  const r = (size - RING_STROKE) / 2;
  const cx = size / 2;
  const circumference = 2 * Math.PI * r;

  if (percent === null) {
    return (
      <svg
        className="animate-spin text-brand"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
      </svg>
    );
  }

  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  const offset = circumference * (1 - clamped / 100);

  return (
    <span
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="text-brand">
        <circle
          cx={cx}
          cy={cx}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={RING_STROKE}
          className="opacity-20"
        />
        <circle
          cx={cx}
          cy={cx}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={RING_STROKE}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${cx} ${cx})`}
          className="transition-[stroke-dashoffset] duration-300 ease-out"
        />
      </svg>
      <span className="absolute text-[7px] font-bold leading-none text-brand tabular-nums">
        {clamped}
      </span>
    </span>
  );
}

function StepIndicator({
  steps,
  currentIndex,
  fadingOut,
  getStepProgress,
  position,
}: {
  steps: Step[];
  currentIndex: number;
  fadingOut: boolean;
  getStepProgress: (i: number) => number | null;
  position: 'above' | 'below';
}) {
  const spacing = position === 'above'
    ? 'pb-2'
    : 'shrink-0 rounded-b-xl border-t border-border/40 bg-paper px-4 py-3';

  return (
    <div
      className={`${spacing} transition-opacity duration-[1200ms] ease-out ${fadingOut ? 'opacity-0' : 'opacity-100'}`}
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[11px] font-medium text-muted">
        {steps.map((step, i) => {
          const isDone = i < currentIndex;
          const isActive = i === currentIndex;
          const isPending = i > currentIndex;
          const pct = getStepProgress(i);
          const showLargeRing = isActive && step.id != null && (
            BACKEND_PROGRESS_STEPS.has(step.id) || step.id === FIRST_FRAME_PROGRESS_STEP
          );
          return (
            <Fragment key={step.id}>
              {i > 0 && (
                <span className="text-border select-none" aria-hidden="true">→</span>
              )}
              <div className="flex items-center gap-1">
                {isDone && (
                  <svg className="h-3 w-3 text-green-500" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                    <path d="M2.5 6.5L5 9L9.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
                {isActive && (
                  <StepProgressIcon
                    percent={pct === 0 ? null : pct}
                    large={showLargeRing}
                  />
                )}
                {isPending && (
                  <svg className="h-3 w-3 text-border" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                    <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.2" />
                  </svg>
                )}
                <span className={
                  isActive ? 'text-ink' :
                  isDone ? 'text-muted' :
                  'text-border'
                }>
                  {step.label}
                </span>
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

export function VideoPlayer({
  src,
  poster,
  shareToken,
  mediaId,
  platform = 'x',
  indicatorPosition = 'above',
  captionsVtt,
  captionsLang,
}: {
  src: string;
  poster?: string;
  shareToken?: string;
  mediaId?: string;
  /** YouTube layout always places the step indicator below the player. */
  platform?: 'youtube' | 'x';
  /** X/Twitter: above the player (default). Ignored when platform is youtube. */
  indicatorPosition?: 'above' | 'below';
  /** Timed WEBVTT captions (from platformData.transcriptVtt). */
  captionsVtt?: string;
  /** Caption track language ('zh-CN', 'en', ...). */
  captionsLang?: string;
}) {
  const effectiveIndicatorPosition = platform === 'youtube' ? 'below' : indicatorPosition;
  const videoRef = useRef<HTMLVideoElement>(null);
  const plyrRef = useRef<PlyrInstance | null>(null);

  // Indicator state — show immediately when we can poll backend status
  const [showIndicator, setShowIndicator] = useState(Boolean(shareToken && mediaId));
  const [fadingOut, setFadingOut] = useState(false);
  const [firstFrameLoaded, setFirstFrameLoaded] = useState(false);
  const [statusData, setStatusData] = useState<VideoStatusResponse | null>(null);

  // Browser progress toward the first frame (0-100)
  const [firstFrameProgress, setFirstFrameProgress] = useState(0);

  // Error state
  const [errorInfo, setErrorInfo] = useState<{ message: string; detail?: string | null } | null>(null);
  const [showErrorDetail, setShowErrorDetail] = useState(false);

  // Retry state — changing this triggers a video reload
  const [retryCount, setRetryCount] = useState(0);

  // ── Captions（CC 字幕轨）──────────────────────────────────────────
  // 原文轨：captionsVtt 转 blob URL。中文轨：非中文字幕时按 cue 批量走
  // /api/translate 生成翻译 VTT（命中服务端缓存时几乎瞬时）。
  const captionsIsChinese = Boolean(
    captionsVtt &&
      (captionsLang ? captionsLang.toLowerCase().startsWith('zh') : looksChinese(captionsVtt)),
  );
  const [originalTrackUrl, setOriginalTrackUrl] = useState<string | null>(null);
  const [translatedTrackUrl, setTranslatedTrackUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!captionsVtt) return;
    const url = URL.createObjectURL(
      new Blob([decodeEntities(captionsVtt)], { type: 'text/vtt' }),
    );
    setOriginalTrackUrl(url);
    return () => {
      URL.revokeObjectURL(url);
      setOriginalTrackUrl(null);
    };
  }, [captionsVtt]);

  useEffect(() => {
    if (!captionsVtt || captionsIsChinese) return;
    let cancelled = false;
    let objectUrl: string | null = null;

    (async () => {
      const cues = parseVttCues(decodeEntities(captionsVtt));
      if (cues.length === 0) return;
      const translated: string[] = [];
      for (let i = 0; i < cues.length; i += TRANSLATE_BATCH_SIZE) {
        const batch = cues.slice(i, i + TRANSLATE_BATCH_SIZE).map((c) => c.text);
        try {
          const res = await fetch('/api/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ texts: batch, target_lang: 'ZH' }),
          });
          if (!res.ok) return; // 未配置 DeepL / 配额用尽 — 只保留原文轨
          const data = await res.json() as { translations?: string[] };
          if (!data.translations) return;
          translated.push(...data.translations);
        } catch {
          return; // 网络失败 — 静默放弃翻译轨
        }
        if (cancelled) return;
      }
      const vtt = buildVtt(cues.map((c, i) => ({ ts: c.ts, text: translated[i] || c.text })));
      objectUrl = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
      if (!cancelled) setTranslatedTrackUrl(objectUrl);
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setTranslatedTrackUrl(null);
    };
  }, [captionsVtt, captionsIsChinese]);

  // 中文翻译轨就绪后自动切换为当前字幕轨
  useEffect(() => {
    if (!translatedTrackUrl) return;
    const player = plyrRef.current;
    if (!player) return;
    try {
      // 翻译轨是 <video> 里的第二条 track（index 1）
      player.currentTrack = 1;
    } catch { /* Plyr 未就绪 — 用户可手动从 CC 菜单选择 */ }
  }, [translatedTrackUrl]);

  // Refs
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dwellTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastStatusRef = useRef<string | null>(null);
  const reloadCountRef = useRef(0); // guard against reload loops

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (showTimerRef.current) {
      clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
  }, []);

  const pollStatus = useCallback(async () => {
    if (!shareToken || !mediaId) return;
    try {
      const res = await fetch(
        `/api/video-status?token=${encodeURIComponent(shareToken)}&mediaId=${encodeURIComponent(mediaId)}`,
      );
      if (!res.ok) return;
      const data: VideoStatusResponse = await res.json();
      setStatusData(data);

      // If backend reports an error, show error UI
      if (data.status === 'error' && !errorInfo) {
        setErrorInfo({
          message: data.label || '视频加载失败',
          detail: data.errorDetail,
        });
        stopPolling();
        return;
      }

      // Reload only when a prior poll saw an in-flight processing state and
      // the backend has now finished (URL refresh, storage upload, etc.).
      // Skip the first poll — an already-ready video would otherwise reload
      // immediately and fight the browser's in-progress buffer.
      const wasProcessing =
        lastStatusRef.current !== null &&
        !['fresh', 'ready'].includes(lastStatusRef.current);
      const becameDone = data.done && wasProcessing && lastStatusRef.current !== data.status;
      if (becameDone && !firstFrameLoaded && reloadCountRef.current < 2) {
        reloadCountRef.current += 1;
        const video = videoRef.current;
        if (video) {
          const nextSrc = data.playbackUrl
            ? data.playbackUrl
            : video.src
              ? `${video.src}${video.src.includes('?') ? '&' : '?'}_t=${Date.now()}`
              : null;
          if (nextSrc) {
            video.src = nextSrc;
            video.load();
          }
        }
      }
      lastStatusRef.current = data.status;
    } catch {
      // Network error — silently ignore, keep showing last state
    }
  }, [shareToken, mediaId, errorInfo, firstFrameLoaded, stopPolling]);

  const startPolling = useCallback(() => {
    if (pollTimerRef.current) return; // already polling
    stopPolling();
    void pollStatus();
    pollTimerRef.current = setInterval(() => void pollStatus(), STATUS_POLL_INTERVAL_MS);
  }, [pollStatus, stopPolling]);

  // Fade out and remove indicator
  const fadeOutIndicator = useCallback(() => {
    setFadingOut(true);
    fadeTimerRef.current = setTimeout(() => {
      setShowIndicator(false);
      setFadingOut(false);
    }, FADE_OUT_MS);
  }, []);

  // Reset indicator when the video source changes
  useEffect(() => {
    setFirstFrameLoaded(false);
    setFirstFrameProgress(0);
    setFadingOut(false);
    setShowIndicator(Boolean(shareToken && mediaId));
    if (dwellTimerRef.current) {
      clearTimeout(dwellTimerRef.current);
      dwellTimerRef.current = null;
    }
    if (fadeTimerRef.current) {
      clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }
  }, [src, retryCount, shareToken, mediaId]);

  // Start polling as soon as the indicator is shown
  useEffect(() => {
    if (firstFrameLoaded || errorInfo) {
      stopPolling();
      return;
    }

    showTimerRef.current = setTimeout(() => {
      if (!firstFrameLoaded && !errorInfo) {
        setShowIndicator(true);
        startPolling();
      }
    }, STATUS_SHOW_DELAY_MS);

    return () => {
      if (showTimerRef.current) clearTimeout(showTimerRef.current);
    };
  }, [src, retryCount, firstFrameLoaded, errorInfo, startPolling, stopPolling]);

  // Native video events to detect ready/error states.
  // Use 'loadeddata' (first frame available for display) instead of 'canplay'
  // so the indicator stays visible until the player actually shows a frame.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onFirstFrame = () => {
      setFirstFrameLoaded(true);
      setFirstFrameProgress(100);
      stopPolling();
      reloadCountRef.current = 0;
      setErrorInfo(null);

      if (dwellTimerRef.current) clearTimeout(dwellTimerRef.current);
      dwellTimerRef.current = setTimeout(() => {
        fadeOutIndicator();
      }, FIRST_FRAME_DWELL_MS);
    };
    const onError = () => {
      if (dwellTimerRef.current) {
        clearTimeout(dwellTimerRef.current);
        dwellTimerRef.current = null;
      }
      setFirstFrameLoaded(false);
      setFadingOut(false);
      setShowIndicator(true);
      startPolling();
    };

    // Event-driven polling: immediately poll on these events for faster feedback
    const onImmediatePoll = () => {
      if (!firstFrameLoaded && !errorInfo && pollTimerRef.current) {
        void pollStatus();
      }
    };

    const onProgress = () => {
      if (firstFrameLoaded) return;
      setFirstFrameProgress(computeFirstFrameProgress(video));
    };

    const onLoadStart = () => {
      setFirstFrameProgress(0);
      onImmediatePoll();
    };

    video.addEventListener('loadeddata', onFirstFrame);
    video.addEventListener('error', onError);
    video.addEventListener('loadstart', onLoadStart);
    video.addEventListener('progress', onProgress);
    video.addEventListener('waiting', onImmediatePoll);
    video.addEventListener('stalled', onImmediatePoll);
    return () => {
      video.removeEventListener('loadeddata', onFirstFrame);
      video.removeEventListener('error', onError);
      video.removeEventListener('loadstart', onLoadStart);
      video.removeEventListener('progress', onProgress);
      video.removeEventListener('waiting', onImmediatePoll);
      video.removeEventListener('stalled', onImmediatePoll);
    };
  }, [src, retryCount, firstFrameLoaded, errorInfo, startPolling, stopPolling, pollStatus, fadeOutIndicator]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopPolling();
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
      if (dwellTimerRef.current) clearTimeout(dwellTimerRef.current);
    };
  }, [stopPolling]);

  // First-frame poster capture for X/Twitter (no separate thumbnail)
  useEffect(() => {
    if (poster) return;
    const video = videoRef.current;
    if (!video) return;

    const captureFirstFrame = () => { video.currentTime = 0; };
    const onSeeked = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 360;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        if (dataUrl && dataUrl !== 'data:,') video.poster = dataUrl;
      } catch { /* cross-origin — ignore */ }
      video.removeEventListener('seeked', onSeeked);
    };

    video.addEventListener('loadedmetadata', captureFirstFrame);
    video.addEventListener('seeked', onSeeked);
    return () => {
      video.removeEventListener('loadedmetadata', captureFirstFrame);
      video.removeEventListener('seeked', onSeeked);
    };
  }, [src, poster]);

  // Plyr initialization
  useEffect(() => {
    if (!videoRef.current) return;
    let plyrInstance: PlyrInstance | null = null;

    import('plyr')
      .then((mod) => {
        const PlyrClass = mod.default;
        plyrInstance = new PlyrClass(videoRef.current!, {
          controls: ['play', 'progress', 'current-time', 'duration', 'mute', 'volume', 'captions', 'fullscreen'],
          hideControls: true,
          // update: true — track 元素是 React 异步渲染的（翻译轨更是后到），
          // 让 Plyr 监听 track 变化而不是只在初始化时读一次。
          captions: { active: true, language: 'zh', update: true },
        });
        plyrRef.current = plyrInstance;
        // 视频行为埋点由 Recorder 在 document 捕获阶段统一采集，
        // 播放器无需自报事件。
      })
      .catch((err) => console.error('Plyr init failed:', err));

    return () => {
      plyrInstance?.destroy();
      plyrRef.current = null;
    };
  }, [src]);

  // Retry handler — reload video with cache-busting
  const handleRetry = useCallback(() => {
    if (dwellTimerRef.current) {
      clearTimeout(dwellTimerRef.current);
      dwellTimerRef.current = null;
    }
    setErrorInfo(null);
    setShowErrorDetail(false);
    setFirstFrameLoaded(false);
    setFadingOut(false);
    setShowIndicator(true);
    setFirstFrameProgress(0);
    lastStatusRef.current = null;
    setStatusData(null);
    setRetryCount((c) => c + 1);
    startPolling();
  }, [startPolling]);

  // Build current effective src with cache-busting for retry
  const effectiveSrc = retryCount > 0
    ? `${src}${src.includes('?') ? '&' : '?'}_r=${retryCount}`
    : src;

  // Compute steps from current status
  const { steps, currentIndex } = statusData
    ? buildSteps(
        statusData.status,
        statusData.hasStorage,
        statusData.storageEnabled,
        Boolean(statusData.storageStale),
        firstFrameLoaded,
      )
    : buildSteps('', false, false, false, firstFrameLoaded);

  const showError = errorInfo !== null;
  const showSteps = showIndicator && !showError;

  /** Get progress for a step: 100/0 for done/pending, 0-100 when measurable, null when indeterminate */
  function getStepProgress(i: number): number | null {
    if (i < currentIndex) return 100;
    if (i > currentIndex) return 0;

    const stepId = steps[i]?.id;
    if (!stepId) return null;

    if (firstFrameLoaded) return 100;

    if (
      BACKEND_PROGRESS_STEPS.has(stepId) &&
      statusData?.progress != null &&
      statusData.progress >= 0
    ) {
      return statusData.progress;
    }
    if (stepId === FIRST_FRAME_PROGRESS_STEP) {
      return firstFrameProgress > 0 ? firstFrameProgress : null;
    }
    return null;
  }

  const stepIndicator = showSteps ? (
    <StepIndicator
      steps={steps}
      currentIndex={currentIndex}
      fadingOut={fadingOut}
      getStepProgress={getStepProgress}
      position={effectiveIndicatorPosition}
    />
  ) : null;

  return (
    <div
      className={`w-full ${effectiveIndicatorPosition === 'below' ? 'flex flex-col' : ''}`}
      data-video-platform={platform}
    >
      {effectiveIndicatorPosition === 'above' && stepIndicator}

      <div
        className={`overflow-hidden bg-black ${
          effectiveIndicatorPosition === 'below' ? 'rounded-t-xl' : 'rounded-xl'
        }`}
      >
        <video
          key={retryCount}
          ref={videoRef}
          src={effectiveSrc}
          poster={poster}
          preload="metadata"
          playsInline
          crossOrigin="anonymous"
          className="block w-full"
          style={{ width: '100%', height: 'auto', maxHeight: '72vh', objectFit: 'contain' }}
        >
          {originalTrackUrl && (
            <track
              kind="captions"
              src={originalTrackUrl}
              srcLang={captionsLang || 'und'}
              label={captionsIsChinese ? '中文' : (captionsLang || '原文')}
              default={captionsIsChinese}
            />
          )}
          {translatedTrackUrl && (
            <track
              kind="captions"
              src={translatedTrackUrl}
              srcLang="zh"
              label="中文（翻译）"
            />
          )}
        </video>
      </div>

      {effectiveIndicatorPosition === 'below' && stepIndicator}

      {/* Error display — below the rounded video container */}
      {showError && (
        <div className="pt-2" role="alert" aria-live="assertive">
          <div className="flex items-center gap-2 text-sm">
            <svg className="h-4 w-4 flex-shrink-0 text-red-500" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M10 6V11M10 14V14.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <circle cx="10" cy="10" r="8.5" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            <span className="text-ink">{errorInfo.message}</span>
          </div>
          <div className="mt-2.5 flex items-center gap-3">
            <button
              onClick={handleRetry}
              className="flex items-center gap-1.5 rounded-md bg-surface-2 px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-surface-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M4 10a6 6 0 016-6 6 6 0 014.5 2M16 10a6 6 0 01-6 6 6 6 0 01-4.5-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <path d="M14.5 3v3.5H11M5.5 17v-3.5H9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              重试
            </button>
            {errorInfo.detail && (
              <button
                onClick={() => setShowErrorDetail((v) => !v)}
                className="text-xs text-muted transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
              >
                技术详情 {showErrorDetail ? '▾' : '▸'}
              </button>
            )}
          </div>
          {showErrorDetail && errorInfo.detail && (
            <pre className="mt-2 rounded bg-surface-2 px-3 py-2 text-[10px] font-mono whitespace-pre-wrap text-muted">
              {errorInfo.detail}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
