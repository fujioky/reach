import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  videoNeedsBuffer,
  videoHasFrame,
  syncPlyrSeekBar,
  createReplayMediaGate,
} from '../replay-media-gate';

function timeRanges(ranges: [number, number][]): TimeRanges {
  return {
    length: ranges.length,
    start: (i: number) => ranges[i][0],
    end: (i: number) => ranges[i][1],
  } as TimeRanges;
}

function mockVideo(init: {
  readyState?: number;
  paused?: boolean;
  seeking?: boolean;
  ended?: boolean;
  duration?: number;
  currentTime?: number;
  buffered?: [number, number][];
  seekInputs?: HTMLInputElement[];
}): HTMLVideoElement {
  const listeners = new Map<string, Set<EventListener>>();
  const seekInputs = init.seekInputs ?? [];
  const video = {
    readyState: init.readyState ?? 0,
    paused: init.paused ?? true,
    seeking: init.seeking ?? false,
    ended: init.ended ?? false,
    duration: init.duration ?? Number.NaN,
    currentTime: init.currentTime ?? 0,
    buffered: timeRanges(init.buffered ?? []),
    addEventListener(type: string, fn: EventListener) {
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      set.add(fn);
    },
    removeEventListener(type: string, fn: EventListener) {
      listeners.get(type)?.delete(fn);
    },
    dispatchEvent(ev: Event) {
      listeners.get(ev.type)?.forEach((fn) => fn(ev));
      return true;
    },
    closest() {
      return {
        querySelectorAll: () => seekInputs,
      };
    },
    parentElement: null,
  };
  return video as unknown as HTMLVideoElement;
}

describe('videoNeedsBuffer', () => {
  it('is true when playing without current data', () => {
    expect(videoNeedsBuffer(mockVideo({ paused: false, readyState: 0 }))).toBe(true);
  });

  it('is false when paused and not seeking', () => {
    expect(videoNeedsBuffer(mockVideo({ paused: true, readyState: 0 }))).toBe(false);
  });

  it('is false once a current frame is available', () => {
    expect(videoNeedsBuffer(mockVideo({ paused: false, readyState: 2 }))).toBe(false);
  });

  it('is false when currentTime sits inside a buffered range (rrweb re-seek)', () => {
    const video = mockVideo({
      paused: false,
      seeking: true,
      readyState: 1,
      currentTime: 5,
      buffered: [[0, 10]],
    });
    expect(videoNeedsBuffer(video)).toBe(false);
  });
});

describe('videoHasFrame', () => {
  it('is false while a held video is replayer-paused without data', () => {
    expect(videoHasFrame(mockVideo({ paused: true, readyState: 1 }))).toBe(false);
  });

  it('is true with a decodable frame, buffered data, or ended', () => {
    expect(videoHasFrame(mockVideo({ readyState: 2 }))).toBe(true);
    expect(videoHasFrame(mockVideo({ readyState: 1, currentTime: 3, buffered: [[0, 10]] }))).toBe(true);
    expect(videoHasFrame(mockVideo({ ended: true }))).toBe(true);
  });
});

describe('syncPlyrSeekBar', () => {
  it('leaves the range alone when duration is unknown', () => {
    const range = { value: '50', style: { setProperty: vi.fn() } } as unknown as HTMLInputElement;
    const video = mockVideo({ duration: Number.NaN, currentTime: 10, seekInputs: [range] });
    syncPlyrSeekBar(video);
    expect(range.value).toBe('50');
    expect(range.style.setProperty).not.toHaveBeenCalled();
  });

  it('writes percent from currentTime / duration', () => {
    const range = { value: '0', style: { setProperty: vi.fn() } } as unknown as HTMLInputElement;
    const video = mockVideo({ duration: 100, currentTime: 25, seekInputs: [range] });
    syncPlyrSeekBar(video);
    expect(range.value).toBe('25');
    expect(range.style.setProperty).toHaveBeenCalledWith('--value', '25%');
  });

  it('takes over the range so rrweb replay writes are no-ops (no thumb flicker)', () => {
    class FakeInput {
      _v = '0';
      style = { setProperty: vi.fn() };
    }
    Object.defineProperty(FakeInput.prototype, 'value', {
      configurable: true,
      get(this: FakeInput) {
        return this._v;
      },
      set(this: FakeInput, v: string) {
        this._v = v;
      },
    });
    const range = new FakeInput() as unknown as HTMLInputElement;
    const video = mockVideo({ duration: 100, currentTime: 25, seekInputs: [range] });

    syncPlyrSeekBar(video);
    expect(range.value).toBe('25');

    range.value = ''; // rrweb 重放录制页的 input 写入（脱敏后为空串 → 50% 中点）
    expect(range.value).toBe('25'); // 被 no-op，进度点不再闪烁

    Object.assign(video, { currentTime: 50 });
    syncPlyrSeekBar(video);
    expect(range.value).toBe('50'); // 我们持有的原生 setter 仍可写
  });
});

