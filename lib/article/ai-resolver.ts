// lib/article/ai-resolver.ts
// LLM fallback for pulling a media file out of a page the hand-written rules
// couldn't read.
//
// lib/article/remote-fetch.ts knows the shapes we've actually seen: a <video>,
// an og:video meta tag, a quoted .mp4 in a script. That covers the common
// mirror CDNs and costs nothing, so it stays the first attempt. What it can't
// cover is the long tail — a player that assembles its URL from three
// variables, a base64 blob decoded at runtime, an obfuscated bundle — because
// each of those needs a new regex and the next site invents a new trick.
//
// So when the rules come up empty, the page is handed to a model with one
// question: where is the actual file? Anything it answers is untrusted input
// from a remote page and gets the same treatment as a URL the admin typed —
// assertSafeUrl, then an actual fetch that has to come back as media.
//
// Disabled by default. Reading arbitrary pages into a third-party API is a
// choice the operator makes in 「系统设置」, not something that happens because
// an import failed.

import { getSetting } from '@/lib/settings';

export interface AiParserConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** How much of a page the model gets to see. */
const HTML_BUDGET = 48_000;
/** Kept from the head of the document; the rest comes from the tail. */
const HTML_HEAD_SHARE = 0.72;
/** The model call is a fallback — it may not hold the import open forever. */
const REQUEST_TIMEOUT_MS = 60_000;
/** Candidates past this are ignored even if the model returns more. */
const MAX_CANDIDATES = 4;

/**
 * Read the parser config, or null when it is off / incomplete.
 *
 * The key falls back to an env var so a deployment can carry it without it
 * ever being written to the settings table.
 */
export async function loadAiParserConfig(): Promise<AiParserConfig | null> {
  const [enabled, baseUrl, apiKey, model] = await Promise.all([
    getSetting('ai_parser_enabled'),
    getSetting('ai_parser_base_url'),
    getSetting('ai_parser_api_key'),
    getSetting('ai_parser_model'),
  ]);
  if (enabled !== 'true') return null;

  const key = apiKey.trim() || process.env.AI_PARSER_API_KEY?.trim() || '';
  if (!key || !baseUrl.trim() || !model.trim()) return null;

  return { baseUrl: baseUrl.trim().replace(/\/$/, ''), apiKey: key, model: model.trim() };
}

export interface AiMediaCandidate {
  url: string;
  kind: 'image' | 'video' | 'unknown';
  /** The model's own 0–1 estimate; used only for ordering. */
  confidence: number;
}

export interface AiResolveResult {
  candidates: AiMediaCandidate[];
  /**
   * Set when the page carries no media but forwards somewhere else — a meta
   * refresh, a JS location assignment, an interstitial. The caller decides
   * whether to follow it.
   */
  nextPageUrl: string | null;
  /** One line, in Chinese, shown to the admin when nothing worked. */
  reason: string;
}

export interface AiResolveInput {
  /** What the admin pasted. */
  requestedUrl: string;
  /** Where the redirect chain actually ended. */
  finalUrl: string;
  contentType: string;
  html: string;
  /** Every URL walked through, for the model's context. */
  hops?: string[];
}

const SYSTEM_PROMPT = `你是一个媒体直链提取器。用户粘贴了一个链接，期望得到其中的图片或视频原始文件，但该链接返回的是网页而不是媒体文件。

你的任务：阅读网页 HTML，找出这个页面真正要播放/展示的那一个媒体文件的直链。

规则：
1. 只找页面的主体媒体：正在播放的视频、正文展示的大图。忽略 logo、图标、favicon、广告位、追踪像素、分享缩略图、头像、背景纹理。
2. 播放器常在 JS 里拼接地址（变量拼接、base64、unescape、数组拼装、window.atob）。请把它还原成完整可访问的 URL。
3. 相对地址要用 base 补成绝对地址。JS 里的 \\/ 转义要还原成 /。
4. 页面若只是跳转页（meta refresh、location.href、广告中转、短链落地页），把跳转目标填进 nextPageUrl，candidates 留空数组。
5. 页面若确实没有任何媒体（广告落地页、错误页、验证页、404、付费墙），candidates 和 nextPageUrl 都留空/null，并在 reason 里说清楚它到底是什么页面。
6. 不要编造 URL。宁可返回空，也不要返回猜测出来的、HTML 里并不存在依据的地址。
7. .m3u8 / .mpd 也算候选，但 kind 仍填 video。

只输出 JSON，不要 markdown 代码块，结构：
{
  "candidates": [{"url": "完整绝对URL", "kind": "image|video", "confidence": 0.0-1.0}],
  "nextPageUrl": "完整绝对URL 或 null",
  "reason": "一句中文说明：找到了什么 / 为什么没有"
}
candidates 按可能性从高到低排序，最多 4 个。`;

/**
 * Strip a page down to what's worth spending tokens on.
 *
 * Styles, SVG paths and inline data: URIs are the bulk of a modern page and
 * never contain the answer. Scripts are kept in full — that is precisely where
 * the address lives when there was no attribute to read.
 */
