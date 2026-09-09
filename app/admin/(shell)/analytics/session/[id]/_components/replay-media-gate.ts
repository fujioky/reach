// Replay-time gate: pause the rrweb session clock while an in-page <video>
// is supposed to be playing but has no current frame yet. Also keeps Plyr's
// seek thumb in sync with video.currentTime (Plyr JS does not run in replay).

const HAVE_CURRENT_DATA = 2;
export const REPLAY_MEDIA_WAIT_MS = 12_000;

export interface ReplayMediaPlayer {
  pause: () => void;
  play: () => void;
}

export interface ReplayMediaGate {
  watch(video: HTMLVideoElement): void;
  continueAnyway(): void;
  dispose(): void;
}

type BufferableVideo = Pick<
  HTMLVideoElement,
  'ended' | 'paused' | 'seeking' | 'readyState' | 'buffered' | 'currentTime'
>;

function isBufferedAtCurrentTime(video: BufferableVideo): boolean {
  const { buffered, currentTime } = video;
  for (let i = 0; i < buffered.length; i++) {
    if (buffered.start(i) <= currentTime && currentTime < buffered.end(i)) return true;
  }
  return false;
}

export function videoNeedsBuffer(video: BufferableVideo): boolean {
  if (video.ended) return false;
  if (video.readyState >= HAVE_CURRENT_DATA) return false;
  // rrweb's MediaManager re-seeks every <video> on each replayer play/pause.
  // A re-seek into already-buffered data resolves immediately — pausing the
  // replay for it would ping-pong pause/play forever.
  if (isBufferedAtCurrentTime(video)) return false;
  return !video.paused || video.seeking;
}

/**
 * Held videos are paused BY the replayer (rrweb pauses all media when we pause
 * the session clock), so "paused" must not count as recovered — only an
 * actually displayable frame does.
 */
export function videoHasFrame(video: BufferableVideo): boolean {
  return video.ended || video.readyState >= HAVE_CURRENT_DATA || isBufferedAtCurrentTime(video);
}

// 回放中 rrweb 会持续重放录制页 Plyr 对进度条 input 的 value 写入（开着
// maskAllInputs 的老录制里值被脱敏成空串 → range 落回 50% 中点），与我们的
// 同步互相覆盖造成进度点闪烁。所以第一次接管某个 range 时就把它实例级的
// value setter 覆写为 no-op —— rrweb 的写入从此失效，只有我们持有的原生
// setter 能写。
const rangeWriters = new WeakMap<HTMLInputElement, (value: string) => void>();

function rangeWriter(range: HTMLInputElement): (value: string) => void {
  let writer = rangeWriters.get(range);
  if (writer) return writer;

  let desc: PropertyDescriptor | undefined;
  let proto: object | null = Object.getPrototypeOf(range);
  while (proto && !desc) {
    desc = Object.getOwnPropertyDescriptor(proto, 'value');
    proto = Object.getPrototypeOf(proto);
  }
  if (desc?.set && desc.get) {
    const nativeSet = desc.set;
    Object.defineProperty(range, 'value', {
      configurable: true,
      get: desc.get,
      set: () => {},
    });
    writer = (value) => nativeSet.call(range, value);
  } else {
    // 测试替身等没有原型 setter 的对象：直接赋值
    writer = (value) => {
      (range as { value: string }).value = value;
    };
  }
  rangeWriters.set(range, writer);
  return writer;
}

/** Drive Plyr's range thumb from the video clock. Skip when duration is unknown (browser default = 50%). */
export function syncPlyrSeekBar(video: HTMLVideoElement): void {
  const duration = video.duration;
  if (!Number.isFinite(duration) || duration <= 0) return;
  const root = video.closest('.plyr') ?? video.parentElement;
  if (!root) return;
  const pct = Math.min(100, Math.max(0, (video.currentTime / duration) * 100));
  root.querySelectorAll<HTMLInputElement>('[data-plyr="seek"]').forEach((range) => {
    rangeWriter(range)(String(pct));
    range.style.setProperty('--value', `${pct}%`);
  });
}

