// lib/article/remote-fetch.ts
// Safety layer for importing media from an arbitrary remote URL.
//
// Every other server-side fetch in this codebase aims at a URL the app itself
// produced (agent-reach results) or at a platform whitelist (mirror creation).
// Remote import is different by design: the whole point is that the admin can
// paste any image or video URL. That makes this the one place where a
// user-supplied host reaches the server's network stack, so it needs real SSRF
// containment rather than a whitelist.
//
// What's enforced:
//   - http/https only — no file:, gopher:, data:, ftp:
//   - the hostname must resolve entirely to public addresses
//   - redirects are followed manually, re-validating every hop
//   - bounded redirects, connect timeout, and a byte ceiling
//
// What is deliberately not solved: DNS rebinding between the check and the
// connection. Closing that needs pinning the connection to the validated IP,
// which the fetch API can't express without a custom dispatcher. The endpoint
// requires an admin session, so the residual risk is an attacker who already
// holds admin — for whom this is not the interesting attack surface.

import { lookup } from 'dns/promises';
import { isIP } from 'net';

/** Max redirect hops before giving up. */
const MAX_REDIRECTS = 5;
/** Timeout for the initial response headers. */
const HEADERS_TIMEOUT_MS = 15_000;

export type RemoteFetchError =
  | 'invalid_url'
  | 'blocked_scheme'
  | 'blocked_host'
  | 'too_many_redirects'
  | 'unreachable'
  | 'http_error'
  | 'unsupported_type'
  | 'too_large';

export class RemoteImportError extends Error {
  constructor(
    public readonly kind: RemoteFetchError,
    message: string,
  ) {
    super(message);
    this.name = 'RemoteImportError';
  }
}

/**
 * True for addresses that must never be reachable from a user-supplied URL:
 * loopback, link-local (including the cloud metadata endpoint), private
 * ranges, CGNAT, multicast and the unspecified address.
 */
export function isBlockedAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 0) return true; // not an IP at all — treat as unsafe

  if (version === 4) {
    const octets = ip.split('.').map(Number);
    const [a, b] = octets;
    if (octets.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // private
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 192 && b === 0) return true; // IETF protocol assignments
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast + reserved + broadcast
    return false;
  }

  const normalized = ip.toLowerCase().split('%')[0]; // strip zone index
  if (normalized === '::' || normalized === '::1') return true;
  // IPv4-mapped (::ffff:10.0.0.1) — judge by the embedded IPv4 address
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
  if (mapped) return isBlockedAddress(mapped[1]);
  if (/^f[cd]/.test(normalized)) return true; // unique local fc00::/7
  if (/^fe[89ab]/.test(normalized)) return true; // link-local fe80::/10
  if (normalized.startsWith('ff')) return true; // multicast
  return false;
}

/**
 * Validate a single URL: scheme, then every address its host resolves to.
 * A hostname with even one private address is rejected — a DNS entry that
 * mixes public and private answers is how this check gets bypassed.
 */
export async function assertSafeUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new RemoteImportError('invalid_url', '链接格式不正确');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new RemoteImportError('blocked_scheme', `不支持的协议：${url.protocol}`);
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, ''); // unwrap IPv6 literal

  // A literal IP skips DNS entirely.
  if (isIP(hostname)) {
    if (isBlockedAddress(hostname)) {
      throw new RemoteImportError('blocked_host', '该地址指向内网或保留网段，已拒绝');
    }
    return url;
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new RemoteImportError('unreachable', `无法解析域名：${hostname}`);
  }

  if (addresses.length === 0) {
    throw new RemoteImportError('unreachable', `无法解析域名：${hostname}`);
  }
  if (addresses.some((entry) => isBlockedAddress(entry.address))) {
    throw new RemoteImportError('blocked_host', '该地址指向内网或保留网段，已拒绝');
  }

  return url;
}

export interface RemoteResponse {
  /** The final URL after redirects — already validated. */
  finalUrl: string;
  response: Response;
  contentType: string;
  /** From Content-Length; 0 when the server didn't say. */
  declaredSize: number;
}

