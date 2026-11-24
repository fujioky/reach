// app/s/[token]/_components/subtitle-utils.ts
// 字幕共享工具 — TranscriptSection（文字卡片）与 VideoPlayer（CC 轨道）共用。

import { isChineseText } from '@/lib/translation/lang';

export interface VttCue {
  /** "00:00:01.360 --> 00:00:03.040" */
  ts: string;
  /** cue 文本（多行以 \n 连接） */
  text: string;
}

/** 解码 reach-upstream 字幕文本里的 HTML 实体（&#39; &amp; 等）。 */
export function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * 字幕是不是中文（用于旧数据没有 transcriptLang 的情况）。
 * 与正文翻译用同一套判断，时间轴的数字和标点不计入。
 */
export const looksChinese = isChineseText;

/**
 * 解析 proxy 规范化后的 WEBVTT（时间轴行 + 文本行，空行分隔 cue）。
 * 对非规范输入尽量容错：没有时间轴的块会被跳过。
 */
export function parseVttCues(vtt: string): VttCue[] {
  const cues: VttCue[] = [];
  for (const block of vtt.split(/\n{2,}/)) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    const tsIndex = lines.findIndex((l) => l.includes('-->'));
    if (tsIndex === -1) continue;
    const text = lines.slice(tsIndex + 1).join('\n');
    if (!text) continue;
    cues.push({ ts: lines[tsIndex], text });
  }
  return cues;
}

/** 由 cue 列表重新拼装 WEBVTT。 */
export function buildVtt(cues: VttCue[]): string {
  return 'WEBVTT\n\n' + cues.map((c) => `${c.ts}\n${c.text}`).join('\n\n');
}