export function createReplayMediaGate(opts: {
  player: ReplayMediaPlayer;
  isUserPaused: () => boolean;
  onWaitingChange?: (waiting: boolean) => void;
  onBlocked?: () => void;
  timeoutMs?: number;
}): ReplayMediaGate {
  const timeoutMs = opts.timeoutMs ?? REPLAY_MEDIA_WAIT_MS;
  const held = new Set<HTMLVideoElement>();
  const abandoned = new WeakSet<HTMLVideoElement>();
  const cleanups = new Map<HTMLVideoElement, () => void>();
  const timers = new Map<HTMLVideoElement, ReturnType<typeof setTimeout>>();
  let disposed = false;

  const emitWaiting = () => opts.onWaitingChange?.(held.size > 0);

  const acquire = (video: HTMLVideoElement) => {
    if (abandoned.has(video) || held.has(video)) return;
    const first = held.size === 0;
    held.add(video);
    if (first) {
      opts.player.pause();
      emitWaiting();
    }
    const existing = timers.get(video);
    if (existing != null) clearTimeout(existing);
    timers.set(
      video,
      setTimeout(() => block(video), timeoutMs),
    );
  };

  const release = (video: HTMLVideoElement, resume: boolean) => {
    const timer = timers.get(video);
    if (timer != null) {
      clearTimeout(timer);
      timers.delete(video);
    }
    if (!held.has(video)) return;
    held.delete(video);
    if (held.size === 0) {
      emitWaiting();
      if (resume && !opts.isUserPaused()) opts.player.play();
    }
  };

  const block = (video: HTMLVideoElement) => {
    if (abandoned.has(video)) return;
    abandoned.add(video);
    release(video, false);
    opts.onBlocked?.();
  };

  const evaluate = (video: HTMLVideoElement) => {
    if (disposed || abandoned.has(video)) return;
    syncPlyrSeekBar(video);
    if (held.has(video)) {
      if (videoHasFrame(video)) release(video, true);
    } else if (videoNeedsBuffer(video)) {
      acquire(video);
    }
  };

  return {
    watch(video) {
      if (disposed || cleanups.has(video)) return;
      const onEval = () => evaluate(video);
      const onError = () => block(video);
      const events = ['waiting', 'stalled', 'seeking', 'seeked', 'play', 'playing', 'canplay', 'canplaythrough', 'timeupdate', 'loadedmetadata', 'loadeddata', 'progress'] as const;
      for (const ev of events) video.addEventListener(ev, onEval);
      video.addEventListener('error', onError);
      cleanups.set(video, () => {
        for (const ev of events) video.removeEventListener(ev, onEval);
        video.removeEventListener('error', onError);
      });
      evaluate(video);
    },

    continueAnyway() {
      for (const video of [...held]) {
        abandoned.add(video);
        release(video, false);
      }
      if (!opts.isUserPaused()) opts.player.play();
    },

    dispose() {
      disposed = true;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      for (const stop of cleanups.values()) stop();
      cleanups.clear();
      held.clear();
    },
  };
}

export function attachIframeMediaGate(
  iframe: HTMLIFrameElement,
  gate: ReplayMediaGate,
): () => void {
  let mo: MutationObserver | null = null;
  let cancelled = false;
  const seen = new WeakSet<HTMLVideoElement>();

  const scan = (doc: Document) => {
    doc.querySelectorAll('video').forEach((video) => {
      if (seen.has(video)) return;
      seen.add(video);
      gate.watch(video);
    });
  };

  const attach = () => {
    if (cancelled) return;
    const doc = iframe.contentDocument;
    if (!doc) {
      requestAnimationFrame(attach);
      return;
    }
    mo?.disconnect();
    scan(doc);
    mo = new MutationObserver(() => scan(doc));
    mo.observe(doc, { childList: true, subtree: true });
  };

  attach();
  iframe.addEventListener('load', attach);
  return () => {
    cancelled = true;
    mo?.disconnect();
    iframe.removeEventListener('load', attach);
    gate.dispose();
  };
}