/**
 * Fetch a remote URL with redirects followed by hand so each hop is validated.
 *
 * `redirect: 'manual'` is what makes the per-hop check possible: letting fetch
 * follow redirects itself would validate only the first URL, and a public host
 * redirecting to 169.254.169.254 is the standard SSRF bypass.
 */
export async function fetchRemote(rawUrl: string): Promise<RemoteResponse> {
  let current = rawUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await assertSafeUrl(current);

    let response: Response;
    try {
      response = await fetch(url, {
        redirect: 'manual',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ReachArticleImport/1.0)',
          Accept: 'image/*,video/*;q=0.9,*/*;q=0.5',
        },
        signal: AbortSignal.timeout(HEADERS_TIMEOUT_MS),
      });
    } catch (err) {
      // Node's fetch reports nearly every network failure as the same bare
      // "fetch failed"; the reason a TLS handshake or DNS lookup died is in
      // `cause`, and without it the admin cannot tell a dead host from a
      // blocked one.
      const error = err as Error & { cause?: { message?: string; code?: string } };
      const cause = error.cause?.message ?? error.cause?.code ?? '';
      throw new RemoteImportError(
        'unreachable',
        `无法访问该链接：${error.message}${cause ? `（${cause}）` : ''}`,
      );
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      // Drain the redirect body so the socket can be reused.
      await response.body?.cancel();
      if (!location) {
        throw new RemoteImportError('http_error', `重定向缺少目标地址（HTTP ${response.status}）`);
      }
      current = new URL(location, url).toString();
      continue;
    }

    if (!response.ok) {
      await response.body?.cancel();
      throw new RemoteImportError('http_error', `源站返回 HTTP ${response.status}`);
    }

    const contentType = (response.headers.get('content-type') ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    const declaredSize = Number(response.headers.get('content-length') ?? 0) || 0;

    return { finalUrl: url.toString(), response, contentType, declaredSize };
  }

  throw new RemoteImportError('too_many_redirects', '重定向次数过多');
}

/**
 * True when a Content-Type carries no real information.
 *
 * Only these may be overridden by the URL extension. A header that states an
 * actual type — even a wrong-looking one like text/html on a .mp4 URL — is
 * believed: a mirror site serving an HTML player page at a .mp4 address is far
 * more common than a host mislabelling a real video, and trusting the extension
 * there stores the web page as if it were the video.
 */
export function isAmbiguousContentType(contentType: string): boolean {
  const type = contentType.split(';')[0].trim().toLowerCase();
  return (
    type === '' ||
    type === 'application/octet-stream' ||
    type === 'binary/octet-stream' ||
    type === 'application/binary' ||
    type === 'application/download' ||
    type === 'application/force-download'
  );
}

/** True for a response that is a web page rather than a media file. */
export function isHtmlContentType(contentType: string): boolean {
  const type = contentType.split(';')[0].trim().toLowerCase();
  return type === 'text/html' || type === 'application/xhtml+xml';
}

/** Extensions that identify a string in a page as the media file itself. */
const MEDIA_URL_EXTENSIONS = 'mp4|webm|mov|m4v|ogv|m3u8|jpe?g|png|gif|webp|avif';

/**
 * Find the media URL inside a script, for players that set src at runtime.
 *
 * Some mirror CDNs ship an empty `<video>` and assign the real address in JS:
 *
 *     const videoUrl = "https:\/\/cdn.example.com/AbC.mp4";
 *     video.src = videoUrl;
 *
 * There is no attribute to read, so the fallback is to look for a quoted string
 * that ends in a media extension. Scoped that tightly on purpose — matching any
 * quoted URL would just as happily return the page's analytics endpoint or the
 * hls.js bundle it loads from a CDN.
 */
