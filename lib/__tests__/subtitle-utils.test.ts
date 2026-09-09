// Tests for app/s/[token]/_components/subtitle-utils.ts — VTT parsing and
// entity decoding used by both the transcript card and the in-player captions.

import { describe, it, expect } from 'vitest';
import {
  decodeEntities,
  looksChinese,
  parseVttCues,
  buildVtt,
} from '@/app/s/[token]/_components/subtitle-utils';

describe('decodeEntities', () => {
  it('decodes named and numeric entities', () => {
    expect(decodeEntities('We&#39;re &quot;here&quot; &amp; now &lt;3')).toBe(
      'We\'re "here" & now <3',
    );
    expect(decodeEntities('&#x4e2d;文')).toBe('中文');
  });
});

describe('looksChinese', () => {
  it('detects Chinese text', () => {
    expect(looksChinese('我们对爱情并不陌生，你我都清楚规则')).toBe(true);
  });
  it('rejects English text', () => {
    expect(looksChinese("We're no strangers to love")).toBe(false);
  });
});

describe('parseVttCues / buildVtt', () => {
  const vtt = [
    'WEBVTT',
    '',
    '00:00:01.360 --> 00:00:03.040',
    '[♪♪♪]',
    '',
    '00:00:18.640 --> 00:00:21.880',
    "♪ We're no strangers to love ♪",
    '',
    '00:00:22.640 --> 00:00:26.960',
    '♪ You know the rules',
    'and so do I ♪',
  ].join('\n');

  it('parses cues with timestamps and multi-line text', () => {
    const cues = parseVttCues(vtt);
    expect(cues).toHaveLength(3);
    expect(cues[0].ts).toBe('00:00:01.360 --> 00:00:03.040');
    expect(cues[2].text).toBe('♪ You know the rules\nand so do I ♪');
  });

  it('skips blocks without timestamps (header)', () => {
    const cues = parseVttCues('WEBVTT\n\nnot a cue\n\n00:00:01.000 --> 00:00:02.000\nhi');
    expect(cues).toHaveLength(1);
    expect(cues[0].text).toBe('hi');
  });

  it('round-trips through buildVtt', () => {
    const cues = parseVttCues(vtt);
    const rebuilt = buildVtt(cues);
    expect(parseVttCues(rebuilt)).toEqual(cues);
    expect(rebuilt.startsWith('WEBVTT\n\n')).toBe(true);
  });
});
