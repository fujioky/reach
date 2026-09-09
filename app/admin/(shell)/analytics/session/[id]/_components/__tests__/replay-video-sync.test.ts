import { describe, it, expect, vi } from 'vitest';
import {
  buildMediaTimelines,
  expectedStateAt,
  createReplayVideoSync,
  type TimelineEvent,
  type VideoAction,
} from '../replay-video-sync';

const T0 = 1_786_621_380_000; // 任意基准时刻（客户端时钟毫秒）
const MEDIA = 'd635bb4a-579e-48a9-8ab2-40903f5266fd.mp4';

function ev(offsetMs: number, payload: Record<string, unknown>): TimelineEvent {
  return { type: 'video', ts: new Date(T0 + offsetMs).toISOString(), payload };
}

describe('buildMediaTimelines', () => {
  it('collects play/pause/seek/ended/ratechange per media, sorted by time', () => {
    const timelines = buildMediaTimelines([
      { type: 'view', ts: new Date(T0).toISOString(), payload: null },
      ev(3_000, { action: 'play', mediaId: MEDIA, position: 0 }),
      ev(1_000, { action: 'seek', mediaId: MEDIA, from: 0, to: 644.6 }),
      ev(5_000, { action: 'pause', mediaId: MEDIA, position: 646.6 }),
      ev(4_000, { action: 'progress', mediaId: MEDIA, pct: 80, position: 645.6 }), // 忽略
      ev(2_000, { action: 'play', mediaId: 'other.mp4', position: 9 }),
    ]);
    expect([...timelines.keys()].sort()).toEqual([MEDIA, 'other.mp4'].sort());
    expect(timelines.get(MEDIA)!.map((a) => a.action)).toEqual(['seek', 'play', 'pause']);
  });

  it('drops malformed entries', () => {
    const timelines = buildMediaTimelines([
      ev(0, { action: 'play' }), // 无 mediaId
      ev(0, { action: 'play', mediaId: MEDIA }), // 无 position
      { type: 'video', ts: 'not-a-date', payload: { action: 'play', mediaId: MEDIA, position: 1 } },
    ]);
    expect(timelines.size).toBe(0);
  });
});

describe('expectedStateAt', () => {
  const actions: VideoAction[] = [
    { atMs: T0 + 3_000, action: 'play', position: 0 },
    { atMs: T0 + 5_000, action: 'seek', position: 644.6 },
    { atMs: T0 + 9_000, action: 'pause', position: 648.6 },
  ];

  it('is null before the first recorded action (leave snapshot state alone)', () => {
    expect(expectedStateAt(actions, T0 + 2_999)).toBeNull();
  });

  it('extrapolates position while playing', () => {
    const s = expectedStateAt(actions, T0 + 4_000)!;
    expect(s.playing).toBe(true);
    expect(s.position).toBeCloseTo(1, 5);
  });

  it('jumps on seek and keeps playing from the seek target', () => {
    const s = expectedStateAt(actions, T0 + 7_000)!;
    expect(s.playing).toBe(true);
    expect(s.position).toBeCloseTo(646.6, 5);
  });

  it('freezes at the recorded position after pause', () => {
    const s = expectedStateAt(actions, T0 + 60_000)!;
    expect(s.playing).toBe(false);
    expect(s.position).toBeCloseTo(648.6, 5);
  });

  it('applies ratechange to extrapolation', () => {
    const withRate: VideoAction[] = [
      { atMs: T0, action: 'play', position: 10 },
      { atMs: T0 + 2_000, action: 'ratechange', position: 12, rate: 2 },
    ];
    const s = expectedStateAt(withRate, T0 + 4_000)!;
    // 前 2s 1x（10→12），后 2s 2x（12→16）
    expect(s.position).toBeCloseTo(16, 5);
    expect(s.rate).toBe(2);
  });
});

interface FakeVideo {
  currentTime: number;
  paused: boolean;
  seeking: boolean;
  ended: boolean;
  playbackRate: number;
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  closest: () => null;
}

function fakeVideo(init?: Partial<FakeVideo>): FakeVideo {
  const v: FakeVideo = {
    currentTime: 0,
    paused: true,
    seeking: false,
    ended: false,
    playbackRate: 1,
    play: vi.fn(() => {
      v.paused = false;
      return Promise.resolve();
    }),
    pause: vi.fn(() => {
      v.paused = true;
    }),
    closest: () => null,
    ...init,
  };
  return v;
}

function makeSync(video: FakeVideo, actions: VideoAction[], speed = 1) {
  return createReplayVideoSync({
    timelines: new Map([[MEDIA, actions]]),
    getVideos: () => [video as unknown as HTMLVideoElement],
    getSpeed: () => speed,
    resolveMediaId: () => MEDIA,
  });
}

describe('createReplayVideoSync', () => {
  const actions: VideoAction[] = [{ atMs: T0 + 3_000, action: 'play', position: 644.6 }];

  it('seeks and plays when the replay lands mid-span (admin scrubbed the replay)', () => {
    const video = fakeVideo();
    const sync = makeSync(video, actions);
    sync.setPlayerPlaying(true);
    sync.reconcile(T0 + 10_000); // 访客已从 644.6 播了 7 秒
    expect(video.currentTime).toBeCloseTo(651.6, 5);
    expect(video.play).toHaveBeenCalled();
  });

  it('does not touch a video within tolerance', () => {
    const video = fakeVideo({ currentTime: 651.0, paused: false });
    const sync = makeSync(video, actions);
    sync.setPlayerPlaying(true);
    sync.reconcile(T0 + 10_000);
    expect(video.currentTime).toBe(651.0); // 0.6s 偏差 < 2s 容差
    expect(video.play).not.toHaveBeenCalled();
  });

  it('leaves videos alone before their first recorded action', () => {
    const video = fakeVideo();
    const sync = makeSync(video, actions);
    sync.setPlayerPlaying(true);
    sync.reconcile(T0 + 1_000);
    expect(video.currentTime).toBe(0);
    expect(video.play).not.toHaveBeenCalled();
    expect(video.pause).not.toHaveBeenCalled();
  });

  it('pauses videos while the replayer is paused, resumes on play', () => {
    const video = fakeVideo({ paused: false });
    const sync = makeSync(video, actions);
    sync.reconcile(T0 + 10_000);
    sync.setPlayerPlaying(false);
    expect(video.pause).toHaveBeenCalled();
    sync.setPlayerPlaying(true);
    expect(video.play).toHaveBeenCalled();
  });

  it('scales playbackRate by replay speed', () => {
    const video = fakeVideo({ paused: false, currentTime: 651.6 });
    const sync = makeSync(video, actions, 2);
    sync.setPlayerPlaying(true);
    sync.reconcile(T0 + 10_000);
    expect(video.playbackRate).toBe(2);
  });

  it('never seeks while the video is already seeking', () => {
    const video = fakeVideo({ seeking: true, currentTime: 0 });
    const sync = makeSync(video, actions);
    sync.setPlayerPlaying(true);
    sync.reconcile(T0 + 10_000);
    expect(video.currentTime).toBe(0);
  });
});