export function condenseHtml(html: string): string {
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<link\b[^>]*>/gi, ' ')
    .replace(/data:[a-z-]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]{80,}/gi, 'data:…base64-elided…')
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();

  if (stripped.length <= HTML_BUDGET) return stripped;

  // Keep both ends: the player markup sits near the top, the script that fills
  // it in is usually appended at the bottom.
  const headLen = Math.floor(HTML_BUDGET * HTML_HEAD_SHARE);
  const tailLen = HTML_BUDGET - headLen;
  return `${stripped.slice(0, headLen)}\n\n…[中间省略 ${stripped.length - HTML_BUDGET} 字符]…\n\n${stripped.slice(-tailLen)}`;
}

/** Pull the JSON object out of a reply that may be wrapped in prose or fences. */
function parseJsonReply(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

/** Collect the assistant text out of a Responses API payload. */
function readResponseText(payload: unknown): string {
  const body = payload as {
    output_text?: unknown;
    output?: Array<{ type?: string; content?: Array<{ type?: string; text?: unknown }> }>;
  };

  if (typeof body.output_text === 'string' && body.output_text.trim()) return body.output_text;

  const parts: string[] = [];
  for (const item of body.output ?? []) {
    // Reasoning items carry a summary, not the answer — skip them.
    if (item.type && item.type !== 'message') continue;
    for (const chunk of item.content ?? []) {
      if (chunk.type === 'output_text' && typeof chunk.text === 'string') parts.push(chunk.text);
    }
  }
  return parts.join('');
}

function absolutize(raw: unknown, base: string): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value || value === 'null') return null;
  try {
    const url = new URL(value, base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Ask the model where the media is.
 *
 * Returns null when the parser is off, the call fails, or the reply is
 * unusable — every one of those means "the rules were the last word", which is
 * exactly the behaviour without this module.
 */
export async function askAiForMedia(
  config: AiParserConfig,
  input: AiResolveInput,
): Promise<AiResolveResult | null> {
  const userPrompt = [
    `用户粘贴的链接：${input.requestedUrl}`,
    input.finalUrl !== input.requestedUrl ? `跳转后的最终地址：${input.finalUrl}` : null,
    input.hops && input.hops.length > 1 ? `跳转链：${input.hops.join(' → ')}` : null,
    `服务器返回的 Content-Type：${input.contentType || '（未提供）'}`,
    `补全相对地址时使用的 base：${input.finalUrl}`,
    '',
    '页面 HTML：',
    condenseHtml(input.html),
  ]
    .filter((line) => line !== null)
    .join('\n');

  let payload: unknown;
  try {
    const res = await fetch(`${config.baseUrl}/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        input: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        text: { format: { type: 'json_object' } },
        // Extraction is pattern recognition over text that is already in the
        // prompt, not a reasoning problem — and the admin is watching a
        // progress bar while this runs.
        thinking: { type: 'disabled' },
        max_output_tokens: 2048,
        stream: false,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`AI ${res.status}: ${detail.slice(0, 200)}`);
    }
    payload = await res.json();
  } catch (err) {
    console.error('[ai-resolver] request failed:', (err as Error).message);
    return null;
  }

  const parsed = parseJsonReply(readResponseText(payload));
  if (!parsed || typeof parsed !== 'object') return null;

  const body = parsed as {
    candidates?: unknown;
    nextPageUrl?: unknown;
    reason?: unknown;
  };

  const candidates: AiMediaCandidate[] = [];
  if (Array.isArray(body.candidates)) {
    for (const entry of body.candidates) {
      const item = entry as { url?: unknown; kind?: unknown; confidence?: unknown };
      const url = absolutize(item.url, input.finalUrl);
      if (!url) continue;
      if (candidates.some((existing) => existing.url === url)) continue;
      candidates.push({
        url,
        kind: item.kind === 'image' || item.kind === 'video' ? item.kind : 'unknown',
        confidence: typeof item.confidence === 'number' ? item.confidence : 0.5,
      });
      if (candidates.length >= MAX_CANDIDATES) break;
    }
  }

  const nextPageUrl = absolutize(body.nextPageUrl, input.finalUrl);

  return {
    candidates,
    // A "next page" that is the page we're already on is a loop, not a hop.
    nextPageUrl: nextPageUrl && nextPageUrl !== input.finalUrl ? nextPageUrl : null,
    reason: typeof body.reason === 'string' ? body.reason.slice(0, 300) : '',
  };
}

/** Probe used by the settings page to confirm the endpoint answers. */
export async function probeAiParser(
  config: AiParserConfig,
): Promise<{ ok: boolean; latencyMs: number; status?: number; error?: string }> {
  const t0 = Date.now();
  try {
    const res = await fetch(`${config.baseUrl}/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        input: '只回复 ok 两个字符。',
        max_output_tokens: 512,
        thinking: { type: 'disabled' },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const latencyMs = Date.now() - t0;
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { ok: false, latencyMs, status: res.status, error: `${res.status}: ${detail.slice(0, 160)}` };
    }
    await res.json().catch(() => null);
    return { ok: true, latencyMs, status: res.status };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - t0, error: (err as Error).message };
  }
}
