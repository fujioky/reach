// Deterministic video sync for session replay.
//
// rrweb 自带的 MediaManager 有两个致命短板：
//   1. 管理员拖动回放进度时，快进阶段的媒体事件应用在虚拟 DOM 上，重建后的
//      真实 <video> 掉回快照初始态（paused@0），要等到下一条录制的媒体事件
//      才会被再次同步 —— 表现为"跳进度后视频不跟"。
//   2. 它只在录制的媒体事件时刻做一次性 seek/play，中途任何失败都不重试。
//
// 这里改为以我们自己录的结构化视频事件（visit_events type='video'，每条带
// 精确 position 和客户端时间戳，与 rrweb 事件同一时钟）为唯一事实来源：
// 回放每帧计算「此刻该视频应处于什么位置、是否在播」，偏差超过容差就把真实
// <video> 校正过去。MediaManager 做对了我们不动（在容差内），做错了下一帧
// 就被纠正。进度条思路相同：每帧钉住，杜绝与 rrweb 回放写入互相闪烁。

import { syncPlyrSeekBar } from './replay-media-gate';

/** 允许的位置偏差（秒）。小于它不干预，避免与 rrweb 的同步互相拉扯。 */
export const SYNC_TOLERANCE_S = 2;

export interface TimelineEvent {
  type: string;
  ts: string | Date;
  payload: unknown;
}

export interface VideoAction {
  atMs: number;
  action: 'play' | 'pause' | 'seek' | 'ended' | 'ratechange';
  position: number;
  rate?: number;
}

const SYNC_ACTIONS = new Set(['play', 'pause', 'seek', 'ended', 'ratechange']);

/** 与录制端 Recorder.mediaIdFor 相同的规则：data-media-id 优先，否则取 URL 末段文件名。 */
export function mediaIdForVideo(video: HTMLVideoElement): string {
  const tagged = video.closest('[data-media-id]');
  if (tagged) return tagged.getAttribute('data-media-id') ?? 'video';
  try {
    const src = video.currentSrc || video.src || '';
    return src
      ? new URL(src, 'https://replay.invalid').pathname.split('/').pop() ?? 'video'
      : 'video';
  } catch {
    return 'video';
  }
}

/** 把会话时间线中的 video 事件整理为 mediaId → 按时间排序的动作序列。 */
export function buildMediaTimelines(timeline: TimelineEvent[]): Map<string, VideoAction[]> {
  const map = new Map<string, VideoAction[]>();
  for (const e of timeline) {
    if (e.type !== 'video') continue;
    const p = e.payload as {
      action?: string;
      mediaId?: string;
      position?: number;
      to?: number;
      rate?: number;
    } | null;
    if (!p?.action || !p.mediaId || !SYNC_ACTIONS.has(p.action)) continue;
    const atMs = new Date(e.ts).getTime();
    // seek 事件的落点在 to；其余动作 position 即当时的播放位置
    const position = p.action === 'seek' ? p.to : p.position;
    if (!Number.isFinite(atMs) || typeof position !== 'number') continue;
    let actions = map.get(p.mediaId);
    if (!actions) map.set(p.mediaId, (actions = []));
    actions.push({ atMs, action: p.action as VideoAction['action'], position, rate: p.rate });
  }
  for (const actions of map.values()) actions.sort((a, b) => a.atMs - b.atMs);
  return map;
}

export interface ExpectedState {
  playing: boolean;
  position: number;
  /** 访客当时的播放倍速。 */
  rate: number;
}

/**
 * 回放绝对时刻 absMs（客户端时钟毫秒）时，该视频应处的状态。
 * 首个动作之前返回 null —— 不干预，让视频保持快照初始态。
 *
 * 每条动作都自带录制时的真实 position，所以只需从最后一条动作向后外推，
 * 不存在累计漂移。
 */
export function expectedStateAt(actions: VideoAction[], absMs: number): ExpectedState | null {
  let playing = false;
  let position = 0;
  let rate = 1;
  let lastTs = 0;
  let seen = false;

  for (const a of actions) {
    if (a.atMs > absMs) break;
    seen = true;
    switch (a.action) {
      case 'play':
        playing = true;
        position = a.position;
        lastTs = a.atMs;
        break;
      case 'pause':
      case 'ended':
        playing = false;
        position = a.position;
        lastTs = a.atMs;
        break;
      case 'seek':
        // 播放状态不变，位置跳到落点
        position = a.position;
        lastTs = a.atMs;
        break;
      case 'ratechange':
        if (playing) {
          position += ((a.atMs - lastTs) / 1000) * rate;
          lastTs = a.atMs;
        }
        rate = a.rate ?? 1;
        break;
    }
  }

  if (!seen) return null;
  if (playing) position += ((absMs - lastTs) / 1000) * rate;
  return { playing, position: Math.max(0, position), rate };
}

/** Chrome 支持的 playbackRate 上限。 */
const MAX_PLAYBACK_RATE = 16;

export interface ReplayVideoSync {
  /** 回放时钟走到 absMs（客户端时钟毫秒）时调用；每帧调用是预期用法。 */
  reconcile(absMs?: number): void;
  /** 回放器整体播放/暂停状态变化时调用（含门控暂停）。 */
  setPlayerPlaying(playing: boolean): void;
}

export function createReplayVideoSync(opts: {
  timelines: Map<string, VideoAction[]>;
  getVideos: () => Iterable<HTMLVideoElement>;
  /** 回放器当前倍速（rrweb-player 速度控件），视频 playbackRate 随之缩放。 */
  getSpeed?: () => number;
  /** 测试注入用；默认按 Recorder 同款规则解析。 */
  resolveMediaId?: (video: HTMLVideoElement) => string;
  toleranceS?: number;
}): ReplayVideoSync {
  const resolve = opts.resolveMediaId ?? mediaIdForVideo;
  const tolerance = opts.toleranceS ?? SYNC_TOLERANCE_S;
  const idCache = new WeakMap<HTMLVideoElement, string>();
  let playerPlaying = false;
  let lastAbsMs: number | null = null;

  const reconcile = (absMs?: number) => {
    if (absMs != null) lastAbsMs = absMs;
    if (lastAbsMs == null) return;
    for (const video of opts.getVideos()) {
      let id = idCache.get(video);
      if (id === undefined) {
        id = resolve(video);
        idCache.set(video, id);
      }
      const actions = opts.timelines.get(id);
      if (!actions) continue;
      const state = expectedStateAt(actions, lastAbsMs);
      if (!state) continue;

      if (!video.seeking && Math.abs(video.currentTime - state.position) > tolerance) {
        video.currentTime = state.position;
      }
      // 视频速度 = 访客倍速 × 回放倍速，位置才能持续贴合而不是靠 seek 追赶
      const targetRate = Math.min(MAX_PLAYBACK_RATE, state.rate * (opts.getSpeed?.() ?? 1));
      if (video.playbackRate !== targetRate) video.playbackRate = targetRate;
      const shouldPlay = state.playing && playerPlaying;
      if (shouldPlay && video.paused && !video.ended) {
        // 播放失败（如自动播放策略）不致命：下一帧还会重试
        video.play()?.catch?.(() => {});
      } else if (!shouldPlay && !video.paused) {
        video.pause();
      }
      // 进度条每帧钉在视频真实进度上 —— rrweb 回放的 input 写入或节点重建
      // 把它弄歪（如空 value 落回 50% 中点），下一帧即被纠正
      syncPlyrSeekBar(video);
    }
  };

  return {
    reconcile,
    setPlayerPlaying(playing: boolean) {
      playerPlaying = playing;
      reconcile();
    },
  };
}
