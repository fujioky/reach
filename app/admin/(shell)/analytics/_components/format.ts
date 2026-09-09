// app/admin/(shell)/analytics/_components/format.ts
// Shared display helpers for the analytics pages (server-safe, pure).

/** Lightweight UA classification — no dependency needed */
export function classifyUA(ua: string | null): { label: string; icon: string } {
  if (!ua) return { label: '未知', icon: '?' };
  const u = ua.toLowerCase();
  if (u.includes('bot') || u.includes('crawl') || u.includes('spider')) return { label: '爬虫', icon: '🤖' };
  if (u.includes('iphone') || u.includes('android') || u.includes('mobile')) return { label: '移动端', icon: '📱' };
  if (u.includes('ipad') || u.includes('tablet')) return { label: '平板', icon: '📋' };
  return { label: '桌面', icon: '💻' };
}

/** Shorten UA to "Chrome 126 · macOS" style */
export function shortUA(ua: string | null): string {
  if (!ua) return '—';
  const chrome = ua.match(/Chrome\/([\d.]+)/);
  const safari = ua.match(/Version\/([\d.]+).*Safari/);
  const firefox = ua.match(/Firefox\/([\d.]+)/);
  const ios = ua.match(/iPhone OS ([\d_]+)/);
  const android = ua.match(/Android ([\d.]+)/);
  const mac = ua.includes('Macintosh');
  const win = ua.includes('Windows');
  const linux = ua.includes('Linux');
  const browser = chrome ? `Chrome ${chrome[1].split('.')[0]}` :
    safari ? `Safari ${safari[1].split('.')[0]}` :
    firefox ? `Firefox ${firefox[1].split('.')[0]}` : '浏览器';
  const os = ios ? `iOS ${ios[1].replace(/_/g, '.')}` :
    android ? `Android ${android[1]}` :
    mac ? 'macOS' : win ? 'Windows' : linux ? 'Linux' : '';
  return os ? `${browser} · ${os}` : browser;
}

/** Display-only timezone. Stored timestamps stay as written (UTC / naive). */
export const ANALYTICS_DISPLAY_TZ = 'Asia/Shanghai';

export function formatTs(d: Date, extra?: Intl.DateTimeFormatOptions): string {
  return d.toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...extra,
    timeZone: ANALYTICS_DISPLAY_TZ,
  });
}

/** "1m 23s" / "45s" duration label from ms */
export function formatDuration(ms: number): string {
  if (ms <= 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** Visitor identity label — the real IP */
export function visitorLabel(ip: string | null): string {
  return ip || '—';
}

/** "中国 · 上海" style geo label from Vercel edge header values */
export function geoLabel(
  country: string | null,
  region: string | null,
  city: string | null,
): string {
  const countryName = country
    ? new Intl.DisplayNames(['zh-CN'], { type: 'region' }).of(country) ?? country
    : null;
  const parts = [countryName, city || region].filter(Boolean);
  return parts.length ? parts.join(' · ') : '—';
}