function extractMediaUrlFromScript(html: string, baseUrl: string): string | null {
  // JS string literals escape slashes as \/ — undo that before matching.
  const unescaped = html.replace(/\\\//g, '/');
  const pattern = new RegExp(
    `["'](https?://[^"'\\s]+?\\.(?:${MEDIA_URL_EXTENSIONS})(?:\\?[^"'\\s]*)?)["']`,
    'gi',
  );

  const self = (() => {
    try {
      return new URL(baseUrl).toString();
    } catch {
      return '';
    }
  })();

  for (const match of unescaped.matchAll(pattern)) {
    const candidate = match[1];
    // The player page's own address often ends in .mp4 too; following it would
    // just fetch the same HTML again.
    if (candidate === self) continue;
    try {
      return new URL(candidate, baseUrl).toString();
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Pull the media URL out of an HTML player page.
 *
 * Several Twitter/X mirror CDNs hand out links that end in .mp4 but serve a
 * tiny HTML page wrapping a <video> element. Following that one level turns a
 * link the user actually has into the file they actually meant.
 *
 * DOM attributes are tried first because they are unambiguous; only if the page
 * carries no usable attribute does it fall back to scanning scripts.
 *
 * The result is untrusted input from a remote page, so the caller must run it
 * through assertSafeUrl again — which fetchRemote does.
 */
export function extractEmbeddedMediaUrl(html: string, baseUrl: string): string | null {
  const patterns = [
    /<source[^>]+src=["']([^"']+)["']/i,
    /<video[^>]+src=["']([^"']+)["']/i,
    /<meta[^>]+property=["']og:video(?::url|:secure_url)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:video/i,
    /<img[^>]+src=["']([^"']+)["']/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (!match?.[1]?.trim()) continue;
    try {
      return new URL(match[1], baseUrl).toString();
    } catch {
      continue;
    }
  }
  return extractMediaUrlFromScript(html, baseUrl);
}

/** Undo the handful of HTML entities that show up inside URLs. */
function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&#x2F;/gi, '/')
    .replace(/&#47;/g, '/')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'");
}

/**
 * Find where a page forwards to when it isn't an HTTP redirect.
 *
 * Link-shortener chains and mirror interstitials rarely answer 302. They serve
 * a document whose whole job is to move the browser on — a meta refresh, or a
 * script assigning location. `fetchRemote` follows Location headers and stops
 * there, so without this a chain like
 *
 *     host/AbC.mp4  →(302)  tinyurl  →(301)  landing page  →(meta refresh)  ???
 *
 * ends at the landing page and reports "not a media file", when the file (if
 * there is one) is another hop away.
 *
 * The indirect form is handled too, because it is what these pages actually
 * ship:
 *
 *     const destination = "https://…";
 *     window.location.href = destination;
 */
export function extractPageRedirect(html: string, baseUrl: string): string | null {
  const resolve = (raw: string): string | null => {
    const value = decodeEntities(raw).trim();
    if (!value) return null;
    try {
      const url = new URL(value, baseUrl);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      // A page "redirecting" to itself is a refresh loop, not a hop.
      if (url.toString() === baseUrl) return null;
      return url.toString();
    } catch {
      return null;
    }
  };

  const metaRefresh =
    /<meta[^>]+http-equiv=["']?refresh["']?[^>]*content=["'][^"']*?url\s*=\s*([^"';]+)/i.exec(html) ??
    /<meta[^>]+content=["'][^"']*?url\s*=\s*([^"';]+)["'][^>]*http-equiv=["']?refresh/i.exec(html);
  if (metaRefresh?.[1]) {
    const target = resolve(metaRefresh[1]);
    if (target) return target;
  }

  // Direct assignment: location.href = "https://…"  /  location.replace("https://…")
  const literal =
    /(?:window\.)?(?:top\.|parent\.)?location(?:\.href)?\s*=\s*["']([^"']+)["']/i.exec(html) ??
    /(?:window\.)?location\.(?:replace|assign)\s*\(\s*["']([^"']+)["']/i.exec(html);
  if (literal?.[1]) {
    const target = resolve(literal[1].replace(/\\\//g, '/'));
    if (target) return target;
  }

  // Indirect: location.href = destination, with `destination` assigned above.
  const viaVariable =
    /(?:window\.)?(?:top\.|parent\.)?location(?:\.href)?\s*=\s*([A-Za-z_$][\w$]*)\s*[;\n]/.exec(html) ??
    /(?:window\.)?location\.(?:replace|assign)\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/.exec(html);
  if (viaVariable?.[1]) {
    const assignment = new RegExp(
      `(?:const|let|var)?\\s*${viaVariable[1]}\\s*=\\s*["']([^"']+)["']`,
    ).exec(html);
    if (assignment?.[1]) {
      const target = resolve(assignment[1].replace(/\\\//g, '/'));
      if (target) return target;
    }
  }

  return null;
}

/**
 * Guess a media content type from the URL path.
 *
 * Used only when the server's own Content-Type is ambiguous — see
 * isAmbiguousContentType. The type still has to pass the allow-list afterwards,
 * so this widens what's accepted, not what's stored.
 */
export function guessTypeFromUrl(rawUrl: string): string {
  const path = (() => {
    try {
      return new URL(rawUrl).pathname;
    } catch {
      return rawUrl;
    }
  })();
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    avif: 'image/avif',
    svg: 'image/svg+xml',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    m4v: 'video/x-m4v',
    ogv: 'video/ogg',
  };
  return map[ext] ?? '';
}

/** How much of an HTML player page to read while looking for the media URL. */
const HTML_PROBE_LIMIT = 512 * 1024;
/** How many HTML pages may be walked through before giving up. */
const MAX_PAGE_HOPS = 4;

/** What the resolver is doing right now, for the progress display. */
export type ResolveStage =
  | { kind: 'fetching'; url: string }
  | { kind: 'parsing'; url: string }
  | { kind: 'following'; url: string; via: 'media' | 'redirect' | 'ai' }
  | { kind: 'ai'; url: string };

export interface ResolveOptions {
  onStage?: (stage: ResolveStage) => void;
  /**
   * Parser config for the LLM fallback, or null to stay on the rules alone.
   * Passed in rather than read here so this module keeps no DB dependency.
   */
  ai?: import('./ai-resolver').AiParserConfig | null;
}

export interface ResolvedRemoteMedia extends RemoteResponse {
  /** Every URL walked through, requested URL first, media file last. */
  trail: string[];
  /** Set when the requested URL was a player page we followed through. */
  viaPlayerPage?: string;
  /** True when the LLM fallback is what produced the final URL. */
  viaAi?: boolean;
}

/** Try each AI candidate in order; the first one that answers as media wins. */
async function tryCandidates(
  candidates: Array<{ url: string }>,
  seen: Set<string>,
): Promise<RemoteResponse | null> {
  for (const candidate of candidates) {
    if (seen.has(candidate.url)) continue;
    seen.add(candidate.url);
    try {
      const response = await fetchRemote(candidate.url);
      if (!isHtmlContentType(response.contentType)) return response;
      // A candidate that is itself a page is a wrong answer, not a new lead —
      // following it would restart the whole walk from a guess.
      await response.response.body?.cancel();
    } catch {
      // Unreachable / blocked / HTTP error — move on to the next candidate.
    }
  }
  return null;
}

/**
 * Fetch a remote URL, stepping through whatever stands between it and the file.
 *
 * Some mirror CDNs serve `https://host/AbC123.mp4` as a small HTML document
 * wrapping the real file; some serve a chain of them — a 302 to a shortener, a
 * landing page that forwards by meta refresh, and only then the player.
 * Requesting exactly what the user pasted and storing the result would save the
 * web page instead of the video, so each HTML response is examined and the walk
 * continues:
 *
 *   1. an embedded media URL (<video>, og:video, a quoted .mp4 in a script)
 *   2. a page-level redirect (meta refresh, location assignment)
 *   3. the LLM fallback, when configured — see lib/article/ai-resolver.ts
 *
 * Every extracted URL goes back through fetchRemote, so it gets the same scheme
 * and address validation as anything the user typed. It is, after all, content
 * from a remote page — and with the AI fallback in play, content a model wrote.
 */
export async function resolveRemoteMedia(
  rawUrl: string,
  options: ResolveOptions = {},
): Promise<ResolvedRemoteMedia> {
  const { onStage, ai } = options;
  const trail: string[] = [];
  const seen = new Set<string>([rawUrl]);
  let current = rawUrl;
  let lastPage: string | undefined;
  let aiReason = '';
  let aiAttempts = 0;

  for (let hop = 0; hop < MAX_PAGE_HOPS; hop++) {
    onStage?.({ kind: 'fetching', url: current });
    const response = await fetchRemote(current);
    trail.push(response.finalUrl);
    seen.add(response.finalUrl);

    if (!isHtmlContentType(response.contentType)) {
      return {
        ...response,
        trail,
        ...(lastPage ? { viaPlayerPage: lastPage } : {}),
        ...(aiAttempts > 0 ? { viaAi: true } : {}),
      };
    }

    onStage?.({ kind: 'parsing', url: response.finalUrl });
    let html: string;
    try {
      html = (await readBodyLimited(response.response, HTML_PROBE_LIMIT)).toString('utf8');
    } catch {
      throw new RemoteImportError(
        'unsupported_type',
        '该链接返回的是网页而不是媒体文件，且页面过大无法解析',
      );
    }
    lastPage = response.finalUrl;

    // ── 1. the rules ──
    const embedded = extractEmbeddedMediaUrl(html, response.finalUrl);
    if (embedded && !seen.has(embedded)) {
      seen.add(embedded);
      onStage?.({ kind: 'following', url: embedded, via: 'media' });
      current = embedded;
      continue;
    }

    const forwarded = extractPageRedirect(html, response.finalUrl);
    if (forwarded && !seen.has(forwarded)) {
      seen.add(forwarded);
      onStage?.({ kind: 'following', url: forwarded, via: 'redirect' });
      current = forwarded;
      continue;
    }

    // ── 2. the model ──
    // Only when the rules are exhausted, and at most twice per import: the
    // point is to read a page nobody wrote a rule for, not to re-read the same
    // dead end at every hop.
    if (ai && aiAttempts < 2) {
      aiAttempts++;
      onStage?.({ kind: 'ai', url: response.finalUrl });
      const { askAiForMedia } = await import('./ai-resolver');
      const verdict = await askAiForMedia(ai, {
        requestedUrl: rawUrl,
        finalUrl: response.finalUrl,
        contentType: response.contentType,
        html,
        hops: trail,
      });

      if (verdict) {
        if (verdict.reason) aiReason = verdict.reason;

        const found = await tryCandidates(verdict.candidates, seen);
        if (found) {
          return { ...found, trail: [...trail, found.finalUrl], viaPlayerPage: lastPage, viaAi: true };
        }

        if (verdict.nextPageUrl && !seen.has(verdict.nextPageUrl)) {
          seen.add(verdict.nextPageUrl);
          onStage?.({ kind: 'following', url: verdict.nextPageUrl, via: 'ai' });
          current = verdict.nextPageUrl;
          continue;
        }
      }
    }

    // Nothing led anywhere. The AI's account of the page, when there is one, is
    // far more use to the admin than "this is a web page" — it says whether the
    // link is an ad interstitial, a paywall, or a player that needs a login.
    throw new RemoteImportError(
      'unsupported_type',
      aiReason
        ? `未能提取到媒体文件：${aiReason}`
        : ai
          ? '该链接返回的是网页，AI 解析也没有找到可下载的媒体文件——请打开页面复制真正的图片/视频直链'
          : '该链接返回的是网页而不是媒体文件——请打开页面复制真正的图片/视频直链（可在「系统设置」开启 AI 解析引擎自动提取）',
    );
  }

  throw new RemoteImportError(
    'too_many_redirects',
    `跳转层级过多（已跟随 ${MAX_PAGE_HOPS} 层网页仍未找到媒体文件）`,
  );
}

/**
 * Read a response body into a buffer, aborting past maxBytes.
 *
 * Content-Length is checked first when present, but it is a claim, not a fact —
 * the running total is what actually stops an oversized or length-less body.
 */
export async function readBodyLimited(
  response: Response,
  maxBytes: number,
  onProgress?: (received: number, total: number) => void,
): Promise<Buffer> {
  const body = response.body;
  if (!body) throw new RemoteImportError('unreachable', '源站没有返回内容');

  const declared = Number(response.headers.get('content-length') ?? 0) || 0;
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    received += value.byteLength;
    onProgress?.(received, declared);
    if (received > maxBytes) {
      await reader.cancel();
      throw new RemoteImportError('too_large', `文件超过 ${Math.round(maxBytes / 1024 / 1024)}MB 上限`);
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks);
}
