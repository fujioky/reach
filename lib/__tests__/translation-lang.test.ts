// Tests for lib/translation/lang.ts — deciding whether a text needs a Chinese translation.

import { describe, it, expect } from 'vitest';
import { countWords, isChineseText, needsZhTranslation, stripNonLanguage } from '@/lib/translation/lang';
import { looksChinese } from '@/app/s/[token]/_components/subtitle-utils';

describe('stripNonLanguage', () => {
  it('removes links, emails, @handles and cashtags', () => {
    const out = stripNonLanguage('@a_b ＠cd 看 https://t.co/x1 www.x.com t.co/abc me@x.io $NVDA $BRK.B');
    expect(out.replace(/\s+/g, ' ').trim()).toBe('看');
  });
});

describe('needsZhTranslation', () => {
  it.each([
    '@elonmusk @abcd_123 同意，这个说得对',
    '@a @b @c 哈哈哈😂😂😂',
    '@someone_with_a_long_name 对',
    '今天 NVIDIA earnings 炸了',
    '这个 feature 真的很好用',
    'OpenAI 发布了 GPT-5',
    '刚看完 $NVDA 财报，data center revenue 超预期 https://t.co/abc123',
    '這個真的太好用了，強烈推薦',
    '#比特币 突破 10 万美元',
    '哈哈 ¯\\_(ツ)_/¯',
  ])('skips Chinese: %s', (text) => {
    expect(needsZhTranslation(text)).toBe(false);
  });

  it.each([
    '@someone Agreed, this is great',
    'Just landed in 北京, the food is amazing',
    'This is a great day 好',
    'これは日本語の文章です',
    '日本語の文章です',
    '오늘 날씨가 좋네요',
  ])('translates non-Chinese: %s', (text) => {
    expect(needsZhTranslation(text)).toBe(true);
  });

  it.each(['', '@abc @def', '😂😂😂', 'https://t.co/abc 2024', '$TSLA 🚀'])(
    'skips text with nothing to translate: %j',
    (text) => {
      expect(needsZhTranslation(text)).toBe(false);
    },
  );
});

describe('countWords', () => {
  it('counts words, not characters', () => {
    expect(countWords('今天 NVIDIA earnings 炸了')).toEqual({ zh: 3, other: 2 });
  });
});

describe('isChineseText / looksChinese', () => {
  it('detects Chinese subtitles despite VTT timestamps', () => {
    const vtt = 'WEBVTT\n\n00:00:01.360 --> 00:00:03.040\n大家好\n\n00:00:03.040 --> 00:00:05.000\n欢迎回来';
    expect(isChineseText(vtt)).toBe(true);
    expect(looksChinese(vtt)).toBe(true);
  });
  it('rejects English subtitles', () => {
    expect(looksChinese('WEBVTT\n\n00:00:01.360 --> 00:00:03.040\nHello everyone')).toBe(false);
  });
});