describe('createReplayMediaGate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('pauses the session clock while a playing video has no data, then resumes', () => {
    const player = { pause: vi.fn(), play: vi.fn() };
    const gate = createReplayMediaGate({ player, isUserPaused: () => false, timeoutMs: 12_000 });
    const video = mockVideo({ paused: false, readyState: 0 });
    gate.watch(video);
    expect(player.pause).toHaveBeenCalledTimes(1);

    Object.assign(video, { readyState: 2 });
    video.dispatchEvent(new Event('canplay'));
    expect(player.play).toHaveBeenCalledTimes(1);
  });

  it('keeps holding while the replayer pauses the video (no frame yet) — no ping-pong', () => {
    const player = { pause: vi.fn(), play: vi.fn() };
    const gate = createReplayMediaGate({ player, isUserPaused: () => false, timeoutMs: 12_000 });
    const video = mockVideo({ paused: false, readyState: 0 });
    gate.watch(video);
    expect(player.pause).toHaveBeenCalledTimes(1);

    // Gate paused the replayer → rrweb pauses + re-seeks the video. Still no
    // decodable frame: the old release-on-paused logic would resume here and
    // oscillate pause/play forever.
    Object.assign(video, { paused: true, seeking: false, readyState: 1 });
    video.dispatchEvent(new Event('seeked'));
    expect(player.play).not.toHaveBeenCalled();

    Object.assign(video, { readyState: 2 });
    video.dispatchEvent(new Event('canplay'));
    expect(player.play).toHaveBeenCalledTimes(1);
  });

  it('ignores rrweb re-seeks into buffered data after resume', () => {
    const player = { pause: vi.fn(), play: vi.fn() };
    const gate = createReplayMediaGate({ player, isUserPaused: () => false, timeoutMs: 12_000 });
    const video = mockVideo({
      paused: false,
      seeking: true,
      readyState: 1,
      currentTime: 4,
      buffered: [[0, 10]],
    });
    gate.watch(video);
    video.dispatchEvent(new Event('seeking'));
    expect(player.pause).not.toHaveBeenCalled();
  });

  it('does not auto-resume if the user paused', () => {
    const player = { pause: vi.fn(), play: vi.fn() };
    const gate = createReplayMediaGate({ player, isUserPaused: () => true, timeoutMs: 12_000 });
    const video = mockVideo({ paused: false, readyState: 0 });
    gate.watch(video);
    Object.assign(video, { readyState: 2 });
    video.dispatchEvent(new Event('canplay'));
    expect(player.play).not.toHaveBeenCalled();
  });

  it('blocks on timeout and stays paused until continueAnyway', () => {
    const player = { pause: vi.fn(), play: vi.fn() };
    const onBlocked = vi.fn();
    const gate = createReplayMediaGate({
      player,
      isUserPaused: () => false,
      onBlocked,
      timeoutMs: 12_000,
    });
    const video = mockVideo({ paused: false, readyState: 0 });
    gate.watch(video);
    vi.advanceTimersByTime(12_000);
    expect(onBlocked).toHaveBeenCalledTimes(1);
    expect(player.play).not.toHaveBeenCalled();

    gate.continueAnyway();
    expect(player.play).toHaveBeenCalledTimes(1);
  });
});
